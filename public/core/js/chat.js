// ── Auth guard ────────────────────────────────────────────────────────────
const user = API.user();
const token = API.token();
if (!user || !token) { window.location.href = '/'; }

// ── State ─────────────────────────────────────────────────────────────────
let chats        = [];        // all loaded chats
let activeChatId = null;      // currently open chat _id
let messages     = [];        // messages in active chat
let replyToMsg   = null;      // message being replied to
let typingTimer  = null;      // debounce for typing stop
let isTyping     = false;
let reactionTargetMsgId = null;
let onlineUserIds = new Set();
let userStatuses  = {};       // userId → 'available'|'in-room'|'in-game'
let pendingAttachments = [];  // files to send
let buddies = [];             // accepted friends for new-chat modal
let groupMemberIds = [];      // selected group member ids (supabase)

// ── Socket ─────────────────────────────────────────────────────────────────
const socket = io({ transports: ['websocket'], auth: { userId: user.id } });

socket.on('connect', () => {
  // Re-join active chat if reconnecting
  if (activeChatId) socket.emit('join-chat', { chatId: activeChatId });
});

// ── Presence ───────────────────────────────────────────────────────────────
socket.on('online-users', ({ userIds }) => {
  onlineUserIds = new Set(userIds);
  refreshPresenceDots();
});
socket.on('user-online', ({ userId }) => {
  onlineUserIds.add(userId);
  refreshPresenceDots();
  updatePeerStatus();
});
socket.on('user-offline', ({ userId }) => {
  onlineUserIds.delete(userId);
  delete userStatuses[userId];
  refreshPresenceDots();
  updatePeerStatus();
});
socket.on('user-status', ({ userId, status, context }) => {
  userStatuses[userId] = status;
  refreshPresenceDots();
  updatePeerStatus();
});

// ── Realtime messages ──────────────────────────────────────────────────────
socket.on('new-message', (msg) => {
  const chatId = msg.chatId || msg.chat;
  if (chatId?.toString() === activeChatId?.toString()) {
    messages.push(msg);
    renderMessages();
    scrollBottom();
  }
  // Update preview in chat list
  updateChatPreview(chatId, msg);
});

socket.on('typing', ({ userId: tid, chatId, isTyping: t }) => {
  if (chatId?.toString() !== activeChatId?.toString()) return;
  const chat = chats.find(c => c._id.toString() === activeChatId?.toString());
  const typingEl = document.getElementById('chat-typing');
  const labelEl  = document.getElementById('typing-label');
  if (!typingEl) return;
  if (t) {
    const name = chat?.participants?.find(p => p.supabaseId === tid)?.name || 'Someone';
    labelEl.textContent = `${name} is typing…`;
    typingEl.style.display = 'flex';
  } else {
    typingEl.style.display = 'none';
  }
});

socket.on('reaction-added', ({ message_id, user_id, emoji, name }) => {
  const msg = messages.find(m => m._id.toString() === message_id);
  if (msg) {
    if (!msg.reactions) msg.reactions = [];
    msg.reactions.push({ emoji, userId: { supabaseId: user_id }, name });
    renderMessages();
  }
});
socket.on('reaction-removed', ({ message_id, user_id, emoji }) => {
  const msg = messages.find(m => m._id.toString() === message_id);
  if (msg && msg.reactions) {
    msg.reactions = msg.reactions.filter(r => !(r.emoji === emoji && r.userId?.supabaseId === user_id));
    renderMessages();
  }
});
socket.on('message-deleted', ({ message_id }) => {
  const msg = messages.find(m => m._id.toString() === message_id);
  if (msg) { msg.isDeleted = true; msg.text = ''; renderMessages(); }
});
socket.on('chat-created', () => loadChats()); // refresh list on new DM invite

// ── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadChats();
  await loadBuddies();

  // Open chat from URL if /chat/:chatId
  const pathChatId = location.pathname.split('/chat/')[1];
  if (pathChatId) openChat(pathChatId);

  window.addEventListener('popstate', () => {
    if (!location.pathname.match(/^\/chat\/[^/]+/)) closeConvo();
  });

  resetMusicPanel();
  if (window.lucide) lucide.createIcons();
});

// ── Load chats ─────────────────────────────────────────────────────────────
async function loadChats() {
  const { ok, data } = await API.get('/api/chat', true);
  if (!ok) return;
  chats = data;
  renderChatList(chats);
}

function renderChatList(list) {
  const el = document.getElementById('chat-list');
  if (!list.length) {
    el.innerHTML = `<div class="chat-list-loading">No chats yet. Start one!</div>`;
    return;
  }
  el.innerHTML = list.map(c => chatItemHtml(c)).join('');
}

function chatItemHtml(c) {
  const otherId = c.other_user?.id;
  const isOnlineUser = onlineUserIds.has(otherId);
  const status = userStatuses[otherId];
  const dotClass = c.isGroup ? '' : (status === 'in-room' ? 'in-room' : isOnlineUser ? 'online' : 'offline');
  const initials = (c.name || '?')[0].toUpperCase();
  const preview = c.lastMessage
    ? (c.lastMessage.isDeleted ? '🗑 Message deleted' : (c.lastMessage.text || '📎 Attachment'))
    : 'No messages yet';
  const time = c.lastMessageAt ? formatTime(new Date(c.lastMessageAt)) : '';
  const active = activeChatId?.toString() === c._id.toString() ? 'active' : '';

  return `
    <div class="chat-item ${active}" id="chat-item-${c._id}" onclick="openChat('${c._id}')">
      <div class="chat-item-avatar ${c.isGroup ? 'group' : ''}">
        ${c.isGroup ? '👥' : initials}
        ${!c.isGroup ? `<span class="presence-dot ${dotClass}"></span>` : ''}
      </div>
      <div class="chat-item-body">
        <div class="chat-item-name">${escHtml(c.name || '?')}</div>
        <div class="chat-item-preview">${escHtml(preview)}</div>
      </div>
      <div class="chat-item-meta">
        <span class="chat-item-time">${time}</span>
      </div>
    </div>`;
}

// ── Open a chat ────────────────────────────────────────────────────────────
async function openChat(chatId) {
  if (activeChatId) socket.emit('leave-chat', { chatId: activeChatId });

  activeChatId = chatId;
  socket.emit('join-chat', { chatId });

  // Update sidebar active state
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById(`chat-item-${chatId}`);
  if (item) item.classList.add('active');

  // Show convo panel
  document.getElementById('chat-empty').style.display = 'none';
  const convo = document.getElementById('chat-convo');
  convo.style.display = 'flex';
  document.getElementById('chat-main').classList.add('open');

  // Set header
  const chat = chats.find(c => c._id.toString() === chatId.toString());
  if (chat) {
    document.getElementById('chat-peer-name').textContent = chat.name || '?';
    const avatarEl = document.getElementById('chat-peer-avatar');
    avatarEl.textContent = (chat.name || '?')[0].toUpperCase();
    avatarEl.className = 'chat-peer-avatar' + (chat.isGroup ? ' group' : '');
    updatePeerStatus();

    // Show/hide meet+play for DMs only
    document.getElementById('meet-btn').style.display = chat.isGroup ? 'none' : '';
    document.getElementById('game-btn').style.display = chat.isGroup ? 'none' : '';
  }

  // Reset music panel when switching conversations
  resetMusicPanel();

  // ── Init MusicBot for this chat session (chatId acts as roomCode) ──
  if (window.MusicBot) {
    const mm = document.getElementById('music-messages');
    if (mm) mm.innerHTML = '';
    MusicBot.init(socket, chatId);
  }

  // Load messages
  document.getElementById('chat-msgs-loading').style.display = 'block';
  const { ok, data } = await API.get(`/api/chat/${chatId}/messages?limit=50`, true);
  document.getElementById('chat-msgs-loading').style.display = 'none';
  if (ok) { messages = data; renderMessages(); scrollBottom(); }

  // Update URL without reload
  history.replaceState(null, '', `/chat/${chatId}`);
}

function closeConvo() {
  if (activeChatId) socket.emit('leave-chat', { chatId: activeChatId });
  activeChatId = null;
  resetMusicPanel();
  document.getElementById('chat-empty').style.display = 'flex';
  document.getElementById('chat-convo').style.display = 'none';
  document.getElementById('chat-main')?.classList.remove('open');
  history.replaceState(null, '', '/chat');
}

// ── Render messages ────────────────────────────────────────────────────────
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!messages.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px">No messages yet. Say hello! 👋</div>';
    return;
  }

  let html = '';
  let lastDate = '';
  let lastSenderId = '';

  messages.forEach((msg, i) => {
    const mine = msg.sender?.supabaseId === user.id;
    const senderId = msg.sender?.supabaseId || '';
    const senderName = msg.sender?.name || 'Unknown';
    const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(msg.createdAt).toLocaleDateString();
    const showAvatar = !mine && senderId !== lastSenderId;
    const showName = !mine && senderId !== lastSenderId;

    // Day divider
    if (dateStr !== lastDate) {
      html += `<div class="day-divider">${dateStr === new Date().toLocaleDateString() ? 'Today' : dateStr}</div>`;
      lastDate = dateStr;
    }

    // Reply ref
    let replyHtml = '';
    if (msg.replyTo) {
      const rName = msg.replyTo.sender?.name || 'Someone';
      const rText = msg.replyTo.isDeleted ? 'Deleted message' : (msg.replyTo.text || '📎');
      replyHtml = `<div class="msg-reply-ref" onclick="scrollToMsg('${msg.replyTo._id}')">↩ <b>${escHtml(rName)}</b>: ${escHtml(rText.slice(0, 80))}</div>`;
    }

    // Reactions
    const reactionMap = {};
    (msg.reactions || []).forEach(r => {
      if (!reactionMap[r.emoji]) reactionMap[r.emoji] = [];
      reactionMap[r.emoji].push(r.userId?.supabaseId);
    });
    const reactionsHtml = Object.entries(reactionMap).map(([emoji, uids]) => {
      const mine_r = uids.includes(user.id);
      return `<span class="reaction-chip ${mine_r ? 'mine' : ''}" onclick="toggleReaction('${msg._id}','${emoji}')">${emoji} <span>${uids.length}</span></span>`;
    }).join('');

    // Attachments
    const attachHtml = (msg.attachments || []).map(url => {
      const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
      return isImg
        ? `<div class="msg-attachment"><img src="${url}" loading="lazy" onclick="window.open('${url}')"/></div>`
        : `<div class="msg-attachment msg-attachment-file">📎 <a href="${url}" target="_blank">Attachment</a></div>`;
    }).join('');

    html += `
      <div class="msg-row ${mine ? 'mine' : ''}" id="msg-${msg._id}">
        <div class="msg-avatar ${showAvatar ? '' : 'hidden'}">${senderName[0]?.toUpperCase()}</div>
        <div class="msg-bubble-wrap">
          ${showName ? `<div class="msg-sender-name">${escHtml(senderName)}</div>` : ''}
          ${replyHtml}
          <div class="msg-bubble ${msg.isDeleted ? 'deleted' : ''}" ondblclick="setReply('${msg._id}')">
            ${msg.isDeleted ? '🗑 Message deleted' : escHtml(msg.text)}
            ${attachHtml}
          </div>
          ${reactionsHtml ? `<div class="msg-reactions">${reactionsHtml}</div>` : ''}
          <div class="msg-time">${timeStr}</div>
        </div>
        ${!msg.isDeleted ? `
        <div class="msg-actions">
          <button class="msg-action-btn" onclick="showReactionPicker('${msg._id}', event)" title="React">😊</button>
          <button class="msg-action-btn" onclick="setReply('${msg._id}')" title="Reply">↩</button>
          ${mine ? `<button class="msg-action-btn" onclick="deleteMsg('${msg._id}')" title="Delete">🗑</button>` : ''}
        </div>` : ''}
      </div>`;

    lastSenderId = senderId;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function scrollBottom() {
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}
function scrollToMsg(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Send message ───────────────────────────────────────────────────────────
function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function sendMessage() {
  const inputEl = document.getElementById('chat-input');
  const text = inputEl.innerText.trim();
  if (!text && !pendingAttachments.length) return;
  if (!activeChatId) return;

  // Intercept music commands typed in the main chat input
  if (text.startsWith('/') && window.MusicBot) {
    const handled = MusicBot.parseCommand(text);
    if (handled) {
      inputEl.innerText = '';
      // Auto-open music panel so user sees the response
      const panel = document.getElementById('chat-music-panel');
      if (panel && panel.style.display === 'none') toggleMusicPanel();
      return;
    }
  }

  socket.emit('send-message', {
    chatId: activeChatId,
    text,
    replyToId: replyToMsg?._id || null,
    attachments: pendingAttachments,
  });

  inputEl.innerText = '';
  pendingAttachments = [];
  cancelReply();
  stopTyping();
}

// ── Typing indicator ───────────────────────────────────────────────────────
function handleTyping() {
  if (!activeChatId) return;
  if (!isTyping) {
    isTyping = true;
    socket.emit('typing', { chatId: activeChatId, isTyping: true });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}
function stopTyping() {
  if (!isTyping) return;
  isTyping = false;
  if (activeChatId) socket.emit('typing', { chatId: activeChatId, isTyping: false });
}

// ── Reply ──────────────────────────────────────────────────────────────────
function setReply(msgId) {
  const msg = messages.find(m => m._id.toString() === msgId);
  if (!msg) return;
  replyToMsg = msg;
  const preview = document.getElementById('reply-preview');
  document.getElementById('reply-preview-text').textContent =
    `${msg.sender?.name || 'Someone'}: ${msg.text?.slice(0, 80) || '📎'}`;
  preview.style.display = 'flex';
  document.getElementById('chat-input').focus();
}
function cancelReply() {
  replyToMsg = null;
  document.getElementById('reply-preview').style.display = 'none';
}

// ── Reactions ──────────────────────────────────────────────────────────────
function showReactionPicker(msgId, e) {
  reactionTargetMsgId = msgId;
  const picker = document.getElementById('reaction-picker');
  picker.style.display = 'flex';
  picker.style.top = (e.clientY - 60) + 'px';
  picker.style.left = Math.min(e.clientX, window.innerWidth - 260) + 'px';
  setTimeout(() => document.addEventListener('click', hideReactionPicker, { once: true }), 10);
}
function hideReactionPicker() {
  document.getElementById('reaction-picker').style.display = 'none';
}
async function pickReaction(emoji) {
  if (!reactionTargetMsgId || !activeChatId) return;
  hideReactionPicker();
  await API.post(`/api/chat/${activeChatId}/react`, { message_id: reactionTargetMsgId, emoji }, true);
}
async function toggleReaction(msgId, emoji) {
  if (!activeChatId) return;
  await API.post(`/api/chat/${activeChatId}/react`, { message_id: msgId, emoji }, true);
}

// ── Delete message ─────────────────────────────────────────────────────────
async function deleteMsg(msgId) {
  if (!activeChatId) return;
  await API.delete(`/api/chat/${activeChatId}/messages/${msgId}`, true);
}

// ── File attachment ────────────────────────────────────────────────────────
function triggerFileUpload() { document.getElementById('chat-file-input').click(); }
function handleFileAttachment(input) {
  const files = [...input.files];
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = e => pendingAttachments.push(e.target.result);
    reader.readAsDataURL(f);
  });
  showToast(`📎 ${files.length} file(s) attached — press Send`);
}

// ── New chat modal ─────────────────────────────────────────────────────────
async function loadBuddies() {
  const { ok, data } = await API.get('/api/friends', true);
  if (ok) buddies = (data || []).filter(b => b.status === 'accepted');
}

function openNewChatModal() {
  groupMemberIds = [];
  document.getElementById('new-dm-search').value = '';
  document.getElementById('new-dm-results').innerHTML = '';
  document.getElementById('new-group-name').value = '';
  document.getElementById('new-group-search').value = '';
  document.getElementById('new-group-results').innerHTML = '';
  document.getElementById('group-member-chips').innerHTML = '';
  setNewChatTab('dm');
  openModal('modal-new-chat');
}

function setNewChatTab(tab) {
  document.getElementById('new-chat-dm').style.display = tab === 'dm' ? 'block' : 'none';
  document.getElementById('new-chat-group').style.display = tab === 'group' ? 'block' : 'none';
  document.getElementById('dm-modal-actions').style.display = tab === 'dm' ? 'flex' : 'none';
  document.getElementById('tab-dm').classList.toggle('active', tab === 'dm');
  document.getElementById('tab-group').classList.toggle('active', tab === 'group');
}

function filterNewDM(q) {
  const results = document.getElementById('new-dm-results');
  const filtered = buddies.filter(b => b.friend.name.toLowerCase().includes(q.toLowerCase()));
  results.innerHTML = filtered.map(b => `
    <div class="buddy-result-row" onclick="startDM('${b.friend.id}')">
      <div class="buddy-result-avatar">${b.friend.name[0].toUpperCase()}</div>
      <div>
        <div class="buddy-result-name">${escHtml(b.friend.name)}</div>
        <div class="buddy-result-status">${onlineUserIds.has(b.friend.id) ? '🟢 Online' : '⚫ Offline'}</div>
      </div>
    </div>`).join('') || '<div style="color:var(--muted);font-size:12px;padding:8px">No buddies found</div>';
}

async function startDM(friendSupabaseId) {
  closeModal('modal-new-chat');
  // Register friend in chat system first
  const { ok, data } = await API.post(`/api/chat/dm/${friendSupabaseId}`, {}, true);
  if (ok) { await loadChats(); openChat(data._id); }
  else showToast(data?.error || 'Failed to start chat');
}

function filterGroupMembers(q) {
  const results = document.getElementById('new-group-results');
  const filtered = buddies.filter(b =>
    b.friend.name.toLowerCase().includes(q.toLowerCase()) && !groupMemberIds.includes(b.friend.id)
  );
  results.innerHTML = filtered.map(b => `
    <div class="buddy-result-row" onclick="addGroupMember('${b.friend.id}','${escHtml(b.friend.name)}')">
      <div class="buddy-result-avatar">${b.friend.name[0].toUpperCase()}</div>
      <div class="buddy-result-name">${escHtml(b.friend.name)}</div>
    </div>`).join('') || '';
}

function addGroupMember(id, name) {
  if (groupMemberIds.includes(id)) return;
  groupMemberIds.push(id);
  const chips = document.getElementById('group-member-chips');
  const chip = document.createElement('div');
  chip.id = `gchip-${id}`;
  chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--bg3);border:1px solid var(--border2);border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600';
  chip.innerHTML = `${escHtml(name)} <span onclick="removeGroupMember('${id}')" style="cursor:pointer;color:var(--muted);font-size:14px">×</span>`;
  chips.appendChild(chip);
  document.getElementById('new-group-search').value = '';
  document.getElementById('new-group-results').innerHTML = '';
}
function removeGroupMember(id) {
  groupMemberIds = groupMemberIds.filter(x => x !== id);
  document.getElementById(`gchip-${id}`)?.remove();
}

async function createGroupChat() {
  const name = document.getElementById('new-group-name').value.trim();
  if (!name) return showToast('Please enter a group name');
  if (!groupMemberIds.length) return showToast('Add at least one member');
  const { ok, data } = await API.post('/api/chat/group', { name, member_supabase_ids: groupMemberIds }, true);
  if (ok) { closeModal('modal-new-chat'); await loadChats(); openChat(data._id); }
  else showToast(data?.error || 'Failed to create group');
}

// ── Presence helpers ───────────────────────────────────────────────────────
function refreshPresenceDots() {
  chats.forEach(c => {
    const otherId = c.other_user?.id;
    if (!otherId) return;
    const dot = document.querySelector(`#chat-item-${c._id} .presence-dot`);
    if (!dot) return;
    const status = userStatuses[otherId];
    dot.className = 'presence-dot ' + (status === 'in-room' ? 'in-room' : onlineUserIds.has(otherId) ? 'online' : 'offline');
  });
}

function updatePeerStatus() {
  const chat = chats.find(c => c._id.toString() === activeChatId?.toString());
  if (!chat || chat.isGroup) return;
  const otherId = chat.other_user?.id;
  const status = userStatuses[otherId];
  const statusEl = document.getElementById('chat-peer-status');
  if (!statusEl) return;
  statusEl.className = 'chat-peer-status';
  if (status === 'in-room') { statusEl.textContent = '🔴 In a room'; statusEl.classList.add('in-room'); }
  else if (onlineUserIds.has(otherId)) { statusEl.textContent = '🟢 Online'; statusEl.classList.add('online'); }
  else { statusEl.textContent = 'Offline'; }
}

function updateChatPreview(chatId, msg) {
  const item = document.getElementById(`chat-item-${chatId}`);
  if (!item) { loadChats(); return; }
  const preview = item.querySelector('.chat-item-preview');
  if (preview) preview.textContent = msg.isDeleted ? '🗑 Deleted' : (msg.text || '📎');
}

// ── Quick actions from header ──────────────────────────────────────────────
function startMeetWithPeer() {
  const chat = chats.find(c => c._id.toString() === activeChatId?.toString());
  if (!chat?.other_user) return;
  window.location.href = `/dashboard`;
}
function startGameWithPeer() {
  showToast('🎮 Start a room together and open Games!');
}

// ── Music Panel toggle ────────────────────────────────────────────────────
let _musicPanelOpen = false;
function resetMusicPanel() {
  _musicPanelOpen = false;
  const panel = document.getElementById('chat-music-panel');
  const btn = document.getElementById('music-toggle-btn');
  if (panel) panel.style.display = 'none';
  if (btn) {
    btn.style.background = '';
    btn.style.color = '';
  }
}
function toggleMusicPanel() {
  const panel = document.getElementById('chat-music-panel');
  const btn   = document.getElementById('music-toggle-btn');
  if (!panel) return;
  _musicPanelOpen = !_musicPanelOpen;
  panel.style.display = _musicPanelOpen ? 'flex' : 'none';
  if (btn) btn.style.background = _musicPanelOpen ? 'var(--accent)' : '';
  if (btn) btn.style.color      = _musicPanelOpen ? '#fff' : '';
  if (_musicPanelOpen) {
    const inp = document.getElementById('chat-music-input');
    if (inp) setTimeout(() => inp.focus(), 50);
  }
}

// ── Music command input (panel) ───────────────────────────────────────────
function sendChatMusicCommand() {
  const inp = document.getElementById('chat-music-input');
  if (!inp || !window.MusicBot) return;
  const val = inp.value.trim();
  if (!val) return;
  // Prepend /play if user typed a bare search term
  const cmd = val.startsWith('/') ? val : `/play ${val}`;
  MusicBot.parseCommand(cmd);
  inp.value = '';
}

// ── EventBus: update music badge when track changes ───────────────────────
if (window.EventBus) {
  window.EventBus.on('MUSIC_PRESENCE_UPDATE', (state) => {
    const badge = document.getElementById('music-now-playing-badge');
    if (badge) badge.style.display = (state.playing && state.track) ? 'block' : 'none';
  });
}

// ── Chat list search ───────────────────────────────────────────────────────
function filterChats(q) {
  const filtered = chats.filter(c => (c.name || '').toLowerCase().includes(q.toLowerCase()));
  renderChatList(filtered);
}

// ── Utilities ──────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm';
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
// ── Broadcast own status to others ────────────────────────────────────────
socket.emit('update-status', { status: 'available' });
