// ── AUTH GUARD ─────────────────────────────────────────────────
const token = API.token();
const user = API.user();
if (!token || !user) window.location.href = '/';

let createdRoom = null;
let scheduleData = JSON.parse(localStorage.getItem('sr_schedule') || '[]');

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Populate user info
  document.getElementById('sb-name').textContent = user.name;
  document.getElementById('sb-avatar').textContent = initials(user.name);
  document.getElementById('settings-name').value = user.name;
  document.getElementById('settings-email').value = user.email;

  // Greeting
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').textContent = `${g}, ${user.name.split(' ')[0]} 👋`;

  loadRooms();
  renderSchedule();

  // Set schedule datetime min to now
  const dtInput = document.getElementById('sch-datetime');
  if (dtInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.min = now.toISOString().slice(0, 16);
  }
});

// ── NAVIGATION ─────────────────────────────────────────────────
function setPanel(id, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'rooms') loadMyRooms();
  if (id === 'schedule') renderSchedule();
}

// ── ROOMS ──────────────────────────────────────────────────────
async function loadRooms() {
  const { ok, data } = await API.get('/api/rooms/mine', true);
  if (ok) renderRoomList('recent-rooms', data);
  else document.getElementById('recent-rooms').innerHTML =
    '<div style="font-size:13px;color:var(--muted);padding:12px 0">No rooms yet. Create one!</div>';
}

async function loadMyRooms() {
  document.getElementById('my-rooms-list').innerHTML =
    '<div style="font-size:13px;color:var(--muted);padding:12px 0">Loading…</div>';
  const { ok, data } = await API.get('/api/rooms/mine', true);
  if (ok) renderRoomList('my-rooms-list', data);
  else document.getElementById('my-rooms-list').innerHTML =
    '<div style="font-size:13px;color:var(--muted);padding:12px 0">Could not load rooms.</div>';
}

function renderRoomList(id, rooms) {
  const el = document.getElementById(id);
  if (!rooms || !rooms.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0">No rooms yet — create one above!</div>';
    return;
  }
  el.innerHTML = rooms.map(r => {
    const live = new Date(r.expires_at) > new Date();
    const dateStr = new Date(r.created_at).toLocaleDateString('en', {month:'short',day:'numeric',year:'numeric'});
    const isMyRooms = id === 'my-rooms-list';
    return `<div class="room-item" onclick="window.location.href='/room/${r.code}'">
      <div class="room-dot ${live ? 'live' : ''}"></div>
      <div class="room-item-info">
        <strong>${escapeHtml(r.name)}</strong>
        <span>${dateStr} · <span style="font-family:var(--mono);font-weight:600;color:var(--accent)">${r.code}</span>${r.topic ? ' · ' + escapeHtml(r.topic) : ''}</span>
      </div>
      ${r.is_public ? '<span class="badge public">Public</span>' : ''}
      ${live ? '<span class="badge live-badge">● Live</span>' : ''}
      ${isMyRooms ? `<button class="room-delete-btn" onclick="event.stopPropagation();openDeleteRoom('${r.code}', '${escapeHtml(r.name).replace(/'/g, "\\'")}')" title="Delete Room"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>` : ''}
      <button class="room-enter-btn" onclick="event.stopPropagation();window.location.href='/room/${r.code}'">Enter →</button>
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

// ── DELETE ROOM ────────────────────────────────────────────────
let roomToDelete = null;

function openDeleteRoom(code, name) {
  roomToDelete = code;
  document.getElementById('delete-room-name').textContent = name;
  document.getElementById('delete-room-code').textContent = code;
  openModal('modal-delete');
}

async function confirmDeleteRoom() {
  if (!roomToDelete) return;
  const btn = document.getElementById('delete-confirm-btn');
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Deleting...';
  
  const headers = { 'Authorization': 'Bearer ' + token };
  try {
    const res = await fetch(`/api/rooms/${roomToDelete}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete');
    
    showToast('Room permanently deleted');
    closeModal('modal-delete');
    loadRooms(); // Refresh lists
    if (document.getElementById('panel-rooms').classList.contains('active')) {
      loadMyRooms();
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    roomToDelete = null;
  }
}

// ── CREATE ROOM ────────────────────────────────────────────────
function openCreate() {
  createdRoom = null;
  document.getElementById('code-section').classList.add('hidden');
  document.getElementById('create-btn').textContent = 'Create Room';
  document.getElementById('create-btn').disabled = false;
  document.getElementById('room-name-input').value = '';
  openModal('modal-create');
  setTimeout(() => document.getElementById('room-name-input').focus(), 200);
}

async function handleCreate() {
  const btn = document.getElementById('create-btn');
  if (createdRoom) { window.location.href = '/room/' + createdRoom.code; return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  const name = document.getElementById('room-name-input').value.trim() || 'Study Room';
  const topic = document.getElementById('room-topic').value;
  const is_public = document.getElementById('room-public').checked;
  const { ok, data } = await API.post('/api/rooms/create', { name, topic, is_public }, true);
  if (!ok) {
    showToast('Failed to create room — ' + (data.error || 'please try again'));
    btn.disabled = false;
    btn.textContent = 'Create Room';
    return;
  }
  createdRoom = data;
  document.getElementById('room-code-display').textContent = data.code;
  document.getElementById('room-pin-display').textContent = data.pin;
  document.getElementById('share-link-text').textContent = `${window.location.origin}/join/${data.code}`;
  document.getElementById('code-section').classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Go to Room →';
  loadRooms();
}

// ── JOIN ────────────────────────────────────────────────────────
function openJoin() {
  document.getElementById('join-code').value = '';
  document.getElementById('join-pin').value = '';
  document.getElementById('join-err').classList.add('hidden');
  openModal('modal-join');
  setTimeout(() => document.getElementById('join-code').focus(), 200);
}

function openJoinLink() {
  document.getElementById('link-input').value = '';
  document.getElementById('link-pin').value = '';
  document.getElementById('link-err').classList.add('hidden');
  openModal('modal-link');
}

async function doJoinFromDash() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const pin = document.getElementById('join-pin').value.trim();
  const err = document.getElementById('join-err');
  err.classList.add('hidden');
  if (code.length < 4) { err.textContent = 'Enter a valid room code'; err.classList.remove('hidden'); return; }
  if (pin.length !== 4) { err.textContent = 'PIN must be exactly 4 digits'; err.classList.remove('hidden'); return; }
  const { ok, data } = await API.post('/api/rooms/validate', { code, pin });
  if (!ok) { err.textContent = data.error || 'Room not found or wrong PIN'; err.classList.remove('hidden'); return; }
  window.location.href = '/room/' + code;
}

async function doJoinLink() {
  const link = document.getElementById('link-input').value.trim();
  const pin = document.getElementById('link-pin').value.trim();
  const err = document.getElementById('link-err');
  err.classList.add('hidden');
  const match = link.match(/\/join\/([A-Z0-9]{4,8})/i) || link.match(/\/room\/([A-Z0-9]{4,8})/i);
  if (!match) { err.textContent = 'Invalid invite link'; err.classList.remove('hidden'); return; }
  if (pin.length !== 4) { err.textContent = 'PIN must be exactly 4 digits'; err.classList.remove('hidden'); return; }
  const code = match[1].toUpperCase();
  const { ok, data } = await API.post('/api/rooms/validate', { code, pin });
  if (!ok) { err.textContent = data.error || 'Room not found or wrong PIN'; err.classList.remove('hidden'); return; }
  window.location.href = '/room/' + code;
}

// ── COPY HELPERS ────────────────────────────────────────────────
function copyCode() {
  const code = document.getElementById('room-code-display').textContent;
  const pin = document.getElementById('room-pin-display').textContent;
  navigator.clipboard.writeText(`Room Code: ${code}\nPIN: ${pin}\nLink: ${window.location.origin}/join/${code}`);
  showToast('Code, PIN & link copied!');
}
function copyLink() {
  navigator.clipboard.writeText(document.getElementById('share-link-text').textContent);
  showToast('Link copied!');
}

// ── SCHEDULE ────────────────────────────────────────────────────
function openScheduleModal() {
  document.getElementById('sch-title').value = '';
  document.getElementById('sch-notes').value = '';
  openModal('modal-schedule');
  setTimeout(() => document.getElementById('sch-title').focus(), 200);
}

function saveSchedule() {
  const title = document.getElementById('sch-title').value.trim();
  const topic = document.getElementById('sch-topic').value;
  const datetime = document.getElementById('sch-datetime').value;
  const duration = document.getElementById('sch-duration').value;
  const notes = document.getElementById('sch-notes').value.trim();
  if (!title) { showToast('Please enter a session title'); return; }
  if (!datetime) { showToast('Please pick a date & time'); return; }
  const session = { id: Date.now(), title, topic, datetime, duration, notes };
  scheduleData.push(session);
  scheduleData.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  localStorage.setItem('sr_schedule', JSON.stringify(scheduleData));
  closeModal('modal-schedule');
  renderSchedule();
  showToast('Session scheduled!');
}

function deleteSchedule(id) {
  scheduleData = scheduleData.filter(s => s.id !== id);
  localStorage.setItem('sr_schedule', JSON.stringify(scheduleData));
  renderSchedule();
  showToast('Session removed');
}

function renderSchedule() {
  const list = document.getElementById('schedule-list');
  if (!list) return;
  const now = new Date();
  // Filter out past sessions older than 1h
  scheduleData = scheduleData.filter(s => new Date(s.datetime) > new Date(now - 3600000));
  localStorage.setItem('sr_schedule', JSON.stringify(scheduleData));

  if (!scheduleData.length) {
    list.innerHTML = `<div class="schedule-empty">
      <div class="empty-icon"><i data-lucide="calendar" style="width:32px;height:32px"></i></div>
      <h3>No sessions yet</h3>
      <p>Schedule study sessions to stay on track</p>
      <button class="btn-go" style="max-width:180px;border-radius:var(--radius-sm)" onclick="openScheduleModal()">＋ Add Session</button>
    </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  list.innerHTML = scheduleData.map(s => {
    const dt = new Date(s.datetime);
    const dateStr = dt.toLocaleDateString('en', {weekday:'short',month:'short',day:'numeric'});
    const timeStr = dt.toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'});
    const isPast = dt < now;
    return `<div class="schedule-item" style="${isPast ? 'opacity:0.5' : ''}">
      <div class="schedule-time">${timeStr}<br/><span style="font-size:10px;font-weight:400;color:var(--muted)">${dateStr}</span></div>
      <div class="schedule-info">
        <strong>${escapeHtml(s.title)}</strong>
        <span>${escapeHtml(s.topic)} · ${s.duration} min${s.notes ? ' · ' + escapeHtml(s.notes.slice(0,40)) : ''}</span>
      </div>
      <button class="schedule-delete" onclick="deleteSchedule(${s.id})" title="Remove"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

// ── MODALS ──────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  if (e.key === 'Enter' && document.getElementById('modal-join').classList.contains('open')) doJoinFromDash();
});

// ── LOGOUT ──────────────────────────────────────────────────────
function logout() {
  localStorage.removeItem('sr_token');
  localStorage.removeItem('sr_user');
  window.location.href = '/';
}
