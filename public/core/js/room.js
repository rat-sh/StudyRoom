const roomCode = window.location.pathname.split('/room/')[1]?.toUpperCase();
const storedUser = API.user();
const guestData = JSON.parse(sessionStorage.getItem('sr_guest') || 'null');
const user = storedUser || guestData || { name: 'Guest', guest: true };
if (!roomCode) window.location.href = '/';
if (!storedUser && !guestData) window.location.href = '/login';

let localStream = null, screenStream = null;
let micOn = true, camOn = true, screenSharing = false;
let activeFeature = null, sidebarVisible = true, emojiPickerOpen = false;
let handRaised = false;
let ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const peers = {}, peerTiles = {}, peerInfo = {}, cursors = {}, peerColors = {};
const pendingCalls = [];
let colorIdx = 0;
const CURSOR_COLORS = ['#E60023','#2D7A2D','#0057B8','#C2185B','#6200EA','#E65100','#8B6914'];
const joinedAt = Date.now();
let roomConnected = false;

const socket = io({ reconnection: true, reconnectionDelay: 1000 });

async function checkRoomExists() {
  try {
    const r = await fetch(`/api/rooms/info/${roomCode}`, { credentials: 'include' });
    if (!r.ok) { window.location.href = `/room-not-found?code=${roomCode}`; return false; }
    const d = await r.json();
    if (d.expired) { window.location.href = `/room-not-found?code=${roomCode}&reason=expired`; return false; }
    document.getElementById('room-name-title').textContent = d.name || 'Study Room';
    document.title = `StudyRoom — ${d.name || roomCode}`;
    return true;
  } catch { return true; }
}

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('room-code-badge').textContent = roomCode;
  document.getElementById('loading-code').textContent = roomCode;
  document.getElementById('self-avatar').textContent = initials(user.name);
  document.getElementById('self-name').textContent = user.name;

  const exists = await checkRoomExists();
  if (!exists) return;

  addToPeopleList('self', user.name, true, user.guest);
  socket.emit('join-room', { roomCode, user });
  try { await requestMedia(true); } catch {}

  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  document.addEventListener('click', e => {
    const picker = document.getElementById('emoji-picker');
    const t1 = document.getElementById('emoji-trigger-btn');
    const t2 = document.getElementById('btn-emoji-bar');
    if (picker && !picker.contains(e.target) && e.target !== t1 && e.target !== t2) {
      picker.classList.remove('open'); emojiPickerOpen = false;
    }
  });

  setTimeout(() => hideLoading(), 3000);
});

socket.on('ice-config', cfg => { ICE_CONFIG = cfg; });

socket.on('room-peers', async peersArr => {
  hideLoading();
  for (const { socketId, user: u } of peersArr) {
    peerInfo[socketId] = u;
    addVideoTile(socketId, u.name, u.guest);
    addToPeopleList(socketId, u.name, false, u.guest);
    if (localStream) await callPeer(socketId);
    else pendingCalls.push(socketId);
  }
  updateVideoGrid();
});

socket.on('user-joined', ({ socketId, user: u }) => {
  peerInfo[socketId] = u;
  addVideoTile(socketId, u.name, u.guest);
  addToPeopleList(socketId, u.name, false, u.guest);
  updateVideoGrid();
  showToast(`${u.name} joined`);
  appendSysMsg(`${u.name} joined the room`);
});

socket.on('user-left', ({ socketId }) => {
  const name = peerInfo[socketId]?.name || 'Someone';
  removePeer(socketId);
  updateVideoGrid();
  showToast(`${name} left`);
  appendSysMsg(`${name} left the room`);
});

socket.on('room-count', n => {
  document.getElementById('online-count').textContent = n;
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
  if (peers[from]) try { await peers[from].addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
});

socket.on('peer-media-state', ({ socketId, video, audio }) => {
  const micEl = document.getElementById('mic-' + socketId);
  if (micEl) micEl.classList.toggle('hidden', audio);
  const tile = document.getElementById('tile-' + socketId);
  if (tile) tile.classList.toggle('cam-off', !video);
});

socket.on('reconnect', () => {
  showToast('Reconnected ✓');
  socket.emit('join-room', { roomCode, user });
});
socket.on('disconnect', reason => {
  if (reason === 'io server disconnect') showToast('Disconnected from server');
  else showToast('Connection lost — reconnecting…');
});

socket.on('room-deleted', () => {
  showToast('Room was deleted by the host');
  setTimeout(() => window.location.href = '/dashboard', 2000);
});

socket.on('join-request', ({ socketId, user: u }) => {
  const msg = `${u?.name || 'Someone'} wants to join. `;
  showToast(msg + 'Check People panel');
  addJoinRequest(socketId, u);
});
socket.on('join-approved', () => {
  document.getElementById('modal-join-request')?.classList.remove('open');
  socket.emit('join-room', { roomCode, user });
});
socket.on('join-denied', () => {
  document.getElementById('modal-join-request')?.classList.remove('open');
  showToast('Entry denied by host');
  setTimeout(() => window.location.href = '/dashboard', 2000);
});

socket.on('hand-raised', ({ socketId, name, position }) => {
  showToast(`✋ ${name} raised their hand (#${position})`);
  const tile = document.getElementById('tile-' + socketId);
  if (tile && !tile.querySelector('.tile-hand')) {
    const h = document.createElement('div');
    h.className = 'tile-hand'; h.id = 'th-' + socketId; h.textContent = '✋';
    tile.appendChild(h);
  }
});
socket.on('hand-lowered', ({ socketId }) => {
  document.getElementById('th-' + socketId)?.remove();
});
socket.on('hand-queue-update', queue => {
  const list = document.getElementById('hand-queue-list');
  const wrap = document.getElementById('hand-queue');
  if (!list || !wrap) return;
  if (!queue.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  list.innerHTML = queue.map((h, i) =>
    `<div class="hand-queue-item"><div class="hand-pos">${i+1}</div>✋ ${escapeHtml(h.name)}</div>`
  ).join('');
});

socket.on('reaction', ({ socketId, emoji }) => spawnReaction(emoji, 'tile-' + socketId));

socket.on('chat-message', ({ socketId, name, message, time }) => {
  const isMe = socketId === socket.id;
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (message === '__system__') { appendSysMsg(name); return; }
  div.className = 'chat-msg' + (isMe ? ' mine' : '');
  const isEmoji = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u200D)+$/u.test(message) && message.length <= 8;
  const isFile = message.startsWith('📎');
  let bubble;
  if (isEmoji) bubble = `<span class="emoji-msg">${escapeHtml(message)}</span>`;
  else if (isFile) bubble = `<div class="file-msg">${escapeHtml(message)}</div>`;
  else bubble = escapeHtml(message);
  div.innerHTML = `<div class="msg-sender">${escapeHtml(isMe ? 'You' : name)}<span class="msg-time">${time}</span></div><div class="msg-bubble">${bubble}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (!isMe && !document.getElementById('rsb-chat').classList.contains('active')) {
    document.getElementById('tab-chat').style.color = 'var(--warning)';
  }
});

socket.on('music-now-playing', ({ track }) => {
  const w = document.getElementById('now-playing-mini');
  const t = document.getElementById('np-title');
  if (w && t) { t.textContent = track.title || track.videoId; w.style.display = 'flex'; }
});
socket.on('music-ended', () => {
  const w = document.getElementById('now-playing-mini');
  if (w) w.style.display = 'none';
});

const videoArea = document.getElementById('video-area');
let cursorThrottle = 0;
videoArea?.addEventListener('mousemove', e => {
  const now = Date.now();
  if (now - cursorThrottle < 80) return;
  cursorThrottle = now;
  const rect = videoArea.getBoundingClientRect();
  socket.emit('cursor-move', { roomCode, x: ((e.clientX - rect.left) / rect.width * 100).toFixed(2), y: ((e.clientY - rect.top) / rect.height * 100).toFixed(2) });
});
socket.on('cursor-move', ({ socketId, name, x, y }) => {
  if (!cursors[socketId]) {
    const color = getCursorColor(socketId);
    const el = document.createElement('div');
    el.className = 'remote-cursor';
    el.innerHTML = `<div class="remote-cursor-dot" style="background:${color}"></div><div class="remote-cursor-label" style="background:${color}">${escapeHtml(name)}</div>`;
    document.getElementById('cursor-overlay')?.appendChild(el);
    cursors[socketId] = el;
  }
  Object.assign(cursors[socketId].style, { left: x + '%', top: y + '%', opacity: '1' });
});

window.addEventListener('message', e => {
  const { type, data } = e.data || {};
  if (!type) return;
  if (type === 'WHITEBOARD_DRAW') socket.emit('whiteboard-draw', { roomCode, data });
  if (type === 'WHITEBOARD_CLEAR') socket.emit('whiteboard-clear', { roomCode });
  if (type === 'TIMER_START') socket.emit('timer-start', { roomCode, duration: data.duration });
  if (type === 'TIMER_STOP') socket.emit('timer-stop', { roomCode });
  if (type === 'TIMER_REQUEST') socket.emit('timer-request', { roomCode });
  if (type === 'FILE_SHARE') {
    const { name, size } = data;
    socket.emit('chat-message', { roomCode, message: `📎 Shared: **${name}** (${formatSize(size)})` });
  }
});
socket.on('whiteboard-draw', ({ data }) => {
  const f = document.querySelector('#feat-panel-body iframe');
  if (f) f.contentWindow.postMessage({ type: 'DRAW', data }, '*');
});
socket.on('whiteboard-clear', () => {
  const f = document.querySelector('#feat-panel-body iframe');
  if (f) f.contentWindow.postMessage({ type: 'CLEAR' }, '*');
});
socket.on('whiteboard-history', ({ history }) => {
  const f = document.querySelector('#feat-panel-body iframe');
  if (f) history.forEach(d => f.contentWindow.postMessage({ type: 'DRAW', data: d }, '*'));
});
socket.on('timer-sync', d => {
  const f = document.querySelector('#feat-panel-body iframe');
  if (f) f.contentWindow.postMessage({ type: 'TIMER_SYNC', data: d }, '*');
});
socket.on('timer-done', () => {
  showToast('⏱ Timer done!', 4000);
  const f = document.querySelector('#feat-panel-body iframe');
  if (f) f.contentWindow.postMessage({ type: 'TIMER_DONE' }, '*');
});

async function requestMedia(silent = false) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const vid = document.getElementById('local-video');
    vid.srcObject = localStream; vid.classList.add('active');
    document.getElementById('self-avatar').style.display = 'none';
    document.getElementById('perm-banner').style.display = 'none';
    if (!silent) showToast('Camera & mic connected!');
    socket.emit('media-state', { roomCode, video: true, audio: true });
    for (const sid of pendingCalls) await callPeer(sid);
    pendingCalls.length = 0;
  } catch (e) {
    if (!silent) showToast('Could not access camera/mic');
    throw e;
  }
}

function toggleMic() {
  if (!localStream) { showToast('Click Allow Access first'); return; }
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  document.getElementById('btn-mic').classList.toggle('off', !micOn);
  document.getElementById('btn-mic').textContent = micOn ? '🎤' : '🔇';
  document.getElementById('self-mic-off').classList.toggle('hidden', micOn);
  socket.emit('media-state', { roomCode, video: camOn, audio: micOn });
  showToast(micOn ? 'Mic on' : 'Mic off');
}

function toggleCam() {
  if (!localStream) { showToast('Click Allow Access first'); return; }
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  document.getElementById('btn-cam').classList.toggle('off', !camOn);
  document.getElementById('btn-cam').textContent = camOn ? '📷' : '📷';
  const vid = document.getElementById('local-video');
  vid.classList.toggle('active', camOn);
  document.getElementById('self-avatar').style.display = camOn ? 'none' : 'flex';
  document.getElementById('tile-self')?.classList.toggle('cam-off', !camOn);
  socket.emit('media-state', { roomCode, video: camOn, audio: micOn });
  showToast(camOn ? 'Camera on' : 'Camera off');
}

async function toggleScreen() {
  if (screenSharing) {
    screenStream?.getTracks().forEach(t => t.stop());
    screenSharing = false;
    const camTrack = localStream?.getVideoTracks()[0];
    if (camTrack) replaceVideoTrack(camTrack);
    const vid = document.getElementById('local-video');
    if (localStream) vid.srcObject = localStream;
    document.getElementById('btn-screen').classList.remove('active');
    showToast('Screen share stopped');
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    screenSharing = true;
    const track = screenStream.getVideoTracks()[0];
    const vid = document.getElementById('local-video');
    vid.srcObject = screenStream; vid.classList.add('active');
    replaceVideoTrack(track);
    track.onended = () => toggleScreen();
    document.getElementById('btn-screen').classList.add('active');
    showToast('Sharing screen');
  } catch (e) {
    if (e.name !== 'NotAllowedError') showToast('Screen share failed: ' + e.message);
  }
}

function replaceVideoTrack(track) {
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender && track) sender.replaceTrack(track);
  });
}

function createPeer(socketId) {
  const pc = new RTCPeerConnection(ICE_CONFIG);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const remoteStream = new MediaStream();
  pc.ontrack = e => {
    if (!e.streams?.[0]) return;
    e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
    const vid = document.getElementById('vid-' + socketId);
    if (vid) { vid.srcObject = remoteStream; vid.classList.add('active'); }
    document.getElementById('av-' + socketId)?.style && (document.getElementById('av-' + socketId).style.display = 'none');
  };
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { to: socketId, candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) removePeer(socketId);
    updateQualityIndicator(socketId, pc);
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

async function updateQualityIndicator(socketId, pc) {
  try {
    const stats = await pc.getStats();
    let rtt = null;
    stats.forEach(r => { if (r.type === 'candidate-pair' && r.state === 'succeeded') rtt = r.currentRoundTripTime; });
    const el = document.getElementById('qual-' + socketId);
    if (!el) return;
    el.className = 'tile-quality ' + (rtt === null ? '' : rtt < 0.1 ? 'good' : rtt < 0.3 ? 'fair' : 'poor');
  } catch {}
}

setInterval(() => { Object.keys(peers).forEach(sid => updateQualityIndicator(sid, peers[sid])); }, 5000);

function updateVideoGrid() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  const count = grid.querySelectorAll('.video-tile').length;
  grid.dataset.peers = count <= 4 ? String(count) : 'many';
  grid.style.display = 'none'; grid.offsetHeight; grid.style.display = '';
}
window.addEventListener('resize', updateVideoGrid);

function addVideoTile(socketId, name, guest = false) {
  const grid = document.getElementById('video-grid');
  const div = document.createElement('div');
  div.className = 'video-tile'; div.id = 'tile-' + socketId;
  div.innerHTML = `<video id="vid-${socketId}" autoplay playsinline></video>
    <div class="tile-avatar" id="av-${socketId}">${initials(name)}</div>
    <div class="tile-name" id="nm-${socketId}">${escapeHtml(name)}</div>
    <div class="tile-mic-off hidden" id="mic-${socketId}">🔇</div>
    <div class="tile-quality" id="qual-${socketId}"></div>
    ${guest ? '<div class="tile-guest-tag">Guest</div>' : ''}`;
  grid.appendChild(div);
  peerTiles[socketId] = div;
}

function removePeer(socketId) {
  if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
  peerTiles[socketId]?.remove(); delete peerTiles[socketId];
  cursors[socketId]?.remove(); delete cursors[socketId];
  delete peerInfo[socketId];
  document.getElementById('peer-row-' + socketId)?.remove();
  document.getElementById('th-' + socketId)?.remove();
}

function addToPeopleList(socketId, name, isYou = false, guest = false) {
  const list = document.getElementById('people-list');
  const div = document.createElement('div');
  div.className = 'peer-row'; div.id = 'peer-row-' + socketId;
  div.innerHTML = `<div class="peer-av">${initials(name)}</div>
    <div class="peer-name">${escapeHtml(name)}</div>
    ${isYou ? '<span class="peer-you">You</span>' : ''}
    ${guest && !isYou ? '<span class="peer-guest">Guest</span>' : ''}`;
  list.appendChild(div);
}

function addJoinRequest(socketId, u) {
  const list = document.getElementById('people-list');
  const div = document.createElement('div');
  div.className = 'peer-row'; div.id = 'req-' + socketId;
  div.style.background = 'var(--accent-light)';
  div.innerHTML = `<div class="peer-av" style="background:var(--warning)">${initials(u?.name)}</div>
    <div class="peer-name">${escapeHtml(u?.name || 'Guest')} <span style="color:var(--muted);font-size:11px">wants to join</span></div>
    <button onclick="approveJoin('${socketId}')" style="background:var(--success);color:#fff;border:none;border-radius:var(--radius-xs);padding:4px 8px;font-size:11px;cursor:pointer;margin-right:4px">✓</button>
    <button onclick="denyJoin('${socketId}')" style="background:var(--danger);color:#fff;border:none;border-radius:var(--radius-xs);padding:4px 8px;font-size:11px;cursor:pointer">✗</button>`;
  list.appendChild(div);
  setTab('people');
}
function approveJoin(sid) { socket.emit('join-approve', { targetSocketId: sid }); document.getElementById('req-' + sid)?.remove(); }
function denyJoin(sid) { socket.emit('join-deny', { targetSocketId: sid }); document.getElementById('req-' + sid)?.remove(); }

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat-message', { roomCode, message: msg });
  input.value = '';
}
function sendEmojiToChat(emoji) {
  socket.emit('chat-message', { roomCode, message: emoji });
  document.getElementById('emoji-picker').classList.remove('open');
  emojiPickerOpen = false;
}
function appendSysMsg(text) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'sys-msg'; div.textContent = text;
  msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
}

function sendReaction(emoji) {
  socket.emit('send-reaction', { roomCode, emoji });
  spawnReaction(emoji, 'tile-self');
  document.getElementById('emoji-picker').classList.remove('open');
  emojiPickerOpen = false;
}

function spawnReaction(emoji, tileId) {
  const tile = document.getElementById(tileId);
  if (!tile) return;
  const span = document.createElement('span');
  span.className = 'reaction-burst'; span.textContent = emoji;
  span.style.left = (Math.random() * 50 + 25) + '%';
  span.style.bottom = '20%';
  tile.appendChild(span);
  setTimeout(() => span.remove(), 1200);
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  const btn = document.getElementById('emoji-trigger-btn') || document.getElementById('btn-emoji-bar');
  const rect = btn.getBoundingClientRect();
  picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  picker.style.left = rect.left + 'px';
  picker.style.right = 'auto';
  emojiPickerOpen = !emojiPickerOpen;
  picker.classList.toggle('open', emojiPickerOpen);
}

function toggleHand() {
  handRaised = !handRaised;
  socket.emit('raise-hand', { roomCode });
  const btn = document.getElementById('btn-hand');
  btn.classList.toggle('hand-raised', handRaised);
  showToast(handRaised ? 'Hand raised ✋' : 'Hand lowered');
}

function skipTrack() { socket.emit('music-skip', { roomCode }); }

function setTab(tab) {
  document.querySelectorAll('.rsb-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.rsb-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('rsb-' + tab).classList.add('active');
  document.getElementById('tab-' + tab).style.color = '';
  if (tab === 'chat') {
    setTimeout(() => { const m = document.getElementById('chat-messages'); m.scrollTop = m.scrollHeight; }, 50);
  }
}

const FEATURES = {
  whiteboard: { title: '✏️ Whiteboard', src: '/features/whiteboard/index.html' },
  timer: { title: '⏱ Pomodoro Timer', src: '/features/timer/index.html' },
  files: { title: '📁 File Sharing', src: '/features/files/index.html' },
  notes: { title: '📝 Shared Notes', src: '/features/notes/index.html' }
};

function toggleFeature(name) {
  const wrap = document.getElementById('feat-panel-wrap');
  const va = document.getElementById('video-area');
  if (activeFeature === name) { closeFeature(); return; }
  activeFeature = name;
  document.querySelectorAll('.feat-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('feat-' + (name === 'whiteboard' ? 'wb' : name))?.classList.add('active');
  const f = FEATURES[name];
  document.getElementById('feat-panel-title').textContent = f.title;
  const isHost = storedUser && !user.guest;
  document.getElementById('feat-panel-body').innerHTML =
    `<iframe src="${f.src}?room=${roomCode}&host=${isHost}" style="width:100%;height:100%;border:none;flex:1" allow="camera;microphone"></iframe>`;
  if (name === 'whiteboard') { setTimeout(() => { const fr = document.querySelector('#feat-panel-body iframe'); if (fr) socket.emit('whiteboard-request', { roomCode }); }, 500); }
  wrap.classList.add('open'); va.classList.add('feat-open');
}

function closeFeature() {
  activeFeature = null;
  document.querySelectorAll('.feat-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('feat-panel-wrap').classList.remove('open');
  document.getElementById('video-area').classList.remove('feat-open');
  document.getElementById('feat-panel-body').innerHTML = '';
}

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  document.getElementById('room-sidebar').classList.toggle('collapsed', !sidebarVisible);
}

function hideLoading() {
  const el = document.getElementById('room-loading');
  if (el) { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }
}

async function logSession() {
  if (!storedUser) return;
  const duration = Math.floor((Date.now() - joinedAt) / 1000);
  if (duration < 10) return;
  try {
    await API.post('/api/stats/session', { room_code: roomCode, room_name: document.getElementById('room-name-title')?.textContent || roomCode, duration_seconds: duration });
  } catch {}
}

function leaveRoom() {
  logSession();
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(pc => pc.close());
  socket.disconnect();
  sessionStorage.removeItem('sr_guest');
  window.location.href = storedUser ? '/dashboard' : '/login';
}

window.addEventListener('beforeunload', () => { logSession(); localStream?.getTracks().forEach(t => t.stop()); });

function getCursorColor(sid) {
  if (!peerColors[sid]) { peerColors[sid] = CURSOR_COLORS[colorIdx % CURSOR_COLORS.length]; colorIdx++; }
  return peerColors[sid];
}
