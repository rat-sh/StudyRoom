// ── STATE ──────────────────────────────────────────────────────
const roomCode = window.location.pathname.split('/room/')[1]?.toUpperCase();
const token = API.token();
const storedUser = API.user();
const guestData = JSON.parse(sessionStorage.getItem('sr_guest') || 'null');
const user = storedUser || guestData || { name: 'Guest', guest: true };

if (!roomCode) window.location.href = '/';
if (!storedUser && !guestData) {
  window.location.href = '/';
}

const CURSOR_COLORS = ['#00B894','#4ECDC4','#FF6B6B','#FFA502','#A29BFE','#FD79A8','#00B894','#FDCB6E'];
let colorIdx = 0;
const peerColors = {};
const peers = {};
const peerTiles = {};
const peerInfo = {};
const cursors = {};

let localStream = null;
let screenStream = null;
let micOn = true;
let camOn = true;
let screenSharing = false;
let activeFeature = null;
let sidebarVisible = true;
let emojiPickerOpen = false;

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ── SOCKET ─────────────────────────────────────────────────────
const socket = io();

// ── INIT ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('room-code-badge').textContent = roomCode;
  document.getElementById('room-name-title').textContent = 'Room · ' + roomCode;
  document.getElementById('self-avatar').textContent = initials(user.name);
  document.getElementById('self-name').textContent = user.name;
  addToPeopleList('self', user.name, true, user.guest);
  socket.emit('join-room', { roomCode, user });

  // Init music bot — also requests current state for late joiners
  MusicBot.init(socket, roomCode);

  // Try media silently on load
  try { await requestMedia(true); } catch {}

  // Chat keyboard
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  // Close emoji picker on outside click
  document.addEventListener('click', e => {
    const picker = document.getElementById('emoji-picker');
    const triggerBtn = document.getElementById('emoji-trigger-btn');
    const triggerBarBtn = document.getElementById('btn-emoji-bar');
    if (!picker.contains(e.target) && e.target !== triggerBtn && e.target !== triggerBarBtn) {
      picker.classList.remove('open');
      emojiPickerOpen = false;
    }
  });

  // Init resizable sidebar
  initSidebarResize();

  // Set initial grid layout (1 = just yourself)
  updateVideoGrid();
});

// ── RESIZABLE SIDEBAR ──────────────────────────────────────────
function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  const sidebar = document.getElementById('room-sidebar');
  if (!handle || !sidebar) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = startX - e.clientX; // dragging left increases width
    const newWidth = Math.max(200, Math.min(600, startWidth + delta));
    sidebar.style.width = newWidth + 'px';
    sidebar.style.flex = 'none';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // Touch support
  handle.addEventListener('touchstart', e => {
    dragging = true;
    startX = e.touches[0].clientX;
    startWidth = sidebar.offsetWidth;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const delta = startX - e.touches[0].clientX;
    const newWidth = Math.max(200, Math.min(600, startWidth + delta));
    sidebar.style.width = newWidth + 'px';
    sidebar.style.flex = 'none';
  }, { passive: true });

  document.addEventListener('touchend', () => { dragging = false; });
}

// ── MEDIA ──────────────────────────────────────────────────────
async function requestMedia(silent = false) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const vid = document.getElementById('local-video');
    vid.srcObject = localStream;
    vid.classList.add('active');
    document.getElementById('self-avatar').style.display = 'none';
    document.getElementById('self-name').style.display = 'none';
    document.getElementById('perm-banner').style.display = 'none';
    if (!silent) showToast('Camera & mic connected!');
    socket.emit('media-state', { roomCode, video: true, audio: true });
  } catch (e) {
    if (!silent) showToast('Could not access camera/mic');
    throw e;
  }
}

function toggleMic() {
  if (!localStream) { showToast('Click Allow Access first'); return; }
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  const btn = document.getElementById('btn-mic');
  btn.innerHTML = micOn ? '<i data-lucide="mic" style="width:20px;height:20px"></i>' : '<i data-lucide="mic-off" style="width:20px;height:20px"></i>';
  btn.classList.toggle('off', !micOn);
  document.getElementById('self-mic-off').classList.toggle('hidden', micOn);
  socket.emit('media-state', { roomCode, video: camOn, audio: micOn });
  showToast(micOn ? 'Mic on' : 'Mic off');
  if (window.lucide) lucide.createIcons();
}

function toggleCam() {
  if (!localStream) { showToast('Click Allow Access first'); return; }
  const btn = document.getElementById('btn-cam');
  const vid = document.getElementById('local-video');
  const tileSelf = document.getElementById('tile-self');

  if (camOn) {
    // ── TURN OFF: stop the hardware track so the LED goes out ──
    localStream.getVideoTracks().forEach(t => {
      t.stop();                   // releases the camera hardware
      localStream.removeTrack(t); // clean up from the stream object
    });
    camOn = false;
    vid.srcObject = null;         // clear the video element
    vid.classList.remove('active');
    if (tileSelf) tileSelf.classList.add('cam-off');
    document.getElementById('self-avatar').style.display = 'flex';
    document.getElementById('self-name').style.display  = 'block';
    btn.innerHTML = '<i data-lucide="camera-off" style="width:20px;height:20px"></i>';
    btn.classList.add('off');
  } else {
    // ── TURN ON: request a fresh video track ──
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(newStream => {
        const newTrack = newStream.getVideoTracks()[0];
        localStream.addTrack(newTrack);
        vid.srcObject = localStream;
        vid.classList.add('active');
        // Replace the track in every peer connection
        replaceVideoTrack(newTrack);
        camOn = true;
        if (tileSelf) tileSelf.classList.remove('cam-off');
        document.getElementById('self-avatar').style.display = 'none';
        document.getElementById('self-name').style.display  = 'none';
        btn.innerHTML = '<i data-lucide="camera" style="width:20px;height:20px"></i>';
        btn.classList.remove('off');
        socket.emit('media-state', { roomCode, video: true, audio: micOn });
        showToast('Camera on');
        if (window.lucide) lucide.createIcons();
      })
      .catch(() => showToast('Could not restart camera'));
    return; // early return — toast + state update inside .then()
  }

  socket.emit('media-state', { roomCode, video: camOn, audio: micOn });
  showToast(camOn ? 'Camera on' : 'Camera off');
  if (window.lucide) lucide.createIcons();
}

async function toggleScreen() {
  if (screenSharing) {
    screenStream?.getTracks().forEach(t => t.stop());
    screenSharing = false;
    const btn = document.getElementById('btn-screen');
    btn.classList.remove('active');
    btn.innerHTML = '<i data-lucide="monitor" style="width:20px;height:20px"></i>';
    if (localStream) replaceVideoTrack(localStream.getVideoTracks()[0]);
    showToast('Screen share stopped');
    if (window.lucide) lucide.createIcons();
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenSharing = true;
    const btn = document.getElementById('btn-screen');
    btn.classList.add('active');
    btn.innerHTML = '<i data-lucide="square" style="width:20px;height:20px;fill:currentColor"></i>';
    replaceVideoTrack(screenStream.getVideoTracks()[0]);
    screenStream.getVideoTracks()[0].onended = () => toggleScreen();
    showToast('Screen sharing started');
    if (window.lucide) lucide.createIcons();
  } catch { showToast('Screen share cancelled'); }
}

function replaceVideoTrack(track) {
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender && track) sender.replaceTrack(track);
  });
}

// ── WebRTC ─────────────────────────────────────────────────────
function createPeer(socketId) {
  const pc = new RTCPeerConnection(ICE_CONFIG);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const remoteStream = new MediaStream();
  pc.ontrack = e => {
    remoteStream.addTrack(e.track);
    const vid = document.getElementById('vid-' + socketId);
    if (vid) {
      vid.srcObject = remoteStream;
      vid.classList.add('active');
      const av = document.getElementById('av-' + socketId);
      const nm = document.getElementById('nm-' + socketId);
      if (av) av.style.display = 'none';
      if (nm) nm.style.display = 'none';
    }
  };
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { to: socketId, candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (['disconnected','failed','closed'].includes(pc.connectionState)) removePeer(socketId);
  };
  peers[socketId] = pc;
  return pc;
}

async function callPeer(socketId) {
  const pc = createPeer(socketId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { to: socketId, offer });
}

// ── SOCKET EVENTS ──────────────────────────────────────────────
// ── VIDEO GRID LAYOUT ────────────────────────────────────────────
// Counts all .video-tile elements and sets data-peers on the grid
// so the CSS attribute selectors can apply the right column layout.
function updateVideoGrid() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  const count = grid.querySelectorAll('.video-tile').length;
  if      (count <= 1) grid.dataset.peers = '1';
  else if (count === 2) grid.dataset.peers = '2';
  else if (count === 3) grid.dataset.peers = '3';
  else if (count === 4) grid.dataset.peers = '4';
  else                  grid.dataset.peers = 'many';
}

socket.on('room-peers', async peersArr => {
  for (const { socketId, user: u } of peersArr) {
    peerInfo[socketId] = u;
    addVideoTile(socketId, u.name, u.guest);
    addToPeopleList(socketId, u.name, false, u.guest);
    await callPeer(socketId);
  }
  updateVideoGrid();
});

socket.on('user-joined', ({ socketId, user: u }) => {
  peerInfo[socketId] = u;
  addVideoTile(socketId, u.name, u.guest);
  addToPeopleList(socketId, u.name, false, u.guest);
  showToast(`${u.name} joined`);
  appendSystemMessage(`${u.name} joined the room`);
  updateVideoGrid();
});

socket.on('user-left', ({ socketId }) => {
  const name = peerInfo[socketId]?.name || 'Someone';
  removePeer(socketId);
  showToast(`${name} left`);
  appendSystemMessage(`${name} left the room`);
  updateVideoGrid();
});

socket.on('room-count', count => {
  document.getElementById('online-count').textContent = count;
});

socket.on('offer', async ({ from, offer }) => {
  const pc = createPeer(from);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: from, answer });
});

socket.on('answer', async ({ from, answer }) => {
  if (peers[from]) await peers[from].setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  if (peers[from]) await peers[from].addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on('peer-media-state', ({ socketId, video, audio }) => {
  const mic = document.getElementById('mic-' + socketId);
  if (mic) mic.classList.toggle('hidden', audio);
  const vid = document.getElementById('vid-' + socketId);
  if (vid) vid.classList.toggle('active', video && vid.srcObject);
  const tile = document.getElementById('tile-' + socketId);
  if (tile) tile.classList.toggle('cam-off', !video);
});

// ── CURSORS ────────────────────────────────────────────────────
const videoArea = document.getElementById('video-area');
let cursorThrottle = 0;
videoArea.addEventListener('mousemove', e => {
  const now = Date.now();
  if (now - cursorThrottle < 80) return;
  cursorThrottle = now;
  const rect = videoArea.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(2);
  const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(2);
  socket.emit('cursor-move', { roomCode, x: parseFloat(x), y: parseFloat(y) });
});
videoArea.addEventListener('mouseleave', () => {
  Object.values(cursors).forEach(c => c.style.opacity = '0');
});
socket.on('cursor-move', ({ socketId, name, x, y }) => {
  if (!cursors[socketId]) {
    const color = getCursorColor(socketId);
    const el = document.createElement('div');
    el.className = 'remote-cursor';
    el.innerHTML = `<div class="remote-cursor-dot" style="background:${color}"></div><div class="remote-cursor-label" style="background:${color}">${escapeHtml(name)}</div>`;
    document.getElementById('cursor-overlay').appendChild(el);
    cursors[socketId] = el;
  }
  const c = cursors[socketId];
  c.style.left = x + '%';
  c.style.top = y + '%';
  c.style.opacity = '1';
});

// ── CHAT ───────────────────────────────────────────────────────
function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  // Check for music bot commands first — they don't go to normal chat
  if (message.startsWith('/')) {
    const handled = MusicBot.parseCommand(message);
    if (handled) {
      input.value = '';
      return;
    }
  }

  socket.emit('chat-message', { roomCode, message });
  input.value = '';
}

function sendEmojiToChat(emoji) {
  socket.emit('chat-message', { roomCode, message: emoji });
  document.getElementById('emoji-picker').classList.remove('open');
  emojiPickerOpen = false;
}

socket.on('chat-message', ({ socketId, name, message, time }) => {
  const isMe = socketId === socket.id;
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isMe ? ' mine' : '');
  const isEmojiOnly = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u200D)+$/u.test(message) && message.length <= 8;
  const bubbleContent = isEmojiOnly
    ? `<span class="emoji-msg">${escapeHtml(message)}</span>`
    : escapeHtml(message);
  div.innerHTML = `<div class="msg-sender">${escapeHtml(isMe ? 'You' : name)}<span class="msg-time">${time}</span></div><div class="msg-bubble">${bubbleContent}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (!isMe && !document.getElementById('rsb-chat').classList.contains('active')) {
    document.getElementById('tab-chat').style.color = 'var(--warning)';
    document.getElementById('tab-chat').style.fontWeight = '700';
  }
});

function appendSystemMessage(text) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;font-size:10px;color:var(--hint);padding:4px 0';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── REACTIONS ──────────────────────────────────────────────────
function sendReaction(emoji) {
  socket.emit('send-reaction', { roomCode, emoji });
  spawnReaction(emoji, 'tile-self');
  socket.emit('chat-message', { roomCode, message: emoji });
  document.getElementById('emoji-picker').classList.remove('open');
  emojiPickerOpen = false;
}

socket.on('reaction', ({ socketId, emoji }) => {
  spawnReaction(emoji, 'tile-' + socketId);
});

socket.on('hand-raised', ({ socketId, name }) => {
  showToast(`${name} raised their hand`);
  spawnReaction('✋', 'tile-' + socketId);
});

function spawnReaction(emoji, tileId) {
  const tile = document.getElementById(tileId);
  if (!tile) return;
  const span = document.createElement('span');
  span.className = 'reaction-burst';
  span.textContent = emoji;
  span.style.left = (Math.random() * 50 + 25) + '%';
  span.style.bottom = '20%';
  tile.appendChild(span);
  setTimeout(() => span.remove(), 1200);
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  emojiPickerOpen = !emojiPickerOpen;
  picker.classList.toggle('open', emojiPickerOpen);
}

// ── SIDEBAR TOGGLE ─────────────────────────────────────────────
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  const sidebar = document.getElementById('room-sidebar');
  const handle = document.getElementById('sidebar-resize-handle');
  sidebar.classList.toggle('collapsed', !sidebarVisible);
  if (handle) handle.style.display = sidebarVisible ? '' : 'none';
  const btn = document.getElementById('feat-collapse-sidebar');
  btn.innerHTML = sidebarVisible
    ? '<i data-lucide="chevron-right" id="sidebar-icon" style="width:20px;height:20px"></i><span class="feat-tooltip">Hide sidebar</span>'
    : '<i data-lucide="chevron-left" id="sidebar-icon" style="width:20px;height:20px"></i><span class="feat-tooltip">Show sidebar</span>';
  if (window.lucide) lucide.createIcons();
}

// ── TABS ───────────────────────────────────────────────────────
function setTab(tab) {
  document.querySelectorAll('.rsb-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.rsb-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('rsb-' + tab).classList.add('active');
  document.getElementById('tab-' + tab).style.color = '';
  document.getElementById('tab-' + tab).style.fontWeight = '';
  if (tab === 'chat') {
    setTimeout(() => {
      const msgs = document.getElementById('chat-messages');
      msgs.scrollTop = msgs.scrollHeight;
    }, 50);
  }
}

// ── FEATURE PANEL ──────────────────────────────────────────────
const FEATURES = {
  whiteboard: { title: '✏️ Whiteboard', src: '/features/whiteboard/index.html' },
  timer:      { title: '⏱ Pomodoro Timer', src: '/features/timer/index.html' },
  files:      { title: '📁 File Sharing', src: '/features/files/index.html' }
};

// ── MUSIC PANEL SHORTCUT ───────────────────────────────────────
// Opens the Chat tab (where music commands live) and highlights
// the music-bot-hint strip so users know where to type /play.
function openMusicPanel() {
  // Make sure the sidebar is visible
  if (!sidebarVisible) toggleSidebar();

  // Switch to the chat tab
  setTab('chat');

  // Highlight the music hint strip briefly
  const hint = document.querySelector('.chat-bot-hint');
  if (hint) {
    hint.classList.add('music-hint-glow');
    setTimeout(() => hint.classList.remove('music-hint-glow'), 1800);
  }

  // Focus the chat input and pre-fill /play for convenience
  const input = document.getElementById('chat-input');
  if (input) {
    input.focus();
    if (!input.value) input.value = '/play ';
    // Put cursor at end
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // Mark the music button active
  document.querySelectorAll('.feat-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('feat-music')?.classList.add('active');

  showToast('🎵 Type /play <song name> and press Enter');
}

function toggleFeature(name) {
  const wrap = document.getElementById('feat-panel-wrap');
  const videoAreaEl = document.getElementById('video-area');
  const btnId = name === 'whiteboard' ? 'feat-wb' : 'feat-' + name;
  const btn = document.getElementById(btnId);
  if (activeFeature === name) { closeFeature(); return; }
  activeFeature = name;
  document.querySelectorAll('.feat-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const f = FEATURES[name];
  document.getElementById('feat-panel-title').textContent = f.title;
  document.getElementById('feat-panel-body').innerHTML =
    `<iframe src="${f.src}?room=${roomCode}" style="width:100%;height:100%;border:none;flex:1" allow="camera;microphone"></iframe>`;
  wrap.classList.add('open');
  videoAreaEl.classList.add('feat-open');
}

function closeFeature() {
  activeFeature = null;
  document.querySelectorAll('.feat-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('feat-panel-wrap').classList.remove('open');
  document.getElementById('video-area').classList.remove('feat-open');
  document.getElementById('feat-panel-body').innerHTML = '';
}

// postMessage bridge
window.addEventListener('message', e => {
  const { type, data } = e.data || {};
  if (!type) return;
  if (type === 'WHITEBOARD_DRAW') socket.emit('whiteboard-draw', { roomCode, data });
  if (type === 'WHITEBOARD_CLEAR') socket.emit('whiteboard-clear', { roomCode });
  if (type === 'TIMER_START') socket.emit('timer-start', { roomCode, duration: data.duration });
  if (type === 'TIMER_STOP') socket.emit('timer-stop', { roomCode });
  if (type === 'TIMER_REQUEST') socket.emit('timer-request', { roomCode });
});

socket.on('whiteboard-draw', ({ data }) => {
  const frame = document.querySelector('#feat-panel-body iframe');
  if (frame) frame.contentWindow.postMessage({ type: 'DRAW', data }, '*');
});
socket.on('whiteboard-clear', () => {
  const frame = document.querySelector('#feat-panel-body iframe');
  if (frame) frame.contentWindow.postMessage({ type: 'CLEAR' }, '*');
});
socket.on('timer-sync', data => {
  const frame = document.querySelector('#feat-panel-body iframe');
  if (frame) frame.contentWindow.postMessage({ type: 'TIMER_SYNC', data }, '*');
});
socket.on('timer-done', () => {
  showToast('Timer done!', 4000);
  const frame = document.querySelector('#feat-panel-body iframe');
  if (frame) frame.contentWindow.postMessage({ type: 'TIMER_DONE' }, '*');
});

// ── DOM HELPERS ────────────────────────────────────────────────
function addVideoTile(socketId, name, guest = false) {
  const grid = document.getElementById('video-grid');
  const div = document.createElement('div');
  div.className = 'video-tile';
  div.id = 'tile-' + socketId;
  div.innerHTML = `
    <video id="vid-${socketId}" autoplay playsinline></video>
    <div class="tile-avatar" id="av-${socketId}">${initials(name)}</div>
    <div class="tile-name" id="nm-${socketId}">${escapeHtml(name)}</div>
    <div class="tile-mic-off hidden" id="mic-${socketId}"><i data-lucide="mic-off" style="width:14px;height:14px"></i></div>
    ${guest ? `<div class="tile-guest-tag">Guest</div>` : ''}
  `;
  grid.appendChild(div);
  peerTiles[socketId] = div;
  if (window.lucide) lucide.createIcons();
}

function removePeer(socketId) {
  if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
  if (peerTiles[socketId]) { peerTiles[socketId].remove(); delete peerTiles[socketId]; }
  if (cursors[socketId]) { cursors[socketId].remove(); delete cursors[socketId]; }
  delete peerInfo[socketId];
  const row = document.getElementById('peer-row-' + socketId);
  if (row) row.remove();
}

function addToPeopleList(socketId, name, isYou = false, guest = false) {
  const list = document.getElementById('people-list');
  const div = document.createElement('div');
  div.className = 'peer-row';
  div.id = 'peer-row-' + socketId;
  div.innerHTML = `
    <div class="peer-av">${initials(name)}</div>
    <div class="peer-name">${escapeHtml(name)}</div>
    ${isYou ? '<span class="peer-you">You</span>' : ''}
    ${guest && !isYou ? '<span class="peer-guest">Guest</span>' : ''}
  `;
  list.appendChild(div);
}

// ── LEAVE ──────────────────────────────────────────────────────
function leaveRoom() {
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(pc => pc.close());
  socket.disconnect();
  sessionStorage.removeItem('sr_guest');
  window.location.href = storedUser ? '/dashboard' : '/';
}

window.addEventListener('beforeunload', () => {
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
});

// ── UTILS ──────────────────────────────────────────────────────
function getCursorColor(socketId) {
  if (!peerColors[socketId]) {
    peerColors[socketId] = CURSOR_COLORS[colorIdx % CURSOR_COLORS.length];
    colorIdx++;
  }
  return peerColors[socketId];
}