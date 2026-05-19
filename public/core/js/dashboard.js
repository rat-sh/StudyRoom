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
  document.getElementById('greeting').textContent = `${g}, ${user.name.split(' ')[0]}`;

  loadRooms();
  renderSchedule();

  // Set schedule datetime min to now
  const dtInput = document.getElementById('sch-datetime');
  if (dtInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.min = now.toISOString().slice(0, 16);
  }

  loadMe();
  loadBuddies();
  loadTodos();
  loadActivity();
});

// ── SIDEBAR ────────────────────────────────────────────────────
let sbCollapsed = false;
function toggleSidebarCollapse() {
  sbCollapsed = !sbCollapsed;
  document.getElementById('dash-layout').classList.toggle('sb-collapsed', sbCollapsed);
  const icon = document.getElementById('sidebar-toggle-icon');
  if (icon) {
    icon.outerHTML = sbCollapsed
      ? '<i data-lucide="chevrons-right" id="sidebar-toggle-icon" style="width:16px;height:16px"></i>'
      : '<i data-lucide="chevrons-left" id="sidebar-toggle-icon" style="width:16px;height:16px"></i>';
    if (window.lucide) lucide.createIcons();
  }
}

// ── USER PROFILE / AVATAR ──────────────────────────────────────
async function loadMe() {
  const { ok, data } = await API.get('/api/users/me', true);
  if (ok && data) {
    if (data.avatar_url) {
      document.getElementById('sb-avatar').innerHTML = `<img src="${data.avatar_url}" alt="Avatar"/>`;
      document.getElementById('rp-avatar').innerHTML = `<img src="${data.avatar_url}" alt="Avatar"/>`;
    }
    document.getElementById('rp-name').textContent = data.name;
    document.getElementById('rp-email').textContent = data.email;
  }
}

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;

  // Validate file type
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    showToast('Only JPG, PNG, WebP or GIF images are allowed');
    input.value = '';
    return;
  }

  // Validate size — keep under 1.5MB so base64 stays under 10MB server limit
  if (file.size > 1.5 * 1024 * 1024) {
    showToast('Image must be smaller than 1.5 MB');
    input.value = '';
    return;
  }

  // Show loading state
  const editBtn = document.querySelector('.rp-avatar-edit');
  if (editBtn) editBtn.innerHTML = '<i data-lucide="loader" style="width:12px;height:12px"></i>';
  if (window.lucide) lucide.createIcons();

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const { ok, data } = await API.post('/api/users/avatar', { avatar_url: dataUrl }, true);
    if (ok) {
      document.getElementById('sb-avatar').innerHTML = `<img src="${dataUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
      document.getElementById('rp-avatar').innerHTML = `<img src="${dataUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
      // Update cached user object
      const u = API.user();
      if (u) { u.avatar_url = dataUrl; localStorage.setItem('sr_user', JSON.stringify(u)); }
      showToast('✅ Profile photo updated!');
    } else {
      showToast('❌ ' + (data?.error || 'Failed to upload. Try a smaller image.'));
    }
    // Restore camera icon
    if (editBtn) editBtn.innerHTML = '<i data-lucide="camera" style="width:12px;height:12px"></i>';
    if (window.lucide) lucide.createIcons();
    input.value = ''; // reset so same file can be re-selected
  };
  reader.onerror = () => {
    showToast('Failed to read file');
    if (editBtn) editBtn.innerHTML = '<i data-lucide="camera" style="width:12px;height:12px"></i>';
    if (window.lucide) lucide.createIcons();
  };
  reader.readAsDataURL(file);
}

// ── BUDDIES / FRIENDS ──────────────────────────────────────────
let buddiesList = [];
async function loadBuddies() {
  const { ok, data } = await API.get('/api/friends', true);
  if (ok) {
    buddiesList = data || [];
    renderBuddies();
  }
}

function renderBuddies() {
  const accepted = buddiesList.filter(b => b.status === 'accepted');
  const pending = buddiesList.filter(b => b.status === 'pending');
  document.getElementById('rp-buddy-count').textContent = accepted.length;

  const bList = document.getElementById('buddies-list');
  if (accepted.length === 0) {
    bList.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No buddies yet. Search above to add some!</div>';
  } else {
    bList.innerHTML = accepted.map(b => friendHtml(b)).join('');
  }

  const pList = document.getElementById('pending-list');
  if (pending.length === 0) {
    pList.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No pending requests.</div>';
  } else {
    pList.innerHTML = pending.map(b => friendHtml(b)).join('');
  }
  if (window.lucide) lucide.createIcons();
}

function friendHtml(b) {
  const f = b.friend;
  const isMeRequested = b.requested_by === user.id;
  const av = f.avatar_url ? `<img src="${f.avatar_url}"/>` : initials(f.name);
  let actions = '';
  if (b.status === 'accepted') {
    actions = `<button class="friend-action-btn remove" onclick="removeFriend('${b.relationId}')">Remove</button>`;
  } else if (isMeRequested) {
    actions = `<span style="font-size:11px;color:var(--muted)">Requested</span>
               <button class="friend-action-btn remove" onclick="removeFriend('${b.relationId}')" title="Cancel">✕</button>`;
  } else {
    actions = `<button class="friend-action-btn accept" onclick="acceptFriend('${b.relationId}')">Accept</button>
               <button class="friend-action-btn remove" onclick="removeFriend('${b.relationId}')">Reject</button>`;
  }
  return `
    <div class="friend-row">
      <div class="friend-av">${av}</div>
      <div style="flex:1;min-width:0;line-height:1.2">
        <div class="friend-name">${escapeHtml(f.name)}</div>
        <div class="friend-email">${escapeHtml(f.email)}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center">${actions}</div>
    </div>
  `;
}

let searchTimeout;
function searchFriends(q) {
  clearTimeout(searchTimeout);
  const resEl = document.getElementById('friend-search-results');
  if (!q || q.length < 2) { resEl.classList.add('hidden'); return; }
  
  searchTimeout = setTimeout(async () => {
    const { ok, data } = await API.get('/api/users/search?q=' + encodeURIComponent(q), true);
    if (!ok || !data.length) {
      resEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">No users found.</div>';
    } else {
      resEl.innerHTML = data.map(u => {
        const av = u.avatar_url ? `<img src="${u.avatar_url}"/>` : initials(u.name);
        // check if already friend or pending
        const existing = buddiesList.find(b => b.friend.id === u.id);
        let btn = `<button class="friend-action-btn add" onclick="sendFriendRequest('${u.id}')">Add Buddy</button>`;
        if (existing) {
          if (existing.status === 'accepted') btn = `<span style="font-size:11px;color:var(--muted)">Buddy</span>`;
          else btn = `<span style="font-size:11px;color:var(--muted)">Pending</span>`;
        }
        return `
          <div class="friend-row">
            <div class="friend-av">${av}</div>
            <div style="flex:1;min-width:0;line-height:1.2">
              <div class="friend-name">${escapeHtml(u.name)}</div>
              <div class="friend-email">${escapeHtml(u.email)}</div>
            </div>
            ${btn}
          </div>
        `;
      }).join('');
    }
    resEl.classList.remove('hidden');
  }, 300);
}

async function sendFriendRequest(targetId) {
  const { ok, data } = await API.post('/api/friends/request', { targetUserId: targetId }, true);
  if (ok) { showToast('Request sent'); loadBuddies(); document.getElementById('friend-search-input').value = ''; document.getElementById('friend-search-results').classList.add('hidden'); }
  else showToast(data.error || 'Failed to send request');
}
async function acceptFriend(id) {
  const { ok } = await API.post(`/api/friends/accept/${id}`, {}, true);
  if (ok) { showToast('Request accepted'); loadBuddies(); }
}
async function removeFriend(id) {
  const { ok } = await API.delete(`/api/friends/${id}`, true);
  if (ok) loadBuddies();
}

// ── TO-DO LIST ─────────────────────────────────────────────────
async function loadTodos() {
  const { ok, data } = await API.get('/api/todos', true);
  const list = document.getElementById('todo-list');
  if (!ok || !data) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">Failed to load tasks.</div>';
    return;
  }

  const active = data.filter(t => !t.is_completed);
  const completed = data.filter(t => t.is_completed);

  if (!data.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">No tasks yet. Hit + New Task!</div>';
    return;
  }

  function todoItemHtml(t) {
    const isShared = t.shared_with_user_id !== null;
    let sharedTag = '';
    if (isShared) {
      if (t.creator?.id === user.id)
        sharedTag = `<span class="todo-shared-badge" title="Shared with ${escapeHtml(t.shared_with?.name || '')}">Shared</span>`;
      else
        sharedTag = `<span class="todo-shared-badge" title="From ${escapeHtml(t.creator?.name || '')}">From ${escapeHtml((t.creator?.name || '').split(' ')[0])}</span>`;
    }
    const isDone = t.is_completed;
    return `
      <div class="todo-item">
        <button class="todo-check ${isDone ? 'done' : ''}" onclick="toggleTodo('${t.id}')" title="${isDone ? 'Mark incomplete' : 'Mark complete'}">
          ${isDone ? `<lottie-player src="https://fonts.gstatic.com/s/e/notoemoji/latest/2705/lottie.json" background="transparent" speed="1" style="width: 14px; height: 14px;" autoplay></lottie-player>` : ''}
        </button>
        <div class="todo-text ${isDone ? 'done' : ''}">${escapeHtml(t.title)}</div>
        ${sharedTag}
        ${t.creator?.id === user.id ? `<button class="todo-del" onclick="deleteTodo('${t.id}')" title="Delete"><lottie-player src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f5d1/lottie.json" background="transparent" speed="1" style="width: 16px; height: 16px;" hover></lottie-player></button>` : ''}
      </div>
    `;
  }

  let html = '';

  // Active tasks
  if (active.length) {
    html += active.map(todoItemHtml).join('');
  } else {
    html += '<div style="font-size:11px;color:var(--muted);padding:4px 0">All tasks done! 🎉</div>';
  }

  // Completed history — collapsible
  if (completed.length) {
    html += `
      <details style="margin-top:10px">
        <summary style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;cursor:pointer;list-style:none;display:flex;align-items:center;gap:4px;padding:4px 0">
          <i data-lucide="check-circle-2" style="width:12px;height:12px"></i>
          Completed (${completed.length})
        </summary>
        <div style="margin-top:6px;opacity:0.65">
          ${completed.map(todoItemHtml).join('')}
        </div>
      </details>
    `;
  }

  list.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function openAddTodo() {
  document.getElementById('todo-title-input').value = '';
  const select = document.getElementById('todo-share-select');
  const accepted = buddiesList.filter(b => b.status === 'accepted');
  select.innerHTML = '<option value="">Personal (just me)</option>' + 
    accepted.map(b => `<option value="${b.friend.id}">Share with ${escapeHtml(b.friend.name)}</option>`).join('');
  openModal('modal-todo');
  setTimeout(() => document.getElementById('todo-title-input').focus(), 200);
}

async function saveTodo() {
  const title = document.getElementById('todo-title-input').value;
  const shared = document.getElementById('todo-share-select').value;
  if (!title.trim()) return;
  const { ok, data } = await API.post('/api/todos', { title, shared_with_user_id: shared || null }, true);
  if (ok) { closeModal('modal-todo'); loadTodos(); }
  else showToast(data.error || 'Failed to add task');
}

async function toggleTodo(id) {
  await API.patch(`/api/todos/${id}/toggle`, {}, true);
  loadTodos(); // reload list
}

async function deleteTodo(id) {
  await API.delete(`/api/todos/${id}`, true);
  loadTodos();
}

// ── ACTIVITY CHART ─────────────────────────────────────────────
async function loadActivity() {
  const { ok, data } = await API.get('/api/activity', true);
  if (ok && data) {
    document.getElementById('rp-total-hours').textContent = data.totalHours + 'h';
    
    // find max for scaling
    let maxMin = 60; // minimum scale is 1 hr
    data.chart.forEach(d => { if (d.minutes > maxMin) maxMin = d.minutes; });
    
    const chart = document.getElementById('activity-chart');
    const labels = document.getElementById('activity-months');
    chart.innerHTML = '';
    labels.innerHTML = '';
    
    data.chart.forEach(d => {
      const h = Math.max(4, (d.minutes / maxMin) * 100);
      const hours = (d.minutes / 60).toFixed(1);
      chart.innerHTML += `<div class="activity-bar" style="height:${h}%" data-tip="${hours}h"></div>`;
      labels.innerHTML += `<span>${d.month}</span>`;
    });
  }
}

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
      <button class="room-delete-btn" onclick="event.stopPropagation();openDeleteRoom('${r.code}', '${escapeHtml(r.name).replace(/'/g, "\\'")}')" title="Delete Room"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
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
  const now = new Date();
  // Filter out past sessions older than 1h
  scheduleData = scheduleData.filter(s => new Date(s.datetime) > new Date(now - 3600000));
  localStorage.setItem('sr_schedule', JSON.stringify(scheduleData));

  const lists = [document.getElementById('schedule-list'), document.getElementById('home-schedule-list')].filter(Boolean);
  if (!lists.length) return;

  let html = '';
  if (!scheduleData.length) {
    html = `<div class="schedule-empty">
      <div class="empty-icon"><i data-lucide="calendar" style="width:32px;height:32px"></i></div>
      <h3>No sessions yet</h3>
      <p>Schedule study sessions to stay on track</p>
      <button class="btn-go" style="max-width:180px;border-radius:var(--radius-sm)" onclick="openScheduleModal()">＋ Add Session</button>
    </div>`;
  } else {
    html = scheduleData.map(s => {
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
  }

  lists.forEach(list => list.innerHTML = html);
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
