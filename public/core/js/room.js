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

const CURSOR_COLORS = ['#00B894', '#4ECDC4', '#FF6B6B', '#FFA502', '#A29BFE', '#FD79A8', '#00B894', '#FDCB6E'];
let colorIdx = 0;
const peerColors = {};
const peers = {};
const peerTiles = {};
const peerInfo = {};
const cursors = {};
const dataChannels = {}; // socketId → RTCDataChannel (for file transfer)

let localStream = null;
let screenStream = null;
let micOn = true;
let camOn = true;
let screenSharing = false;
let activeFeature = null;
let sidebarVisible = true;
let emojiPickerOpen = false;
let pendingRoomGameInvite = null;
let focusModeActive = false;
let focusInterval = null;
let focusBlobUrl = null;
let focusSecondsLeft = 0;
const FOCUS_PREFS_KEY = 'sr_focus_prefs';

// Raise hand (5s hold, priority grid, tap to lower)
const HAND_HOLD_MS = 5000;
const HAND_MIC_GRANT_MS = 5000;
let myHandRaised = false;
let handHoldTimer = null;
const raisedHandOrder = []; // socketIds first = front of grid

// Active Speakers Tracking
let activeSpeakers = [];
let audioCtx = null;
let analyser = null;
let dataArray = null;
let localAudioSource = null;

function checkLocalAudio() {
  if (!micOn || !localStream) return 0;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const track = localStream.getAudioTracks()[0];
      if (track) {
        localAudioSource = audioCtx.createMediaStreamSource(new MediaStream([track]));
        localAudioSource.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
      }
    }
    if (!analyser || !dataArray) return 0;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    return sum / dataArray.length;
  } catch (e) { return 0; }
}

async function monitorActiveSpeakers() {
  if (Object.keys(peers).length === 0 && !localStream) return;
  
  let currentSpeakers = [];
  
  // Check local user audio level
  const localVol = checkLocalAudio();
  if (localVol > 10) currentSpeakers.push('self');
  
  // Check remote peers audio level via WebRTC stats
  for (const [sid, pc] of Object.entries(peers)) {
    if (!pc) continue;
    try {
      const stats = await pc.getStats();
      let level = 0;
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
          if (typeof report.audioLevel === 'number') level = report.audioLevel;
        }
      });
      // audioLevel is 0.0 to 1.0. Typically > 0.01 means someone is speaking.
      if (level > 0.01) currentSpeakers.push(sid);
    } catch(e) {}
  }
  
  const changed = JSON.stringify(currentSpeakers) !== JSON.stringify(activeSpeakers);
  if (changed) {
    activeSpeakers = currentSpeakers;
    updateVideoGrid();
  }
}
setInterval(monitorActiveSpeakers, 300);

// Pinning / Spotlight state
let pinnedSocketId = null; // null = normal grid, 'self' or socketId = pinned

// ── FIX 4: Add TURN servers for real-world NAT traversal.
// STUN-only works on open networks. Behind firewalls, mobile networks,
// or cloud VMs (which is almost all deployments), STUN fails silently.
// Replace the placeholder credentials with your own TURN server or a
// free provider such as Metered (metered.ca) or Twilio NTS.
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // ── ADD YOUR TURN CREDENTIALS HERE ──────────────────────────
    // Example with Metered.ca free tier:
    // {
    //   urls: 'turn:your-subdomain.metered.live:80',
    //   username: 'YOUR_USERNAME',
    //   credential: 'YOUR_CREDENTIAL'
    // },
    // {
    //   urls: 'turn:your-subdomain.metered.live:443?transport=tcp',
    //   username: 'YOUR_USERNAME',
    //   credential: 'YOUR_CREDENTIAL'
    // }
    // ────────────────────────────────────────────────────────────
  ],
  // FIX: also request 'all' candidates so trickle ICE doesn't stall
  iceCandidatePoolSize: 10
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

  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  document.addEventListener('click', e => {
    const picker = document.getElementById('emoji-picker');
    const triggerBtn = document.getElementById('emoji-trigger-btn');
    const triggerBarBtn = document.getElementById('btn-emoji-bar');
    const path = e.composedPath();
    const clickedTrigger = path.includes(triggerBtn) || path.includes(triggerBarBtn);
    if (!picker.contains(e.target) && !clickedTrigger) {
      picker.classList.remove('open');
      emojiPickerOpen = false;
    }
  });

  // Show pre-join modal first — user sets cam/mic/device then joins
  await initPrejoinModal();

  fetchRoomInfo();
  initSidebarResize();
  updateVideoGrid();
});

// ── PRE-JOIN MODAL ─────────────────────────────────────────────
const PJ_PREFS_KEY = 'sr_prejoin_prefs';
let _prejoinStream = null;
let _pjCamOn = true;
let _pjMicOn = true;
let _pjCamId = null;
let _pjMicId = null;

async function initPrejoinModal() {
  // Load saved prefs
  const saved = JSON.parse(localStorage.getItem(PJ_PREFS_KEY) || '{}');
  _pjCamOn = saved.camOn !== false;
  _pjMicOn = saved.micOn !== false;
  _pjCamId = saved.camId || null;
  _pjMicId = saved.micId || null;

  document.getElementById('prejoin-name-label').textContent = user.name;
  document.getElementById('prejoin-modal').classList.add('open');

  // Populate device lists
  await _populatePrejoinDevices();
  // Start preview
  await _startPrejoinPreview();
  // Apply saved toggles
  _updatePrejoinUI();
  if (window.lucide) lucide.createIcons();
}

async function _populatePrejoinDevices() {
  try {
    // Request permission first so labels are available
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch { /* denied — lists will be empty */ }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const camSel = document.getElementById('pj-cam-select');
  const micSel = document.getElementById('pj-mic-select');
  const spkSel = document.getElementById('pj-spk-select');

  const fill = (sel, list, savedId) => {
    sel.innerHTML = list.map((d, i) =>
      `<option value="${d.deviceId}" ${d.deviceId === savedId ? 'selected' : ''}>${d.label || `Device ${i+1}`}</option>`
    ).join('');
  };

  fill(camSel, devices.filter(d => d.kind === 'videoinput'),  _pjCamId);
  fill(micSel, devices.filter(d => d.kind === 'audioinput'),  _pjMicId);
  fill(spkSel, devices.filter(d => d.kind === 'audiooutput'), null);
}

async function _startPrejoinPreview() {
  if (_prejoinStream) { _prejoinStream.getTracks().forEach(t => t.stop()); }
  try {
    const constraints = {
      video: _pjCamOn ? { deviceId: _pjCamId ? { exact: _pjCamId } : undefined } : false,
      audio: _pjMicOn ? { deviceId: _pjMicId ? { exact: _pjMicId } : undefined } : false,
    };
    _prejoinStream = await navigator.mediaDevices.getUserMedia(constraints);
    document.getElementById('prejoin-video').srcObject = _prejoinStream;
  } catch {
    _prejoinStream = null;
  }
}

function _updatePrejoinUI() {
  const camBtn  = document.getElementById('pj-cam-btn');
  const micBtn  = document.getElementById('pj-mic-btn');
  const camOff  = document.getElementById('prejoin-cam-off');

  document.getElementById('pj-cam-label').textContent = _pjCamOn ? 'Camera On'  : 'Camera Off';
  document.getElementById('pj-mic-label').textContent = _pjMicOn ? 'Mic On'     : 'Mic Off';

  camBtn.style.background = _pjCamOn ? 'rgba(99,102,241,0.12)' : 'var(--bg3)';
  camBtn.style.borderColor = _pjCamOn ? 'var(--accent)'        : 'var(--border)';
  camBtn.style.color       = _pjCamOn ? 'var(--accent)'        : 'var(--muted)';

  micBtn.style.background  = _pjMicOn ? 'rgba(34,197,94,0.1)'  : 'var(--bg3)';
  micBtn.style.borderColor = _pjMicOn ? 'var(--success,#22c55e)': 'var(--border)';
  micBtn.style.color       = _pjMicOn ? 'var(--success,#22c55e)': 'var(--muted)';

  if (camOff) camOff.style.display = _pjCamOn ? 'none' : 'flex';
}

async function prejoinToggleCam() {
  _pjCamOn = !_pjCamOn;
  if (!_pjCamOn && _prejoinStream) {
    _prejoinStream.getVideoTracks().forEach(t => { t.stop(); _prejoinStream.removeTrack(t); });
    document.getElementById('prejoin-video').srcObject = null;
  } else if (_pjCamOn) {
    await _startPrejoinPreview();
  }
  _updatePrejoinUI();
  if (window.lucide) lucide.createIcons();
}

function prejoinToggleMic() {
  _pjMicOn = !_pjMicOn;
  if (_prejoinStream) _prejoinStream.getAudioTracks().forEach(t => t.enabled = _pjMicOn);
  _updatePrejoinUI();
  if (window.lucide) lucide.createIcons();
}

async function prejoinSwitchCam(deviceId) {
  _pjCamId = deviceId;
  if (_pjCamOn) await _startPrejoinPreview();
}
async function prejoinSwitchMic(deviceId) {
  _pjMicId = deviceId;
  if (_pjMicOn) await _startPrejoinPreview();
}

async function prejoinConfirm() {
  // Save preferences
  localStorage.setItem(PJ_PREFS_KEY, JSON.stringify({
    camOn: _pjCamOn, micOn: _pjMicOn, camId: _pjCamId, micId: _pjMicId
  }));

  // Apply to global state
  camOn = _pjCamOn;
  micOn = _pjMicOn;

  // Stop preview stream — requestMedia will create the real one
  if (_prejoinStream) { _prejoinStream.getTracks().forEach(t => t.stop()); _prejoinStream = null; }

  // Close modal
  document.getElementById('prejoin-modal').classList.remove('open');

  // Now do the real media + join
  try {
    const constraints = {
      video: camOn ? { deviceId: _pjCamId ? { exact: _pjCamId } : undefined } : false,
      audio: micOn ? { deviceId: _pjMicId ? { exact: _pjMicId } : undefined } : false,
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    const vid = document.getElementById('local-video');
    vid.srcObject = localStream;
    vid.classList.add('active');
    document.getElementById('self-avatar').style.display = 'none';
    document.getElementById('self-name').style.display = 'none';
    document.getElementById('perm-banner').style.display = 'none';
    if (!micOn) localStream.getAudioTracks().forEach(t => t.enabled = false);
    if (!camOn) localStream.getVideoTracks().forEach(t => t.enabled = false);
  } catch { /* user denied — join without media */ }

  socket.emit('join-room', { roomCode, user });
  // Broadcast Walled Garden presence with visibility context
  if (roomInfoCache) {
    socket.emit('update-status', { 
      status: 'in-room', 
      context: { roomCode, roomName: roomInfoCache.name },
      visibility: roomInfoCache.visibility 
    });
  }
  MusicBot.init(socket, roomCode);
  socket.emit('media-state', { roomCode, video: camOn, audio: micOn });
}

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
    const delta = startX - e.clientX;
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

async function ensureLocalStream(wantVideo, wantAudio) {
  if (localStream && ((wantAudio && localStream.getAudioTracks().length) || (wantVideo && localStream.getVideoTracks().length))) {
    return localStream;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: wantVideo ? { deviceId: _pjCamId ? { exact: _pjCamId } : undefined } : false,
      audio: wantAudio ? { deviceId: _pjMicId ? { exact: _pjMicId } : undefined } : false,
    });
    if (!localStream) localStream = stream;
    else {
      stream.getTracks().forEach(t => {
        const existing = localStream.getTracks().find(x => x.kind === t.kind);
        if (existing) localStream.removeTrack(existing);
        localStream.addTrack(t);
      });
    }
    const vid = document.getElementById('local-video');
    if (wantVideo && localStream.getVideoTracks().length) {
      vid.srcObject = localStream;
      vid.classList.add('active');
      document.getElementById('self-avatar').style.display = 'none';
      document.getElementById('self-name').style.display = 'none';
      document.getElementById('self-cam-off')?.classList.add('hidden');
    }
    document.getElementById('perm-banner').style.display = 'none';
    return localStream;
  } catch {
    showToast('Could not access microphone/camera');
    return null;
  }
}

async function toggleMic() {
  if (!localStream?.getAudioTracks().length) {
    const s = await ensureLocalStream(camOn, true);
    if (!s) return;
    micOn = true;
  } else {
    micOn = !micOn;
    localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  }
  const btn = document.getElementById('btn-mic');
  btn.innerHTML = micOn
    ? '<i data-lucide="mic" style="width:20px;height:20px"></i><span class="ctrl-label">Mute</span><span id="mic-status-dot" style="position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#22c55e;border:2px solid var(--bg,#fff);transition:background 0.2s"></span>'
    : '<i data-lucide="mic-off" style="width:20px;height:20px"></i><span class="ctrl-label">Unmute</span><span id="mic-status-dot" style="position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#ef4444;border:2px solid var(--bg,#fff);transition:background 0.2s"></span>';
  btn.classList.toggle('off', !micOn);
  document.getElementById('self-mic-off').classList.toggle('hidden', micOn);
  socket.emit('media-state', { roomCode, video: camOn, audio: micOn });
  showToast(micOn ? 'Mic on' : 'Mic off');
  if (window.lucide) lucide.createIcons();
}

async function toggleCam() {
  const btn = document.getElementById('btn-cam');
  const vid = document.getElementById('local-video');
  const tileSelf = document.getElementById('tile-self');

  if (camOn) {
    // Stop the hardware track so the LED goes out
    localStream.getVideoTracks().forEach(t => {
      t.stop();
      localStream.removeTrack(t);
    });
    camOn = false;
    vid.srcObject = null;
    vid.classList.remove('active');
    if (tileSelf) tileSelf.classList.add('cam-off');
    document.getElementById('self-avatar').style.display = 'flex';
    document.getElementById('self-name').style.display = 'block';
    btn.innerHTML = '<i data-lucide="video-off" style="width:20px;height:20px"></i><span class="ctrl-label">Start Video</span><span id="cam-status-dot" style="position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#ef4444;border:2px solid var(--bg,#fff);transition:background 0.2s"></span>';
    btn.classList.add('off');
    document.getElementById('self-cam-off')?.classList.remove('hidden');
    // ── FIX 3a: Tell peers the camera is off (track was stopped, not
    // just disabled, so replaceTrack with null to signal black screen)
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(null).catch(() => { });
    });
    socket.emit('media-state', { roomCode, video: false, audio: micOn });
    showToast('Camera off');
    if (window.lucide) lucide.createIcons();
  } else {
    if (!localStream) {
      const s = await ensureLocalStream(true, micOn);
      if (!s) return;
      camOn = true;
      btn.innerHTML = '<i data-lucide="video" style="width:20px;height:20px"></i><span class="ctrl-label">Stop Video</span><span id="cam-status-dot" style="position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#22c55e;border:2px solid var(--bg,#fff);transition:background 0.2s"></span>';
      btn.classList.remove('off');
      document.getElementById('self-cam-off')?.classList.add('hidden');
      socket.emit('media-state', { roomCode, video: true, audio: micOn });
      if (window.lucide) lucide.createIcons();
      return;
    }
    // Request a fresh video track
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(newStream => {
        const newTrack = newStream.getVideoTracks()[0];

        // ── FIX 2: Properly add the new track to localStream AND
        // replace it in every existing peer connection.
        localStream.addTrack(newTrack);
        vid.srcObject = localStream;
        vid.classList.add('active');

        // Replace in peers; if no sender exists yet (peer joined while
        // cam was off), we need to add + renegotiate instead.
        Object.values(peers).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null);
          if (sender) {
            sender.replaceTrack(newTrack).catch(() => { });
          } else {
            // No video sender — add the track and renegotiate
            pc.addTrack(newTrack, localStream);
            renegotiate(pc, Object.keys(peers).find(id => peers[id] === pc));
          }
        });

        camOn = true;
        if (tileSelf) tileSelf.classList.remove('cam-off');
        document.getElementById('self-avatar').style.display = 'none';
        document.getElementById('self-name').style.display = 'none';
        btn.innerHTML = '<i data-lucide="video" style="width:20px;height:20px"></i><span class="ctrl-label">Stop Video</span><span id="cam-status-dot" style="position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#22c55e;border:2px solid var(--bg,#fff);transition:background 0.2s"></span>';
        btn.classList.remove('off');
        document.getElementById('self-cam-off')?.classList.add('hidden');
        socket.emit('media-state', { roomCode, video: true, audio: micOn });
        showToast('Camera on');
        if (window.lucide) lucide.createIcons();
      })
      .catch(() => showToast('Could not restart camera'));
  }
}

async function toggleScreen() {
  if (screenSharing) {
    screenStream?.getTracks().forEach(t => t.stop());
    screenSharing = false;
    const btn = document.getElementById('btn-screen');
    btn.classList.remove('active');
    btn.innerHTML = '<i data-lucide="monitor" style="width:20px;height:20px"></i><span class="ctrl-label">Share</span>';
    const camTrack = localStream?.getVideoTracks()[0] ?? null;
    replaceVideoTrack(camTrack);
    // Remove screen-share styling from self tile
    document.getElementById('tile-self')?.classList.remove('screen-share-tile');
    socket.emit('screen-share-stopped', { roomCode });
    // Unpin if self was pinned as screen share
    if (pinnedSocketId === 'self') unpinAll();
    showToast('Screen share stopped');
    if (window.lucide) lucide.createIcons();
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenSharing = true;
    const btn = document.getElementById('btn-screen');
    btn.classList.add('active');
    btn.innerHTML = '<i data-lucide="square" style="width:20px;height:20px;fill:currentColor"></i><span class="ctrl-label">Stop Share</span>';
    replaceVideoTrack(screenStream.getVideoTracks()[0]);
    screenStream.getVideoTracks()[0].onended = () => toggleScreen();
    // Mark self tile as screen share + auto-pin for local user
    document.getElementById('tile-self')?.classList.add('screen-share-tile');
    socket.emit('screen-share-started', { roomCode });
    pinTile('self'); // spotlight own screen for local user
    showToast('Screen sharing started');
    if (window.lucide) lucide.createIcons();
  } catch { showToast('Screen share cancelled'); }
}

// ── FIX 1: replaceVideoTrack now handles null gracefully and logs
// failures so you can see in DevTools if a sender is missing.
function replaceVideoTrack(track) {
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null);
    if (sender) {
      sender.replaceTrack(track).catch(err => {
        console.warn('[replaceVideoTrack] replaceTrack failed:', err);
      });
    } else {
      console.warn('[replaceVideoTrack] No video sender found for peer', pc);
    }
  });
}

// ── FIX 3b: renegotiate — creates a new offer and sends it to a peer
// after the track set changes (e.g. cam re-enabled after being off).
async function renegotiate(pc, socketId) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: socketId, offer, renegotiate: true });
  } catch (err) {
    console.warn('[renegotiate] failed:', err);
  }
}

// ── WebRTC ─────────────────────────────────────────────────────
function createPeer(socketId) {
  const pc = new RTCPeerConnection(ICE_CONFIG);

  // ── FIX 2: Guard against null localStream; also add tracks one by
  // one to avoid "track already added" errors on renegotiation.
  if (localStream) {
    localStream.getTracks().forEach(t => {
      try { pc.addTrack(t, localStream); } catch (e) { /* already added */ }
    });
  }

  const remoteStream = new MediaStream();
  pc.ontrack = e => {
    // addTrack may fire for existing tracks on renegotiation — only
    // add the track if it isn't in the stream already.
    if (!remoteStream.getTracks().find(t => t.id === e.track.id)) {
      remoteStream.addTrack(e.track);
    }
    const vid = document.getElementById('vid-' + socketId);
    if (vid) {
      vid.srcObject = remoteStream;
      // Only mark active if the track is live (not ended/muted)
      if (e.track.readyState === 'live') vid.classList.add('active');
      const av = document.getElementById('av-' + socketId);
      const nm = document.getElementById('nm-' + socketId);
      if (av) av.style.display = 'none';
      if (nm) nm.style.display = 'none';
    }
  };

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { to: socketId, candidate: e.candidate });
  };

  // ── FIX: log ICE failures so they surface in DevTools
  pc.oniceconnectionstatechange = () => {
    console.log(`[ICE ${socketId}] state:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      console.warn(`[ICE ${socketId}] Failed — restart ICE or check TURN config`);
      pc.restartIce();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[PC ${socketId}] connection:`, pc.connectionState);
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) removePeer(socketId);
  };

  // ── FIX: handle incoming renegotiation offers from the remote peer
  pc.onnegotiationneeded = async () => {
    // Only the offerer side should react — skip if we're already in
    // a signalling exchange (signalingState !== 'stable').
    if (pc.signalingState !== 'stable') return;
    await renegotiate(pc, socketId);
  };

  // ── Data Channel for file transfer ─────────────────────────────
  // Offerer creates the channel; answerer receives it via ondatachannel.
  const dc = pc.createDataChannel('fileTransfer', { ordered: true });
  setupDataChannel(dc, socketId);
  pc.ondatachannel = e => setupDataChannel(e.channel, socketId);

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
// ── INTELLIGENT VIDEO GRID LAYOUT ENGINE ─────────────────────────
// Computes optimal columns/rows based on participant count + container
// aspect ratio, mimicking Google Meet / Zoom layout intelligence.
function updateVideoGrid() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  // If pinned spotlight mode is active, layout is handled by CSS + buildThumbStrip()
  if (pinnedSocketId) return;

  let tiles = Array.from(grid.querySelectorAll('.video-tile'));
  
  // Priority: raised hands first, then active speakers
  tiles.sort((a, b) => {
    const aid = a.id.replace('tile-', '');
    const bid = b.id.replace('tile-', '');
    const aHand = raisedHandOrder.indexOf(aid);
    const bHand = raisedHandOrder.indexOf(bid);
    const aActive = activeSpeakers.includes(aid) ? 1 : 0;
    const bActive = activeSpeakers.includes(bid) ? 1 : 0;
    
    // 1. Raised hands have absolute priority
    if (aHand !== -1 && bHand !== -1) return aHand - bHand;
    if (aHand !== -1) return -1;
    if (bHand !== -1) return 1;
    
    // 2. Active speakers come next
    if (aActive > bActive) return -1;
    if (bActive > aActive) return 1;
    
    // 3. Keep stable order otherwise
    return 0;
  });
  
  tiles.forEach(t => grid.appendChild(t));
  
  tiles.forEach(t => {
    const sid = t.id.replace('tile-', '');
    t.classList.toggle('hand-priority', raisedHandOrder.includes(sid));
    t.classList.toggle('active-speaker', activeSpeakers.includes(sid));
  });
  const count = tiles.length;
  if (count === 0) return;

  // Get container dimensions for aspect-ratio-aware layout
  const container = grid.parentElement;
  const W = container ? container.clientWidth : window.innerWidth;
  const H = container ? container.clientHeight : window.innerHeight;
  const containerAspect = W / H;

  let cols, rows;

  if (count === 1) {
    cols = 1; rows = 1;
  } else if (count === 2) {
    // Wide container → side by side; tall/portrait → stacked
    if (containerAspect > 1.2) { cols = 2; rows = 1; }
    else { cols = 1; rows = 2; }
  } else if (count === 3) {
    // Wide: 3 side-by-side or 2+1; Tall: 1+2
    if (containerAspect > 1.6) { cols = 3; rows = 1; }
    else { cols = 2; rows = 2; } // 2x2 with one empty — balanced
  } else if (count === 4) {
    cols = 2; rows = 2;
  } else if (count === 5) {
    // Wide: 3+2; Tall: 2+3
    if (containerAspect > 1.2) { cols = 3; rows = 2; }
    else { cols = 2; rows = 3; }
  } else if (count === 6) {
    cols = 3; rows = 2;
  } else if (count <= 9) {
    cols = 3; rows = 3;
  } else if (count <= 12) {
    cols = 4; rows = 3;
  } else if (count <= 16) {
    cols = 4; rows = 4;
  } else if (count <= 20) {
    cols = 5; rows = 4;
  } else if (count <= 25) {
    cols = 5; rows = 5;
  } else {
    // Large group: best-fit columns based on container width
    cols = Math.ceil(Math.sqrt(count * containerAspect));
    rows = Math.ceil(count / cols);
  }

  // Apply grid via inline style (overrides data-peers CSS) for precise control
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.style.overflow = (count > 25) ? 'auto' : 'hidden';

  // Remove static data-peers attribute — we now control layout via style
  grid.removeAttribute('data-peers');
  grid.classList.remove('layout-single', 'layout-duo', 'layout-quad', 'layout-many');

  // Center the last row if it has fewer tiles than columns (avoid orphaned tiles)
  tiles.forEach((tile, i) => {
    const isLastRow = i >= (rows - 1) * cols;
    const tilesInLastRow = count - (rows - 1) * cols;
    const isOrphaned = isLastRow && tilesInLastRow < cols;

    // Reset any previous centering
    tile.style.gridColumn = '';
    tile.style.justifySelf = '';

    if (isOrphaned) {
      // Calculate how many empty cells exist in the last row
      const emptySlots = cols - tilesInLastRow;
      const startCol = Math.floor(emptySlots / 2) + 1;
      if (i === (rows - 1) * cols) {
        // First tile in orphaned last row — center the group
        tile.style.gridColumnStart = String(startCol);
      }
    }
  });
}

// Re-run layout on window resize with debounce for performance
let _gridResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_gridResizeTimer);
  _gridResizeTimer = setTimeout(updateVideoGrid, 80);
});

// ── PINNING / SPOTLIGHT ────────────────────────────────────────
function pinTile(socketId) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  // Remove previous pinned state
  grid.querySelectorAll('.video-tile').forEach(t => {
    t.classList.remove('pinned-tile');
    const btn = t.querySelector('.tile-pin-btn');
    if (btn) btn.classList.remove('pinned-active');
  });

  if (pinnedSocketId === socketId) {
    // Toggle off — unpin
    unpinAll(); return;
  }

  pinnedSocketId = socketId;
  const tileId = socketId === 'self' ? 'tile-self' : 'tile-' + socketId;
  const tile = document.getElementById(tileId);
  if (tile) {
    tile.classList.add('pinned-tile');
    const btn = tile.querySelector('.tile-pin-btn');
    if (btn) btn.classList.add('pinned-active');
  }
  grid.classList.add('pinned');
  buildThumbStrip();
}

function unpinAll() {
  pinnedSocketId = null;
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  grid.classList.remove('pinned');
  grid.querySelectorAll('.video-tile').forEach(t => {
    t.classList.remove('pinned-tile');
    const btn = t.querySelector('.tile-pin-btn');
    if (btn) btn.classList.remove('pinned-active');
  });
  // Remove thumb strip
  const strip = document.getElementById('thumb-strip');
  if (strip) strip.remove();
  updateVideoGrid();
}

function buildThumbStrip() {
  // Remove existing strip
  const old = document.getElementById('thumb-strip');
  if (old) old.remove();

  const videoArea = document.getElementById('video-area');
  const strip = document.createElement('div');
  strip.className = 'thumb-strip';
  strip.id = 'thumb-strip';

  // Add all tiles EXCEPT the pinned one as thumbnails
  const grid = document.getElementById('video-grid');
  grid.querySelectorAll('.video-tile').forEach(tile => {
    if (tile.classList.contains('pinned-tile')) return;
    const sid = tile.id.replace('tile-', '');
    const nameEl = tile.querySelector('[id^="nm-"], .tile-name');
    const vidEl = tile.querySelector('video');

    const thumb = document.createElement('div');
    thumb.className = 'thumb-tile';
    thumb.title = 'Click to spotlight';
    if (vidEl && vidEl.srcObject) {
      const v = document.createElement('video');
      v.autoplay = true; v.muted = (sid === 'self'); v.playsInline = true;
      v.srcObject = vidEl.srcObject;
      thumb.appendChild(v);
    }
    const lbl = document.createElement('div');
    lbl.className = 'thumb-name';
    lbl.textContent = nameEl?.textContent || sid;
    thumb.appendChild(lbl);
    thumb.addEventListener('click', () => pinTile(sid));
    strip.appendChild(thumb);
  });

  videoArea.appendChild(strip);
}

// ── WEBRTC DATA CHANNEL — FILE TRANSFER ────────────────────────
const fileReceiveBuffers = {}; // socketId → { meta, chunks }

function setupDataChannel(dc, socketId) {
  dc.binaryType = 'arraybuffer';
  dataChannels[socketId] = dc;

  dc.onmessage = e => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'file-meta') {
        fileReceiveBuffers[socketId] = { meta: msg, chunks: [] };
      } else if (msg.type === 'file-eof') {
        const buf = fileReceiveBuffers[socketId];
        if (!buf) return;
        const blob = new Blob(buf.chunks, { type: buf.meta.fileType });
        const reader = new FileReader();
        reader.onload = ev => {
          // Forward to the files iframe
          const frame = document.querySelector('#feat-panel-body iframe');
          if (frame) {
            frame.contentWindow.postMessage({
              type: 'FILE_RECEIVED',
              data: {
                name: buf.meta.fileName,
                size: buf.meta.fileSize,
                type: buf.meta.fileType,
                data: ev.target.result,
                sharedBy: peerInfo[socketId]?.name || 'Peer',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              }
            }, '*');
          }
          showToast(`📄 ${buf.meta.fileName} received`);
        };
        reader.readAsDataURL(blob);
        delete fileReceiveBuffers[socketId];
      }
    } else {
      // Binary chunk
      if (fileReceiveBuffers[socketId]) {
        fileReceiveBuffers[socketId].chunks.push(e.data);
      }
    }
  };
}

// Send a file to ALL connected peers via their data channels
function sendFileToPeers(file) {
  const CHUNK = 16384; // 16 KB
  const reader = new FileReader();
  reader.onload = async ev => {
    const buffer = ev.target.result;
    const meta = JSON.stringify({
      type: 'file-meta',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    });
    const eof = JSON.stringify({ type: 'file-eof' });

    for (const [sid, dc] of Object.entries(dataChannels)) {
      if (dc.readyState !== 'open') continue;
      dc.send(meta);
      let offset = 0;
      while (offset < buffer.byteLength) {
        // Respect bufferedAmount to avoid overflow
        if (dc.bufferedAmount > 1024 * 1024) {
          await new Promise(r => setTimeout(r, 100));
        }
        dc.send(buffer.slice(offset, offset + CHUNK));
        offset += CHUNK;
      }
      dc.send(eof);
    }
  };
  reader.readAsArrayBuffer(file);
}

socket.on('room-peers', async peersArr => {
  for (const { socketId, user: u } of peersArr) {
    peerInfo[socketId] = u;
    addVideoTile(socketId, u.name, u.guest);
    addToPeopleList(socketId, u.name, false, u.guest, u.id);
    await callPeer(socketId);
  }
  updateVideoGrid();
});

socket.on('user-joined', ({ socketId, user: u }) => {
  peerInfo[socketId] = u;
  addVideoTile(socketId, u.name, u.guest);
  addToPeopleList(socketId, u.name, false, u.guest, u.id);
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

// ── ROOM DELETED — realtime sync (server broadcasts when owner deletes) ──
socket.on('room-deleted', ({ message }) => {
  if (window.EventBus) EventBus.emit('ROOM_DELETED', { message });
  // Clear this room from localStorage cache immediately
  let joined = JSON.parse(localStorage.getItem('sr_joined_rooms') || '[]');
  joined = joined.filter(r => r.code !== roomCode);
  localStorage.setItem('sr_joined_rooms', JSON.stringify(joined));
  // Show banner then redirect
  showToast('🚫 ' + (message || 'Room has been deleted.'));
  setTimeout(() => {
    window.location.href = API.user() ? '/dashboard' : '/lobby';
  }, 2500);
});

socket.on('offer', async ({ from, offer, renegotiate: isRenegotiate }) => {
  // ── FIX: if we already have a PC for this peer (renegotiation),
  // update it rather than creating a duplicate connection.
  let pc = peers[from];
  if (!pc) {
    pc = createPeer(from);
  }

  // Handle glare (both sides offered simultaneously)
  if (pc.signalingState !== 'stable') {
    if (isRenegotiate) return; // ignore — our offer wins
    await Promise.all([
      pc.setLocalDescription({ type: 'rollback' }),
    ]);
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: from, answer });
});

socket.on('answer', async ({ from, answer }) => {
  const pc = peers[from];
  if (!pc) return;
  // Guard against stale answers arriving after state already moved on
  if (pc.signalingState === 'have-local-offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peers[from];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    // Benign if remote description isn't set yet — ICE will retry
    console.warn('[ICE] addIceCandidate error (usually harmless):', e.message);
  }
});

socket.on('peer-media-state', ({ socketId, video, audio }) => {
  const mic = document.getElementById('mic-' + socketId);
  if (mic) mic.classList.toggle('hidden', audio);
  const vid = document.getElementById('vid-' + socketId);
  if (vid) vid.classList.toggle('active', video && vid.srcObject);
  const tile = document.getElementById('tile-' + socketId);
  if (tile) tile.classList.toggle('cam-off', !video);
});

// ── Screen share spotlight — from remote peers ─────────────────
socket.on('peer-screen-share-started', ({ socketId }) => {
  const tile = document.getElementById('tile-' + socketId);
  if (tile) tile.classList.add('screen-share-tile');
  pinTile(socketId); // auto-spotlight for everyone
  showToast(`${peerInfo[socketId]?.name || 'Someone'} started screen sharing`);
});
socket.on('peer-screen-share-stopped', ({ socketId }) => {
  const tile = document.getElementById('tile-' + socketId);
  if (tile) tile.classList.remove('screen-share-tile');
  if (pinnedSocketId === socketId) unpinAll();
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
  
  if (message.startsWith('/doubt ')) {
    const text = message.replace('/doubt ', '').trim();
    if (text) {
      const doubtId = 'd_' + Date.now() + Math.floor(Math.random()*1000);
      socket.emit('focus-doubt', { roomCode, doubtId, text });
      if (focusModeActive) {
        appendDoubtMessage(doubtId, 'You', text, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    }
  } else {
    socket.emit('chat-message', { roomCode, message });
  }
  input.value = '';
}

function sendMusicCommand() {
  const input = document.getElementById('music-input');
  const message = input.value.trim();
  if (!message) return;
  
  if (message.startsWith('/')) {
    MusicBot.parseCommand(message);
  } else {
    // Treat plain text as a search query
    MusicBot.parseCommand(`/play ${message}`);
  }
  input.value = '';
}

function sendEmojiToChat(emoji) {
  socket.emit('chat-message', { roomCode, message: emoji });
  document.getElementById('emoji-picker').classList.remove('open');
  emojiPickerOpen = false;
}

function parseRichText(text) {
  let html = escapeHtml(text);
  html = html.replace(/(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp))/gi, '<br><img src="$1" style="max-width:100%;border-radius:4px;margin-top:4px"><br>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code style="background:var(--bg3);padding:2px 4px;border-radius:3px;font-family:monospace">$1</code>');
  return html;
}

socket.on('chat-message', ({ socketId, name, message, time }) => {
  const isMe = socketId === socket.id;
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isMe ? ' mine' : '');
  const isEmojiOnly = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u200D)+$/u.test(message) && message.length <= 8;
  const bubbleContent = isEmojiOnly
    ? `<span class="emoji-msg">${escapeHtml(message)}</span>`
    : parseRichText(message);
  div.innerHTML = `<div class="msg-sender">${escapeHtml(isMe ? 'You' : name)}<span class="msg-time">${time}</span></div><div class="msg-bubble">${bubbleContent}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (!isMe && !document.getElementById('rsb-chat').classList.contains('active') && !window.focusModeActive) {
    document.getElementById('tab-chat').style.color = 'var(--warning)';
    document.getElementById('tab-chat').style.fontWeight = '700';
  }
});

function appendSystemMessage(text) {
  if (window.focusModeActive) return; // True Do Not Disturb
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;font-size:10px;color:var(--hint);padding:4px 0';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── REACTIONS ──────────────────────────────────────────────────
// New toggle for raise hand (click based)
function toggleRaiseHand() {
  if (myHandRaised) {
    lowerHand();
  } else {
    raiseHandNow();
  }
}

// Preserve old hold functions (no longer used) but keep for backward compatibility
function startRaiseHandHold(e) {
  if (e?.preventDefault) e.preventDefault();
  toggleRaiseHand();
}

function endRaiseHandHold() {
  // No-op
}

function raiseHandNow() {
  myHandRaised = true;
  // Show hand badge on own tile
  const selfBadge = document.getElementById('tile-self')?.querySelector('.hand-badge');
  if (selfBadge) selfBadge.classList.add('show');
  document.getElementById('btn-hand')?.classList.add('hand-active');
  socket.emit('raise-hand', { roomCode, active: true });
  // Emoji reaction removed for professional raise hand
  showToast('✋ Hand raised — you are in the speaker queue');
  setTimeout(() => {
    if (!myHandRaised) return;
    showToast('You may speak — tap the mic button to unmute');
  }, HAND_MIC_GRANT_MS);
}

function lowerHand() {
  myHandRaised = false;
  // Hide hand badge on own tile
  const selfBadge = document.getElementById('tile-self')?.querySelector('.hand-badge');
  if (selfBadge) selfBadge.classList.remove('show');
  document.getElementById('btn-hand')?.classList.remove('hand-active', 'hand-holding');
  socket.emit('raise-hand', { roomCode, active: false });
  document.getElementById('tile-self')?.classList.remove('hand-priority');
}

socket.on('hands-updated', ({ hands }) => {
  raisedHandOrder.length = 0;
  // Reset all hand badges
  document.querySelectorAll('.hand-badge').forEach(b => b.classList.remove('show'));
  (hands || []).forEach(h => raisedHandOrder.push(h.socketId));
  // Show badges for raised hands and reorder tiles
  // Show badges for raised hands and reorder tiles preserving click order
  for (let i = raisedHandOrder.length - 1; i >= 0; i--) {
    const sid = raisedHandOrder[i];
    const tile = document.getElementById('tile-' + sid);
    if (tile) {
      // Show badge
      const badge = tile.querySelector('.hand-badge');
      if (badge) badge.classList.add('show');
      // Move tile to front based on order (first raised first)
      const grid = document.getElementById('video-grid');
      if (grid) grid.prepend(tile);
    }
  }
  // Update hand-priority visual styling for all tiles
  document.querySelectorAll('.video-tile').forEach(t => {
    const sid = t.id.replace('tile-', '');
    t.classList.toggle('hand-priority', raisedHandOrder.includes(sid));
  });
  if (!pinnedSocketId) updateVideoGrid();
});

socket.on('hand-raised', ({ socketId, name, active }) => {
  if (active) showToast(`${name} raised their hand`);
  else if (socketId !== socket.id) showToast(`${name} lowered their hand`);
  if (socketId !== socket.id) spawnReaction('✋', 'tile-' + socketId);
});

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
  if (btn) {
    btn.innerHTML = sidebarVisible
      ? '<i data-lucide="panel-right" style="width:20px;height:20px"></i><span class="ctrl-label">Hide Panel</span>'
      : '<i data-lucide="panel-right-close" style="width:20px;height:20px"></i><span class="ctrl-label">Show Panel</span>';
    btn.title = sidebarVisible ? 'Hide Sidebar Panel' : 'Show Sidebar Panel';
  }
  if (window.lucide) lucide.createIcons();
}

function openPeopleTab() {
  if (!sidebarVisible) toggleSidebar();
  setTab('people');
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
    loadRoomBuddies();
    setTimeout(() => {
      const msgs = document.getElementById('chat-messages');
      msgs.scrollTop = msgs.scrollHeight;
    }, 50);
  }
  if (window.lucide) lucide.createIcons();
}

async function loadRoomBuddies() {
  const strip = document.getElementById('chat-buddies-strip');
  if (!strip || !user?.id) return;
  const { ok, data } = await API.get('/api/friends', true);
  if (!ok || !data?.length) {
    strip.style.display = 'none';
    return;
  }
  const buddies = data.filter(b => b.status === 'accepted').map(b => b.friend);
  if (!buddies.length) {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = 'block';
  strip.innerHTML = '<span style="font-size:10px;color:var(--muted);display:block;margin-bottom:4px">Buddies — tap to DM</span>' +
    buddies.map(f =>
      `<span class="buddy-chip" onclick="messageBuddyFromRoom('${f.id}','${escapeHtml(f.name).replace(/'/g, "\\'")}')">${escapeHtml(f.name)}</span>`
    ).join('');
}

// ── FEATURE PANEL ──────────────────────────────────────────────
const FEATURES = {
  drawguess: { title: '🎨 Draw & Guess', src: '/features/drawguess/index.html' },
  timer: { title: '⏱ Pomodoro Timer', src: '/features/timer/index.html' },
  files: { title: '📁 File Sharing', src: '/features/files/index.html' },
  games: { title: '🎮 Games', src: '/features/games/index.html' }
};

function openMusicPanel() {
  if (!sidebarVisible) toggleSidebar();
  setTab('music');
  const hint = document.querySelector('.chat-bot-hint');
  if (hint) {
    hint.classList.add('music-hint-glow');
    setTimeout(() => hint.classList.remove('music-hint-glow'), 1800);
  }
  const input = document.getElementById('music-input');
  if (input) {
    input.focus();
    if (!input.value) input.value = '/play ';
    input.setSelectionRange(input.value.length, input.value.length);
  }
  document.querySelectorAll('.feat-ctrl').forEach(b => b.classList.remove('active'));
  document.getElementById('feat-music')?.classList.add('active');
  showToast('🎵 Type /play <song name> and press Enter');
}

function toggleFeature(name) {
  const wrap = document.getElementById('feat-panel-wrap');
  const videoAreaEl = document.getElementById('video-area');
  const bodyLeft = document.getElementById('room-body-left');
  const btnId = name === 'whiteboard' ? 'feat-wb' : 'feat-' + name;
  const btn = document.getElementById(btnId);
  if (activeFeature === name) { closeFeature(); return; }
  activeFeature = name;
  document.querySelectorAll('.feat-ctrl').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const f = FEATURES[name];
  document.getElementById('feat-panel-title').textContent = f.title;
  const uid = user?.id ? encodeURIComponent(user.id) : '';
  const uname = encodeURIComponent(user?.name || 'Player');
  document.getElementById('feat-panel-body').innerHTML =
    `<iframe src="${f.src}?room=${roomCode}&name=${uname}&uid=${uid}" style="width:100%;height:100%;border:none;flex:1;min-height:0" allow="camera;microphone"></iframe>`;
  wrap.classList.add('open');
  bodyLeft?.classList.add('feat-layout');
  bodyLeft?.classList.toggle('games-active', name === 'games');
  videoAreaEl.classList.add('feat-open');
  document.getElementById('room-body')?.classList.add('feature-active');
  requestAnimationFrame(() => {
    updateVideoGrid();
    _observeFeatLayout();
  });
}

let _featResizeObs = null;
function _observeFeatLayout() {
  const left = document.getElementById('room-body-left');
  if (!left || _featResizeObs) return;
  _featResizeObs = new ResizeObserver(() => {
    if (activeFeature) updateVideoGrid();
  });
  _featResizeObs.observe(left);
}

function closeFeature() {
  activeFeature = null;
  document.querySelectorAll('.feat-ctrl').forEach(b => b.classList.remove('active'));
  document.getElementById('feat-panel-wrap').classList.remove('open');
  document.getElementById('video-area').classList.remove('feat-open');
  const bodyLeft = document.getElementById('room-body-left');
  bodyLeft?.classList.remove('feat-layout', 'games-active');
  document.getElementById('room-body')?.classList.remove('feature-active');
  document.getElementById('feat-panel-body').innerHTML = '';
  updateVideoGrid();
}

window.addEventListener('message', e => {
  const { type, data, gameType, targetSocketId } = e.data || {};
  if (!type) return;
  if (type === 'GAME_OPEN_INVITE') {
    if (!sidebarVisible) toggleSidebar();
    setTab('people');
    showToast('Tap Play next to someone to invite them');
    return;
  }
  if (type === 'WHITEBOARD_DRAW') socket.emit('whiteboard-draw', { roomCode, data });
  if (type === 'WHITEBOARD_CLEAR') socket.emit('whiteboard-clear', { roomCode });
  if (type === 'TIMER_START') socket.emit('timer-start', { roomCode, duration: data.duration });
  if (type === 'TIMER_STOP') socket.emit('timer-stop', { roomCode });
  if (type === 'TIMER_REQUEST') socket.emit('timer-request', { roomCode });
  // FILE_SHARE: files.js iframe sends us a file → we send via WebRTC data channels
  if (type === 'FILE_SHARE') {
    // Convert dataUrl back to a File-like object for sendFileToPeers
    fetch(data.dataUrl)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], data.name, { type: data.type });
        sendFileToPeers(file);
      });
  }
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
    <div class="hand-badge">✋</div>
    <div class="tile-mic-off hidden" id="mic-${socketId}"><i data-lucide="mic-off" style="width:14px;height:14px"></i></div>
    <div class="tile-cam-off hidden" id="cam-${socketId}"><i data-lucide="video-off" style="width:14px;height:14px"></i></div>
    ${guest ? `<div class="tile-guest-tag">Guest</div>` : ''}
    <button class="tile-pin-btn" title="Pin / Spotlight" onclick="pinTile('${socketId}')">
      <i data-lucide="pin" style="width:13px;height:13px"></i>
    </button>
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

function addToPeopleList(socketId, name, isYou = false, guest = false, peerUserId = null) {
  const list = document.getElementById('people-list');
  const div = document.createElement('div');
  div.className = 'peer-row';
  div.id = 'peer-row-' + socketId;

  // Room owner check — roomInfoCache may not be ready yet but will be within ms
  const isOwner = () => roomInfoCache && user && roomInfoCache.created_by === user.id;
  const canDm = user?.id && peerUserId && !guest;

  div.innerHTML = `
    <div class="peer-av">${initials(name)}</div>
    <div class="peer-name-wrap">
      <div class="peer-name">${escapeHtml(name)}</div>
      <span class="peer-focus-badge hidden" id="focus-badge-${socketId}">🎯 Focus</span>
    </div>
    ${isYou ? '<span class="peer-you">You</span>' : ''}
    ${guest && !isYou ? '<span class="peer-guest">Guest</span>' : ''}
    ${!isYou ? `
    <div class="peer-actions" style="margin-left:auto;display:flex;gap:4px;align-items:center">
      <input type="range" min="0" max="1" step="0.05" value="1" title="Adjust Volume"
             style="width:50px;height:4px;accent-color:var(--accent);cursor:pointer;margin-right:4px"
             oninput="setPeerVolume('${socketId}', this.value)">
      <button class="peer-play-btn" title="Invite to game" onclick="openGameInviteMenu('${socketId}',event)">Play</button>
      ${canDm ? `<button class="peer-msg-btn" title="Direct message" onclick="messageBuddyFromRoom('${peerUserId}','${escapeHtml(name).replace(/'/g, "\\'")}')">Chat</button>` : ''}
    </div>
    <div class="peer-mod-wrap" style="position:relative">
      <button class="peer-mod-btn" onclick="toggleModMenu('${socketId}',event)" title="Moderation"
              style="background:none;border:none;cursor:pointer;color:var(--muted);padding:4px;border-radius:4px;font-size:16px;line-height:1;display:none"
              id="mod-btn-${socketId}">⋯</button>
      <div class="peer-mod-menu" id="mod-menu-${socketId}"
           style="display:none;position:absolute;right:0;top:100%;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:4px;min-width:140px;box-shadow:var(--shadow-md);z-index:50">
        <div class="mod-opt" onclick="kickUser('${socketId}','${escapeHtml(name)}')"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:#ef4444;transition:background 0.1s"
             onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background=''">
          Kick from room
        </div>
        <div class="mod-opt" onclick="muteUser('${socketId}','${escapeHtml(name)}')"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:var(--text);transition:background 0.1s"
             onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
          Force mute
        </div>
        <div class="mod-opt" onclick="stopShareUser('${socketId}','${escapeHtml(name)}')"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:var(--text);transition:background 0.1s"
             onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
          Stop screen share
        </div>
        <div class="mod-opt" onclick="timeoutUser('${socketId}','${escapeHtml(name)}')"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:#f97316;transition:background 0.1s;border-top:1px solid var(--border);margin-top:4px"
             onmouseover="this.style.background='rgba(249,115,22,0.1)'" onmouseout="this.style.background=''">
          Timeout (Ban)
        </div>
      </div>
    </div>` : ''}
  `;
  list.appendChild(div);

  // Show mod button only if we are the owner
  setTimeout(() => {
    if (isOwner() && !isYou) {
      const btn = document.getElementById(`mod-btn-${socketId}`);
      if (btn) btn.style.display = 'flex';
    }
  }, 800);
}

function toggleModMenu(socketId, e) {
  e.stopPropagation();
  const menu = document.getElementById(`mod-menu-${socketId}`);
  if (!menu) return;
  const isOpen = menu.style.display === 'block';
  // Close all other menus
  document.querySelectorAll('.peer-mod-menu').forEach(m => m.style.display = 'none');
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => document.addEventListener('click', () => { menu.style.display = 'none'; }, { once: true }), 10);
  }
}

function kickUser(targetSocketId, targetName) {
  document.querySelectorAll('.peer-mod-menu').forEach(m => m.style.display = 'none');
  if (!confirm(`Kick "${targetName}" from the room?`)) return;
  socket.emit('mod-kick', { roomCode, targetSocketId });
  showToast(`Kicked ${targetName}`);
}

function muteUser(targetSocketId, targetName) {
  document.querySelectorAll('.peer-mod-menu').forEach(m => m.style.display = 'none');
  socket.emit('mod-mute', { roomCode, targetSocketId });
  showToast(`Muted ${targetName}`);
}

function stopShareUser(targetSocketId, targetName) {
  document.querySelectorAll('.peer-mod-menu').forEach(m => m.style.display = 'none');
  socket.emit('mod-stop-share', { roomCode, targetSocketId });
  showToast(`Stopped ${targetName}'s screen share`);
}

function timeoutUser(targetSocketId, targetName) {
  document.querySelectorAll('.peer-mod-menu').forEach(m => m.style.display = 'none');
  if (!confirm(`Timeout "${targetName}"? They will not be able to rejoin this room session.`)) return;
  socket.emit('mod-timeout', { roomCode, targetSocketId });
  showToast(`Banned ${targetName} for this session`);
}

// ── Listen for being kicked/muted by owner ────────────────────────────────
socket.on('you-were-kicked', (data) => {
  const reason = data?.reason === 'banned' ? '❌ You are banned from this room.' : '❌ You were removed from this room by the owner.';
  showToast(reason, 4000);
  setTimeout(() => window.location.href = '/dashboard', 2000);
});
socket.on('you-were-muted', () => {
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
  micOn = false;
  const btn = document.getElementById('btn-mic');
  if (btn) {
    btn.innerHTML = '<i data-lucide="mic-off" style="width:18px;height:18px"></i>';
    btn.classList.add('off');
    if (window.lucide) lucide.createIcons();
  }
  document.getElementById('self-mic-off')?.classList.remove('hidden');
  socket.emit('media-state', { roomCode, video: camOn, audio: false });
  showToast('🔇 You were muted by the room owner');
});
socket.on('you-were-unshared', () => {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    document.getElementById('btn-screen').classList.remove('active');
    socket.emit('screen-share-stopped', { roomCode });
    if (pinnedSocketId === 'self') unpinAll();
    Object.values(peers).forEach(pc => {
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      const camTrack = localStream?.getVideoTracks()[0] ?? null;
      if (videoSender && camTrack) videoSender.replaceTrack(camTrack);
    });
    showToast('🛑 Your screen share was stopped by the owner');
  }
});

// Remove from people list when peer leaves
socket.on('user-left', ({ socketId }) => {
  document.getElementById('peer-row-' + socketId)?.remove();
});



// ── SHARE PANEL ────────────────────────────────────────────────
let roomInfoCache = null;

async function fetchRoomInfo() {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const res = await fetch(`/api/rooms/info/${roomCode}`, { headers });
    if (!res.ok) return;
    roomInfoCache = await res.json();
    if (roomInfoCache.name) {
      document.getElementById('room-name-title').textContent = roomInfoCache.name;
    }

    // ── Owner PIN badge — always show to creator ──────────────────
    if (roomInfoCache.pin) {
      const badge = document.getElementById('owner-pin-badge');
      const pinVal = document.getElementById('owner-pin-value');
      if (badge && pinVal) {
        pinVal.textContent = roomInfoCache.pin;
        badge.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
      }
    }

    if (storedUser) {
      let joined = JSON.parse(localStorage.getItem('sr_joined_rooms') || '[]');
      joined = joined.filter(r => r.code !== roomInfoCache.code);
      joined.unshift({
        code: roomInfoCache.code,
        name: roomInfoCache.name,
        topic: roomInfoCache.topic,
        is_public: roomInfoCache.is_public,
        expires_at: roomInfoCache.expires_at,
        created_at: new Date().toISOString()
      });
      if (joined.length > 20) joined.length = 20;
      localStorage.setItem('sr_joined_rooms', JSON.stringify(joined));
    }
  } catch { /* network error */ }
}

function openShareModal() {
  const modal = document.getElementById('share-modal');
  const info = roomInfoCache;
  const link = `${window.location.origin}/join/${roomCode}`;

  document.getElementById('share-room-name').textContent = info?.name || 'Study Room';
  document.getElementById('share-code-val').textContent = roomCode;
  document.getElementById('share-link-val').textContent = link;

  const pinRow = document.getElementById('share-pin-row');
  const pinVal = document.getElementById('share-pin-val');
  if (info?.pin) {
    pinVal.textContent = info.pin;
    pinRow.classList.remove('hidden');
  } else {
    pinRow.classList.add('hidden');
  }

  modal.classList.add('open');
}

function closeShareModal() {
  document.getElementById('share-modal').classList.remove('open');
}

function copyShareCode() { navigator.clipboard.writeText(roomCode); showToast('Room code copied!'); }
function copySharePin() {
  const pin = document.getElementById('share-pin-val').textContent;
  if (pin) { navigator.clipboard.writeText(pin); showToast('PIN copied!'); }
}
function copyShareLink() {
  navigator.clipboard.writeText(document.getElementById('share-link-val').textContent);
  showToast('Invite link copied!');
}
function copyShareAll() {
  const pin = document.getElementById('share-pin-val')?.textContent || '(see creator)';
  const link = document.getElementById('share-link-val').textContent;
  navigator.clipboard.writeText(`Room Code: ${roomCode}\nPIN: ${pin}\nLink: ${link}`);
  showToast('All details copied!');
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
// ── GAME INVITES (People → Play) ───────────────────────────────
const GAME_PICK = [
  { id: 'ttt', label: 'Tic Tac Toe' },
  { id: 'dab', label: 'House Building' },
  { id: 'rps', label: 'Rock Paper Scissors' },
  { id: 'chess', label: 'Chess' },
  { id: 'ludo', label: 'Ludo' },
  { id: 'bottle', label: 'Bottle Round' },
];

function openGameInviteMenu(targetSocketId, e) {
  e.stopPropagation();
  document.querySelectorAll('.game-pick-menu').forEach(m => m.remove());
  const row = document.getElementById('peer-row-' + targetSocketId);
  if (!row) return;
  const menu = document.createElement('div');
  menu.className = 'game-pick-menu';
  menu.innerHTML = GAME_PICK.map(g =>
    `<button type="button" onclick="sendGameInviteToPeer('${targetSocketId}','${g.id}')">${g.label}</button>`
  ).join('');
  row.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

function sendGameInviteToPeer(targetSocketId, gameType) {
  document.querySelectorAll('.game-pick-menu').forEach(m => m.remove());
  if (!activeFeature || activeFeature !== 'games') toggleFeature('games');
  const frame = document.querySelector('#feat-panel-body iframe');
  if (frame) {
    frame.contentWindow.postMessage({
      type: 'GAME_INVITE_PEER',
      gameType,
      targetSocketId,
    }, '*');
  } else {
    socket.emit('game-invite', {
      roomCode,
      gameType,
      targetSocketId,
      hostName: user?.name || 'Host',
    });
  }
  const name = peerInfo[targetSocketId]?.name || 'them';
  showToast(`Game invite sent to ${name}`);
}

socket.on('game-invite-received', (inv) => {
  pendingRoomGameInvite = inv;
  showToast(`${inv.fromName} invited you to play! Open Games or accept below.`);
  let bar = document.getElementById('room-game-invite-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'room-game-invite-bar';
    bar.className = 'room-game-invite-bar';
    document.querySelector('.room-header')?.appendChild(bar);
  }
  bar.innerHTML = `
    <span>${escapeHtml(inv.fromName)} → ${escapeHtml(inv.gameType)}</span>
    <button type="button" onclick="acceptRoomGameInvite()">Accept</button>
    <button type="button" class="muted" onclick="declineRoomGameInvite()">Decline</button>
  `;
  bar.classList.remove('hidden');
});

function acceptRoomGameInvite() {
  if (!pendingRoomGameInvite) return;
  socket.emit('game-invite-respond', { sessionId: pendingRoomGameInvite.sessionId, accept: true });
  if (!activeFeature || activeFeature !== 'games') toggleFeature('games');
  document.getElementById('room-game-invite-bar')?.classList.add('hidden');
  pendingRoomGameInvite = null;
}

function declineRoomGameInvite() {
  if (!pendingRoomGameInvite) return;
  socket.emit('game-invite-respond', { sessionId: pendingRoomGameInvite.sessionId, accept: false });
  document.getElementById('room-game-invite-bar')?.classList.add('hidden');
  pendingRoomGameInvite = null;
}

// ── BUDDY DM FROM ROOM ─────────────────────────────────────────
async function messageBuddyFromRoom(friendUserId, friendName) {
  if (!user?.id) {
    showToast('Sign in to message buddies');
    return;
  }
  try {
    const { ok, data } = await API.post(`/api/chat/dm/${friendUserId}`, {}, true);
    if (ok && data?.chatId) {
      window.open(`/chat/${data.chatId}`, '_blank');
      showToast(`Opening chat with ${friendName}`);
    } else {
      showToast('Could not start chat — add them as a buddy first');
    }
  } catch {
    showToast('Chat unavailable');
  }
}

// ── SAINT FOCUS MODE (in-room) ─────────────────────────────────
function openFocusSetup() {
  const prefs = JSON.parse(localStorage.getItem(FOCUS_PREFS_KEY) || '{}');
  const dur = document.getElementById('room-focus-duration');
  if (dur && prefs.duration) dur.value = prefs.duration;
  document.getElementById('modal-room-focus')?.classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function closeFocusSetup() {
  document.getElementById('modal-room-focus')?.classList.remove('open');
}

let pendingGroupFocusEnd = null;

function startRoomFocusMode() {
  const fileInput = document.getElementById('room-focus-file');
  const duration = parseInt(document.getElementById('room-focus-duration')?.value || '25', 10);
  const mode = document.getElementById('room-focus-type')?.value || 'single';
  const err = document.getElementById('room-focus-err');
  if (!fileInput?.files?.length) {
    err.textContent = 'Choose a PDF to study with.';
    err.classList.remove('hidden');
    return;
  }
  const file = fileInput.files[0];
  if (file.type !== 'application/pdf') {
    err.textContent = 'Only PDF files are supported.';
    err.classList.remove('hidden');
    return;
  }
  err.classList.add('hidden');
  localStorage.setItem(FOCUS_PREFS_KEY, JSON.stringify({ duration }));

  if (focusBlobUrl) URL.revokeObjectURL(focusBlobUrl);
  focusBlobUrl = URL.createObjectURL(file);
  closeFocusSetup();

  if (mode === 'group') {
    const endTime = Date.now() + duration * 60000;
    socket.emit('group-focus-invite', { roomCode, duration, endTime });
    enterFocusMode(duration, true, endTime);
  } else {
    enterFocusMode(duration, false);
  }
}

function enterFocusMode(duration, isGroup, endTime = null) {
  focusSecondsLeft = endTime ? Math.max(0, Math.floor((endTime - Date.now())/1000)) : duration * 60;
  focusModeActive = true;

  document.getElementById('room-focus-pdf').src = focusBlobUrl;
  document.getElementById('room-focus-overlay')?.classList.add('active');
  const typeBadge = document.getElementById('focus-mode-type-badge');
  if (typeBadge) {
    typeBadge.style.display = isGroup ? 'inline-block' : 'none';
  }
  startFocusPiP();

  socket.emit('focus-mode-start', { roomCode, duration, isGroup });
  document.getElementById('focus-badge-self')?.classList.remove('hidden');
  updateRoomFocusTimerDisplay();

  if (focusInterval) clearInterval(focusInterval);
  focusInterval = setInterval(() => {
    focusSecondsLeft--;
    updateRoomFocusTimerDisplay();
    if (focusSecondsLeft <= 0) endRoomFocusMode(true);
  }, 1000);
}

function acceptGroupFocus() {
  document.getElementById('modal-group-focus-invite').classList.remove('open');
  if (!pendingGroupFocusEnd) return;
  // Prompt for PDF first? Or just allow them to enter without PDF temporarily, they can set it later.
  // We can let them pick a PDF instantly, but to be seamless, we'll just open a file dialog, or let them study without it.
  // For now, let's open Focus setup but with pre-filled Group data.
  // But wait, the prompt says "who click yes, enter the room, and study toether".
  // If they don't have a PDF, we can just show a blank focus mode.
  focusBlobUrl = null;
  const durationMinutes = Math.ceil((pendingGroupFocusEnd - Date.now()) / 60000);
  enterFocusMode(durationMinutes, true, pendingGroupFocusEnd);
  pendingGroupFocusEnd = null;
}

function rejectGroupFocus() {
  document.getElementById('modal-group-focus-invite').classList.remove('open');
  pendingGroupFocusEnd = null;
  appendSystemMessage('You declined the group focus session.');
}

function updateRoomFocusTimerDisplay() {
  const m = Math.floor(Math.max(0, focusSecondsLeft) / 60).toString().padStart(2, '0');
  const s = (Math.max(0, focusSecondsLeft) % 60).toString().padStart(2, '0');
  const el = document.getElementById('room-focus-timer');
  if (el) el.textContent = `${m}:${s}`;
}

function endRoomFocusMode(completed = false) {
  if (focusInterval) {
    clearInterval(focusInterval);
    focusInterval = null;
  }
  focusModeActive = false;
  if (focusBlobUrl) {
    URL.revokeObjectURL(focusBlobUrl);
    focusBlobUrl = null;
  }
  document.getElementById('room-focus-pdf').src = '';
  document.getElementById('room-focus-overlay')?.classList.remove('active');
  socket.emit('focus-mode-end', { roomCode });
  document.getElementById('focus-badge-self')?.classList.add('hidden');
  stopFocusPiP();
  if (completed) {
    showToast('Focus session complete — welcome back!');
    appendSystemMessage(`${user?.name || 'Someone'} finished a focus session`);
  }
}

socket.on('peer-focus-start', ({ socketId, name }) => {
  const badge = document.getElementById('focus-badge-' + socketId);
  if (badge) badge.classList.remove('hidden');
  appendSystemMessage(`${name} entered focus mode 🎯`);
});

socket.on('group-focus-invite-incoming', ({ fromName, duration, endTime }) => {
  if (focusModeActive) return; // already in focus mode
  pendingGroupFocusEnd = endTime;
  document.getElementById('gfi-title').textContent = 'Group Focus Session';
  document.getElementById('gfi-desc').textContent = `${fromName} invited you to a ${duration}m group study session.`;
  document.getElementById('modal-group-focus-invite').classList.add('open');
});

socket.on('focus-doubt', ({ id, fromName, text, time }) => {
  if (!focusModeActive) return; // Only show if I'm in focus mode
  appendDoubtMessage(id, fromName, text, time);
});

socket.on('focus-answer', ({ doubtId, fromName, text, time }) => {
  if (!focusModeActive) return;
  appendDoubtAnswer(doubtId, fromName, text, time);
});

function appendDoubtMessage(id, fromName, text, time) {
  const container = document.getElementById('focus-doubt-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.id = 'doubt-' + id;
  div.style.background = 'var(--bg)';
  div.style.padding = '10px';
  div.style.borderRadius = '8px';
  div.style.border = '1px solid var(--border)';
  div.innerHTML = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:4px"><strong>${fromName}</strong> • ${time}</div>
    <div style="font-size:13px;color:var(--text);margin-bottom:8px">${text}</div>
    <div id="answers-${id}" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;padding-left:8px;border-left:2px solid var(--accent)"></div>
    <button onclick="replyToDoubt('${id}')" style="background:none;border:none;color:var(--accent);font-size:11px;font-weight:600;cursor:pointer;padding:0">Reply</button>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  
  // Show badge
  const chatUi = document.getElementById('focus-doubt-chat');
  if (chatUi.style.display === 'none') {
    const badge = document.getElementById('doubt-badge');
    badge.style.display = 'inline-block';
    badge.textContent = parseInt(badge.textContent || '0') + 1;
  }
}

function appendDoubtAnswer(doubtId, fromName, text, time) {
  const answersContainer = document.getElementById('answers-' + doubtId);
  if (!answersContainer) return;
  const div = document.createElement('div');
  div.style.fontSize = '12px';
  div.style.color = 'var(--text)';
  div.innerHTML = `<span style="font-weight:600;color:var(--muted)">${fromName}:</span> ${text}`;
  answersContainer.appendChild(div);
  
  const container = document.getElementById('focus-doubt-messages');
  container.scrollTop = container.scrollHeight;
}

function replyToDoubt(doubtId) {
  const input = document.getElementById('focus-doubt-input');
  input.value = `/answer ${doubtId} `;
  input.focus();
}

function sendFocusDoubt() {
  const input = document.getElementById('focus-doubt-input');
  const message = input.value.trim();
  if (!message) return;
  
  if (message.startsWith('/audio')) {
    toggleFocusAudio();
    return;
  }
  
  if (message.startsWith('/answer ')) {
    const parts = message.split(' ');
    const doubtId = parts[1];
    const text = parts.slice(2).join(' ').trim();
    if (doubtId && text) {
      socket.emit('focus-answer', { roomCode, doubtId, text });
      appendDoubtAnswer(doubtId, 'You', text, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
  } else if (message.startsWith('/doubt ')) {
    const text = message.replace('/doubt ', '').trim();
    if (text) {
      const doubtId = 'd_' + Date.now() + Math.floor(Math.random()*1000);
      socket.emit('focus-doubt', { roomCode, doubtId, text });
      appendDoubtMessage(doubtId, 'You', text, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
  } else {
    // default to doubt
    const doubtId = 'd_' + Date.now() + Math.floor(Math.random()*1000);
    socket.emit('focus-doubt', { roomCode, doubtId, text: message });
    appendDoubtMessage(doubtId, 'You', message, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }
  input.value = '';
}

let focusAudioRecorder = null;
let focusAudioChunks = [];
let focusAudioTimer = null;
let focusAudioSeconds = 0;

async function toggleFocusAudio() {
  const inputStr = document.getElementById('focus-doubt-input').value.trim();
  let doubtId = null;
  if (inputStr.startsWith('/answer ')) {
    doubtId = inputStr.split(' ')[1];
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    focusAudioRecorder = new MediaRecorder(stream);
    focusAudioChunks = [];
    
    focusAudioRecorder.ondataavailable = e => {
      if (e.data.size > 0) focusAudioChunks.push(e.data);
    };
    
    focusAudioRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(focusAudioTimer);
    };
    
    focusAudioRecorder.doubtId = doubtId; // save target
    focusAudioRecorder.start();
    
    document.getElementById('focus-doubt-input-area').style.display = 'none';
    document.getElementById('focus-audio-banner').style.display = 'flex';
    focusAudioSeconds = 0;
    document.getElementById('focus-audio-timer').textContent = 'Recording... 0:00';
    
    focusAudioTimer = setInterval(() => {
      focusAudioSeconds++;
      const m = Math.floor(focusAudioSeconds / 60);
      const s = (focusAudioSeconds % 60).toString().padStart(2, '0');
      document.getElementById('focus-audio-timer').textContent = `Recording... ${m}:${s}`;
    }, 1000);
    
  } catch (err) {
    showToast('Could not access microphone');
  }
}

function stopFocusAudio(send) {
  if (!focusAudioRecorder) return;
  const targetDoubtId = focusAudioRecorder.doubtId;
  
  if (send) {
    focusAudioRecorder.onstop = () => {
      clearInterval(focusAudioTimer);
      const blob = new Blob(focusAudioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result;
        const text = `<audio controls src="${base64Audio}" style="height:30px;width:200px;border-radius:15px"></audio>`;
        if (targetDoubtId) {
          socket.emit('focus-answer', { roomCode, doubtId: targetDoubtId, text });
          appendDoubtAnswer(targetDoubtId, 'You (Voice)', text, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } else {
          const newDoubtId = 'd_' + Date.now() + Math.floor(Math.random()*1000);
          socket.emit('focus-doubt', { roomCode, doubtId: newDoubtId, text });
          appendDoubtMessage(newDoubtId, 'You (Voice)', text, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }
      };
      reader.readAsDataURL(blob);
    };
  } else {
    focusAudioRecorder.onstop = () => clearInterval(focusAudioTimer);
  }
  
  focusAudioRecorder.stop();
  document.getElementById('focus-audio-banner').style.display = 'none';
  document.getElementById('focus-doubt-input-area').style.display = 'flex';
  document.getElementById('focus-doubt-input').value = '';
}

socket.on('peer-focus-end', ({ socketId, name }) => {
  const badge = document.getElementById('focus-badge-' + socketId);
  if (badge) badge.classList.add('hidden');
  appendSystemMessage(`${name} is back from focus mode`);
});

// ── MUSIC PRESENCE (EventBus) ──────────────────────────────────
if (window.EventBus) {
  window.EventBus.on('MUSIC_PRESENCE_UPDATE', (state) => {
    let presenceDiv = document.getElementById('room-music-presence');
    if (!presenceDiv) {
       presenceDiv = document.createElement('div');
       presenceDiv.id = 'room-music-presence';
       presenceDiv.style.padding = '8px 16px';
       presenceDiv.style.borderTop = '1px solid var(--border)';
       presenceDiv.style.background = 'var(--bg2)';
       presenceDiv.style.fontSize = '12px';
       presenceDiv.style.display = 'flex';
       presenceDiv.style.alignItems = 'center';
       presenceDiv.style.gap = '8px';
       const sidebar = document.getElementById('room-sidebar');
       if (sidebar) sidebar.appendChild(presenceDiv);
    }

    if (state.playing && state.track) {
      presenceDiv.style.display = 'flex';
      const art = state.track.thumbnail ? `<img src="${state.track.thumbnail}" style="width:20px;height:20px;border-radius:4px;object-fit:cover" />` : '';
      presenceDiv.innerHTML = `
        ${art}
        <marquee scrollamount="2" style="flex:1;max-width:200px">
          <strong>Listening:</strong> ${state.track.title}
        </marquee>
      `;
    } else {
      presenceDiv.style.display = 'none';
    }
  });
}

// ── MORE MENU POPOVER ──────────────────────────────────────────
function toggleMoreMenu() {
  const menu = document.getElementById('more-menu');
  if (menu) {
    menu.classList.toggle('open');
  }
}

// Close more menu when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('more-menu');
  const btn = document.getElementById('btn-more');
  if (menu && menu.classList.contains('open')) {
    if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
      menu.classList.remove('open');
    }
  }
});

// ── ACTIVE SPEAKER MONITOR ────────────────────────────────
let activeSpeakerId = null;
function startActiveSpeakerMonitor() {
  if (!window.peers) return;
  const interval = setInterval(async () => {
    let maxLevel = 0;
    let activeId = null;
    // Remote peers audio levels
    for (const [socketId, pc] of Object.entries(window.peers)) {
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'track' && report.kind === 'audio' && report.remote) {
            const level = report.audioLevel || 0;
            if (level > maxLevel) {
              maxLevel = level;
              activeId = socketId;
            }
          }
        });
      } catch (e) { /* ignore */ }
    }
    // Local mic level
    if (window.localStream) {
      const audioTracks = window.localStream.getAudioTracks();
      if (audioTracks.length) {
        if (!window._micAnalyser) {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const source = audioCtx.createMediaStreamSource(window.localStream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          window._micAnalyser = { audioCtx, analyser, dataArray: new Uint8Array(analyser.frequencyBinCount) };
        }
        const { analyser, dataArray } = window._micAnalyser;
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const level = sum / (dataArray.length * 255);
        if (level > maxLevel) {
          maxLevel = level;
          activeId = 'self';
        }
      }
    }
    if (activeId !== activeSpeakerId) {
      if (activeSpeakerId) {
        const prev = document.getElementById(`tile-${activeSpeakerId}`);
        if (prev) prev.classList.remove('active-speaker');
      }
      if (activeId) {
        const cur = document.getElementById(`tile-${activeId}`);
        if (cur) cur.classList.add('active-speaker');
      }
      activeSpeakerId = activeId;
    }
  }, 500);
}
startActiveSpeakerMonitor();

// ── PHASE 1 SUPERCHARGE FEATURES ──────────────────────────────
let pipVideoElement = null;

async function startFocusPiP() {
  if (!document.pictureInPictureEnabled) return;
  let targetVidId = null;
  if (typeof pinnedSocketId !== 'undefined' && pinnedSocketId && pinnedSocketId !== 'self') {
    targetVidId = 'vid-' + pinnedSocketId;
  } else if (activeSpeakerId && activeSpeakerId !== 'self') {
    targetVidId = 'vid-' + activeSpeakerId;
  } else {
    const peerIds = Object.keys(peers || {});
    if (peerIds.length > 0) targetVidId = 'vid-' + peerIds[0];
  }
  
  const targetVid = targetVidId ? document.getElementById(targetVidId) : null;
  if (targetVid) {
    try {
      pipVideoElement = targetVid;
      await pipVideoElement.requestPictureInPicture();
    } catch (e) { console.warn('PiP failed', e); }
  }
}

function stopFocusPiP() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }
  pipVideoElement = null;
}

window.setPeerVolume = function(socketId, vol) {
  const vid = document.getElementById('vid-' + socketId);
  if (vid) vid.volume = parseFloat(vol);
};

let _pttActive = false;
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    if (typeof micOn !== 'undefined' && !micOn) {
      _pttActive = true;
      toggleMic();
    }
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (_pttActive && typeof micOn !== 'undefined' && micOn) {
      _pttActive = false;
      toggleMic();
    }
  }
});

// ── NOTES & TODOS ──────────────────────────────────────────────
let sharedTodos = [];

window.handleNotesInput = function(val) {
  socket.emit('notes-update', { roomCode, notes: val });
};

socket.on('notes-update', (notes) => {
  const el = document.getElementById('shared-notes');
  if (el && el.value !== notes) {
    el.value = notes;
  }
});

function renderTodos() {
  const list = document.getElementById('todo-list');
  if (!list) return;
  list.innerHTML = sharedTodos.map((t, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px">
      <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTodo(${i}, this.checked)" style="accent-color:var(--accent);cursor:pointer">
      <span style="flex:1;font-size:12px;color:var(--text);${t.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${escapeHtml(t.text)}</span>
      <button onclick="deleteTodo(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;padding:0 4px;line-height:1">×</button>
    </div>
  `).join('');
}

window.addTodo = function() {
  const input = document.getElementById('todo-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  sharedTodos.push({ text, done: false });
  input.value = '';
  renderTodos();
  socket.emit('todos-update', { roomCode, todos: sharedTodos });
};

window.toggleTodo = function(idx, done) {
  if (sharedTodos[idx]) {
    sharedTodos[idx].done = done;
    renderTodos();
    socket.emit('todos-update', { roomCode, todos: sharedTodos });
  }
};

window.deleteTodo = function(idx) {
  sharedTodos.splice(idx, 1);
  renderTodos();
  socket.emit('todos-update', { roomCode, todos: sharedTodos });
};

socket.on('todos-update', (todos) => {
  sharedTodos = todos || [];
  renderTodos();
});
