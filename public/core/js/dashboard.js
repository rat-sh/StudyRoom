// ── AUTH GUARD ─────────────────────────────────────────────────
const token = API.token();
const user = API.user();
if (!token || !user) window.location.href = '/';

let createdRoom = null;
let scheduleData = JSON.parse(localStorage.getItem('sr_schedule') || '[]');

// ── DASHBOARD SOCKET — realtime todo/presence updates ──────────
// Dashboard has its own socket connection (separate from room.js)
// so logged-in users get live updates even when not in a room.
let _dashSocket = null;
function _initDashSocket() {
  if (_dashSocket) return;
  _dashSocket = io({ transports: ['websocket'] });

  // Join personal user room so server can target us directly
  _dashSocket.on('connect', () => {
    _dashSocket.emit('join-user-room', { userId: user.id });
    // Re-init privacy listeners after reconnect
    _initPrivacySocketListeners(_dashSocket);
  });

  // ── Bridge socket events → EventBus ──────────────────────────
  _dashSocket.on('todo-created',  todo => EventBus.emit('TODO_CREATED', todo));
  _dashSocket.on('todo-updated',  todo => {
    EventBus.emit('TODO_UPDATED', todo);
    const modal = document.getElementById('modal-todo-participants');
    if (modal?.classList.contains('open')) {
      const titleEl = document.getElementById('tp-title');
      if (titleEl && titleEl.textContent === todo.title) openTodoParticipants(todo.id);
    }
  });
  _dashSocket.on('todo-deleted', ({ id }) => EventBus.emit('TODO_DELETED', { id }));

  // Media events
  _dashSocket.on('FILE_UPLOADED', media => EventBus.emit('FILE_UPLOADED', media));
  _dashSocket.on('MEDIA_SHARED',  media => EventBus.emit('MEDIA_SHARED', media));
  _dashSocket.on('FILE_DELETED',  ({ id }) => EventBus.emit('FILE_DELETED', { id }));
  _dashSocket.on('FILE_EDITED',   payload  => EventBus.emit('FILE_EDITED', payload));

  // Subscribe to todos I'm a member of (for live progress bars)
  _dashSocket.on('connect', () => {
    (_todosCache || []).forEach(t => _dashSocket.emit('todo-subscribe', { todoId: t.id }));
  });

  // Room privacy: join-request notifications
  _initPrivacySocketListeners(_dashSocket);
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (typeof initAppSidebar === 'function') {
    initAppSidebar('home');
    applyDashboardPanelFromUrl();
    if (window.lucide) lucide.createIcons();
  }
  populateSidebarUser();
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
  loadTodos().then(() => {
    // Subscribe to all todo rooms after loading, then start socket
    _initDashSocket();
  });
  loadActivity();

  // ── Mobile bottom sheet toggle (< 500px) ────────────────────
  const rp = document.querySelector('.right-panel');
  if (rp) {
    rp.addEventListener('click', (e) => {
      // Only toggle when clicking the ::before drag handle area (top 20px)
      if (window.innerWidth <= 500 && e.offsetY < 20) {
        rp.classList.toggle('rp-expanded');
      }
    });
  }

  applySidebarLayout();
});

// ── USER PROFILE / AVATAR ──────────────────────────────────────
async function loadMe() {
  const { ok, data } = await API.get('/api/users/me', true);
  if (ok && data) {
    if (data.avatar_url) {
      const img = `<img src="${data.avatar_url}" alt="Avatar"/>`;
      document.getElementById('sb-avatar').innerHTML = img;
      document.getElementById('rp-avatar').innerHTML = img;
    }
    document.getElementById('sb-name-short').textContent = (data.name || user.name).split(' ')[0];
    document.getElementById('sidebar-user-tooltip').textContent = data.name || user.name;
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

// ── TO-DO LIST v2 — multi-member, per-user completion ──────────────────
let _todosCache = []; // local cache for socket updates
let _todoSelectedMembers = []; // member ids selected in modal

async function loadTodos() {
  const { ok, data } = await API.get('/api/todos', true);
  const list = document.getElementById('todo-list');
  if (!ok || !data) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">Failed to load tasks.</div>';
    return data;
  }
  _todosCache = data;
  renderTodos(data);
  return data; // ← so _initDashSocket can subscribe to todo rooms
}


function renderTodos(data) {
  const list = document.getElementById('todo-list');
  if (!data.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">No tasks yet. Hit + New Task!</div>';
    return;
  }

  // Split: tasks I haven't completed vs. tasks I have
  const active  = data.filter(t => !t.my_completed);
  const done    = data.filter(t => t.my_completed);

  function todoItemHtml(t) {
    const pct = t.completion_pct || 0;
    const total = t.total_members || 1;
    const completed = t.completed_count || 0;
    const isCreator = t.creator?.id === user.id;
    const memberCount = total > 1 ? `<span style="font-size:10px;color:var(--muted);margin-left:4px">${total} members</span>` : '';

    // Avatar stack (up to 3)
    const avatarStack = (t.members || []).slice(0, 3).map(m => {
      const initials = (m.name || '?').slice(0, 1).toUpperCase();
      const done_style = m.completed ? 'border-color:var(--accent)' : 'border-color:var(--border2)';
      return `<span title="${escapeHtml(m.name)}${m.completed ? ' ✓' : ''}" style="width:20px;height:20px;border-radius:50%;background:var(--bg3);border:2px solid;${done_style};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;margin-left:-4px;flex-shrink:0">${initials}</span>`;
    }).join('');

    return `
      <div class="todo-item" id="todo-${t.id}" style="display:flex;flex-direction:column;gap:6px;padding:10px 10px 8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);transition:border-color 0.2s">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="todo-check ${t.my_completed ? 'done' : ''}" onclick="toggleTodo('${t.id}')" title="${t.my_completed ? 'Mark incomplete' : 'Mark my completion'}" style="flex-shrink:0">
            ${t.my_completed ? `<lottie-player src="https://fonts.gstatic.com/s/e/notoemoji/latest/2705/lottie.json" background="transparent" speed="1" style="width:14px;height:14px;" autoplay></lottie-player>` : ''}
          </button>
          <div style="flex:1;min-width:0">
            <div class="todo-text ${t.my_completed ? 'done' : ''}" style="font-size:13px;font-weight:500">${escapeHtml(t.title)}</div>
            ${t.description ? `<div style="font-size:11px;color:var(--muted);margin-top:1px">${escapeHtml(t.description)}</div>` : ''}
          </div>
          ${memberCount}
          ${isCreator ? `<button class="todo-del" onclick="deleteTodo('${t.id}')" title="Delete" style="flex-shrink:0"><lottie-player src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f5d1/lottie.json" background="transparent" speed="1" style="width:14px;height:14px;" hover></lottie-player></button>` : ''}
        </div>
        ${total > 1 ? `
        <div onclick="openTodoParticipants('${t.id}')" style="cursor:pointer" title="Click to see who's done">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <div style="display:flex;align-items:center;gap:4px">
              ${avatarStack}
              <span style="font-size:10px;color:var(--muted);margin-left:6px">${completed}/${total} done</span>
            </div>
            <span style="font-size:10px;font-weight:700;color:${pct===100?'var(--accent)':'var(--muted)'}">${pct}%</span>
          </div>
          <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${pct===100?'var(--accent)':'linear-gradient(90deg,var(--accent),#00cec9)'};border-radius:3px;transition:width 0.5s ease"></div>
          </div>
        </div>` : ''}
      </div>
    `;
  }

  let html = active.map(todoItemHtml).join('') ||
    '<div style="font-size:11px;color:var(--muted);padding:4px 0">All your tasks are done! 🎉</div>';

  if (done.length) {
    html += `
      <details style="margin-top:10px">
        <summary style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;cursor:pointer;list-style:none;display:flex;align-items:center;gap:4px;padding:4px 0">
          <i data-lucide="check-circle-2" style="width:12px;height:12px"></i> Completed by me (${done.length})
        </summary>
        <div style="margin-top:6px;opacity:0.65">${done.map(todoItemHtml).join('')}</div>
      </details>`;
  }

  list.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

// ── Open participant details modal ──────────────────────────────────────
function openTodoParticipants(todoId) {
  const t = _todosCache.find(x => x.id === todoId);
  if (!t) return;
  document.getElementById('tp-title').textContent = escapeHtml(t.title);
  document.getElementById('tp-subtitle').textContent = `${t.completed_count}/${t.total_members} completed · ${t.completion_pct}%`;

  const memberList = document.getElementById('tp-members-list');
  memberList.innerHTML = (t.members || []).map(m => {
    const initials = (m.name || '?').slice(0, 1).toUpperCase();
    const doneStyle = m.completed ? 'color:var(--accent)' : 'color:var(--muted)';
    const doneLabel = m.completed
      ? `<span style="font-size:11px;color:var(--accent);font-weight:600">✓ Done</span>`
      : `<span style="font-size:11px;color:var(--muted)">Pending</span>`;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg2);border-radius:var(--radius-sm)">
        <div style="width:34px;height:34px;border-radius:50%;background:var(--bg3);border:2px solid ${m.completed?'var(--accent)':'var(--border2)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${initials}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${escapeHtml(m.name)}</div>
          ${m.completed && m.completed_at ? `<div style="font-size:10px;color:var(--muted)">${new Date(m.completed_at).toLocaleString()}</div>` : ''}
        </div>
        ${doneLabel}
      </div>`;
  }).join('');

  openModal('modal-todo-participants');
}

// ── Add todo modal — multi-member chips ─────────────────────────────────
function openAddTodo() {
  _todoSelectedMembers = [];
  document.getElementById('todo-title-input').value = '';
  document.getElementById('todo-desc-input').value = '';
  document.getElementById('todo-member-chips').innerHTML = '';
  document.getElementById('todo-member-search').value = '';
  document.getElementById('todo-buddy-dropdown').style.display = 'none';
  openModal('modal-todo');
  setTimeout(() => document.getElementById('todo-title-input').focus(), 200);
}

function filterTodoBuddies(query) {
  const drop = document.getElementById('todo-buddy-dropdown');
  const accepted = buddiesList.filter(b => b.status === 'accepted');
  const q = query.toLowerCase().trim();
  const filtered = accepted.filter(b =>
    b.friend.name.toLowerCase().includes(q) &&
    !_todoSelectedMembers.includes(b.friend.id)
  );
  if (!filtered.length || !q) { drop.style.display = 'none'; return; }
  drop.innerHTML = filtered.map(b => `
    <div onclick="addTodoMember('${b.friend.id}','${escapeHtml(b.friend.name)}')"
         style="padding:8px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;transition:background 0.15s"
         onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <span style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:white;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${b.friend.name.slice(0,1).toUpperCase()}</span>
      ${escapeHtml(b.friend.name)}
    </div>`).join('');
  drop.style.display = 'block';
}

function addTodoMember(id, name) {
  if (_todoSelectedMembers.includes(id)) return;
  _todoSelectedMembers.push(id);
  const chips = document.getElementById('todo-member-chips');
  const chip = document.createElement('div');
  chip.id = `chip-${id}`;
  chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--bg3);border:1px solid var(--border2);border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600';
  chip.innerHTML = `${escapeHtml(name)} <span onclick="removeTodoMember('${id}')" style="cursor:pointer;color:var(--muted);font-size:14px;line-height:1;margin-left:2px">×</span>`;
  chips.appendChild(chip);
  document.getElementById('todo-member-search').value = '';
  document.getElementById('todo-buddy-dropdown').style.display = 'none';
}

function removeTodoMember(id) {
  _todoSelectedMembers = _todoSelectedMembers.filter(x => x !== id);
  const chip = document.getElementById(`chip-${id}`);
  if (chip) chip.remove();
}

async function saveTodo() {
  const title = document.getElementById('todo-title-input').value.trim();
  const description = document.getElementById('todo-desc-input').value.trim();
  if (!title) { showToast('Please enter a task title'); return; }
  const { ok, data } = await API.post('/api/todos', {
    title,
    description: description || null,
    member_ids: _todoSelectedMembers
  }, true);
  if (ok) {
    closeModal('modal-todo');
    _todosCache.unshift(data);
    renderTodos(_todosCache);
    // Subscribe to realtime updates for this new todo
    if (_dashSocket) _dashSocket.emit('todo-subscribe', { todoId: data.id });
    showToast('✅ Task created');
  } else {
    showToast(data?.error || 'Failed to add task');
  }
}

async function toggleTodo(id) {
  const { ok, data } = await API.patch(`/api/todos/${id}/toggle`, {}, true);
  if (ok) {
    // Update cache and re-render (no full reload)
    const idx = _todosCache.findIndex(t => t.id === id);
    if (idx !== -1) _todosCache[idx] = data;
    renderTodos(_todosCache);
  }
}

async function deleteTodo(id) {
  const { ok } = await API.delete(`/api/todos/${id}`, true);
  if (ok) {
    _todosCache = _todosCache.filter(t => t.id !== id);
    renderTodos(_todosCache);
    showToast('🗑️ Task deleted');
  }
}

// Realtime: socket updates for todos (when another member toggles)
if (window.EventBus) {
  EventBus.on('TODO_UPDATED', (todo) => {
    const idx = _todosCache.findIndex(t => t.id === todo.id);
    if (idx !== -1) { _todosCache[idx] = todo; renderTodos(_todosCache); }
  });
  EventBus.on('TODO_CREATED', (todo) => {
    if (!_todosCache.find(t => t.id === todo.id)) {
      _todosCache.unshift(todo);
      renderTodos(_todosCache);
    }
  });
  EventBus.on('TODO_DELETED', ({ id }) => {
    _todosCache = _todosCache.filter(t => t.id !== id);
    renderTodos(_todosCache);
  });
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
  const panel = document.getElementById('panel-' + id);
  if (!panel) return;
  panel.classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'rooms') loadMyRooms();
  if (id === 'friends') loadFriendsActivity();
  if (id === 'media' && typeof loadMedia === 'function') loadMedia();
  if (id === 'friends' && typeof renderBuddiesDropdown === 'function') loadBuddies().then(() => renderBuddiesDropdown());
}

function openBuddiesFromProfile(e) {
  e?.stopPropagation();
  setPanel('friends', document.getElementById('nav-friends'));
  setTimeout(() => {
    const dd = document.getElementById('buddies-dropdown');
    if (dd) { renderBuddiesDropdown(); dd.classList.add('open'); }
  }, 80);
}

// ── ROOMS ──────────────────────────────────────────────────────
// ── BUG FIX: purge expired rooms from localStorage cache on every load
function _purgeExpiredJoined() {
  const now = new Date();
  let joined = JSON.parse(localStorage.getItem('sr_joined_rooms') || '[]');
  joined = joined.filter(r => !r.expires_at || new Date(r.expires_at) > now);
  localStorage.setItem('sr_joined_rooms', JSON.stringify(joined));
  return joined;
}

async function loadRooms() {
  const { ok, data } = await API.get('/api/rooms/mine', true);
  // Get live server rooms — these are the source of truth
  const serverCodes = new Set((ok && data) ? data.map(r => r.code) : []);
  // Purge expired entries, then also remove any that now exist in server list (avoid duplicates)
  const joined = _purgeExpiredJoined().filter(jr => !serverCodes.has(jr.code));
  let all = (ok && data) ? [...data] : [];
  joined.forEach(jr => all.push({ ...jr, is_joined: true }));
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (all.length > 0) renderRoomList('recent-rooms', all);
  else document.getElementById('recent-rooms').innerHTML =
    '<div style="font-size:13px;color:var(--muted);padding:12px 0">No rooms yet. Create or join one!</div>';
}

async function loadMyRooms() {
  document.getElementById('my-rooms-list').innerHTML =
    '<div style="font-size:13px;color:var(--muted);padding:12px 0">Loading…</div>';
  const { ok, data } = await API.get('/api/rooms/mine', true);
  const serverCodes = new Set((ok && data) ? data.map(r => r.code) : []);
  const joined = _purgeExpiredJoined().filter(jr => !serverCodes.has(jr.code));
  let all = (ok && data) ? [...data] : [];
  joined.forEach(jr => all.push({ ...jr, is_joined: true }));
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (all.length > 0) renderRoomList('my-rooms-list', all);
  else document.getElementById('my-rooms-list').innerHTML =
    '<div style="font-size:13px;color:var(--muted);padding:12px 0">No rooms yet.</div>';
}

function renderRoomList(id, rooms, showActions = true) {
  const el = document.getElementById(id);
  if (!rooms || !rooms.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0">No rooms yet — create or join one above!</div>';
    return;
  }
  el.innerHTML = rooms.map(r => {
    const live = new Date(r.expires_at) > new Date();
    const vis  = r.visibility || (r.is_public ? 'public' : 'private');
    const dateStr = new Date(r.created_at).toLocaleDateString('en', {month:'short',day:'numeric',year:'numeric'});
    const visiBadge = {
      public:    '<span class="badge badge-public">🌐 Public</span>',
      protected: '<span class="badge badge-protected">🔒 Protected</span>',
      private:   '<span class="badge badge-private">🔐 Private</span>',
    }[vis] || '';
    const isJoined = !!r.is_joined;
    const tooltipTitle = isJoined ? 'Leave Room' : 'Delete Room';
    const deleteIcon = isJoined ? 'log-out' : 'trash-2';

    // Friends-activity rooms: show Request Access instead of Enter
    const isFriend = r._isFriendRoom;
    const joinAction = isFriend && vis === 'protected'
      ? `<button class="room-enter-btn" onclick="event.stopPropagation();openRequestAccess('${r.code}','${escapeHtml(r.name).replace(/'/g,"\\'")}')">Request Access</button>`
      : isFriend && vis === 'public'
      ? `<button class="room-enter-btn" onclick="event.stopPropagation();window.location.href='/room/${r.code}'">Join →</button>`
      : showActions
      ? `<button class="room-delete-btn" onclick="event.stopPropagation();openDeleteRoom('${r.code}','${escapeHtml(r.name).replace(/'/g,"\\'")}'${isJoined ? ', true' : ''})" title="${tooltipTitle}"><i data-lucide="${deleteIcon}" style="width:14px;height:14px"></i></button>
         <button class="room-enter-btn" onclick="event.stopPropagation();window.location.href='/room/${r.code}'">Enter →</button>`
      : '';
    return `<div class="room-item" onclick="window.location.href='/room/${r.code}'">
      <div class="room-dot ${live ? 'live' : ''}"></div>
      <div class="room-item-info">
        <strong>${escapeHtml(r.name)}</strong>
        <span>${dateStr}${isJoined ? ' <span style="color:var(--accent);font-weight:600">(Joined)</span>' : ''} · <span style="font-family:var(--mono);font-weight:600;color:var(--accent)">${r.code}</span>${r.topic ? ' · ' + escapeHtml(r.topic) : ''}</span>
      </div>
      ${visiBadge}
      ${live ? '<span class="badge live-badge">● Live</span>' : ''}
      ${joinAction}
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

// ── DELETE ROOM ────────────────────────────────────────────────
let roomToDelete = null;
let roomToDeleteIsJoined = false;

function openDeleteRoom(code, name, isJoined = false) {
  roomToDelete = code;
  roomToDeleteIsJoined = isJoined;
  document.getElementById('delete-room-name').textContent = name;
  document.getElementById('delete-room-code').textContent = code;

  // Dynamically swap modal content based on ownership
  if (isJoined) {
    document.getElementById('delete-modal-title-text').textContent = 'Leave Room';
    document.getElementById('delete-modal-icon').setAttribute('data-lucide', 'log-out');
    document.getElementById('delete-modal-title').style.color = 'var(--accent)';
    document.getElementById('delete-modal-sub').textContent = 'This will remove the room from your dashboard. You can always rejoin using the invite code.';
    document.getElementById('delete-confirm-icon').setAttribute('data-lucide', 'log-out');
    document.getElementById('delete-confirm-text').textContent = 'Leave Room';
    document.getElementById('delete-confirm-btn').style.background = 'var(--accent)';
  } else {
    document.getElementById('delete-modal-title-text').textContent = 'Delete Room';
    document.getElementById('delete-modal-icon').setAttribute('data-lucide', 'trash-2');
    document.getElementById('delete-modal-title').style.color = 'var(--danger)';
    document.getElementById('delete-modal-sub').textContent = 'This will permanently delete the room. This action cannot be undone.';
    document.getElementById('delete-confirm-icon').setAttribute('data-lucide', 'trash-2');
    document.getElementById('delete-confirm-text').textContent = 'Delete Permanently';
    document.getElementById('delete-confirm-btn').style.background = 'var(--danger)';
  }
  if (window.lucide) lucide.createIcons();
  openModal('modal-delete');
}

async function confirmDeleteRoom() {
  if (!roomToDelete) return;
  const code = roomToDelete;
  const btn = document.getElementById('delete-confirm-btn');
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> ' + (roomToDeleteIsJoined ? 'Leaving...' : 'Deleting...');

  // Helper: purge a room code from sr_joined_rooms localStorage
  function purgeFromJoined(roomCode) {
    const joined = JSON.parse(localStorage.getItem('sr_joined_rooms') || '[]');
    const filtered = joined.filter(r => r.code !== roomCode);
    localStorage.setItem('sr_joined_rooms', JSON.stringify(filtered));
  }

  if (roomToDeleteIsJoined) {
    // Joined rooms: just remove from local view, no server call
    purgeFromJoined(code);
    showToast('✅ Room removed from your dashboard');
    closeModal('modal-delete');
    loadRooms();
    if (document.getElementById('panel-rooms').classList.contains('active')) loadMyRooms();
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    roomToDelete = null;
    roomToDeleteIsJoined = false;
    return;
  }

  // Owner: call DELETE API
  const headers = { 'Authorization': 'Bearer ' + token };
  try {
    const res = await fetch(`/api/rooms/${code}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (!res.ok) {
      // If 403/404 — room is already gone or not theirs. Still clean up local cache.
      if (res.status === 403 || res.status === 404) {
        purgeFromJoined(code);
        showToast('✅ Room removed from dashboard');
        closeModal('modal-delete');
        loadRooms();
        if (document.getElementById('panel-rooms').classList.contains('active')) loadMyRooms();
        return;
      }
      throw new Error(data.error || 'Failed to delete');
    }
    purgeFromJoined(code);
    showToast('✅ Room permanently deleted');
    closeModal('modal-delete');
    loadRooms();
    if (document.getElementById('panel-rooms').classList.contains('active')) loadMyRooms();
  } catch (err) {
    showToast('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    roomToDelete = null;
    roomToDeleteIsJoined = false;
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
  const name       = document.getElementById('room-name-input').value.trim() || 'Study Room';
  const topic      = document.getElementById('room-topic').value;
  const visibility = document.getElementById('room-visibility')?.value || 'protected';
  let payload = { name, topic, visibility };
  let { ok, data } = await API.post('/api/rooms/create', payload, true);
  if (!ok && data?.error?.includes('visibility')) {
    payload = { name, topic, is_public: visibility === 'public' };
    ({ ok, data } = await API.post('/api/rooms/create', payload, true));
  }
  if (!ok) {
    showToast('Failed to create room — ' + (data?.error || 'please try again'));
    btn.disabled = false;
    btn.textContent = 'Create Room';
    return;
  }
  createdRoom = data;
  document.getElementById('room-code-display').textContent = data.code;
  document.getElementById('room-pin-display').textContent  = data.pin;
  document.getElementById('share-link-text').textContent   = `${window.location.origin}/join/${data.code}`;
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

// ── JOIN RESOLVER: handles public / protected / private logic ──
async function _resolveRoomJoin(code, pin, errEl) {
  const { ok: infoOk, data: info } = await API.get(`/api/rooms/info/${code}`, true);
  if (!infoOk) { errEl.textContent = info.error || 'Room not found'; errEl.classList.remove('hidden'); return false; }

  const vis = info.visibility || (info.is_public ? 'public' : 'private');

  // PRIVATE — nothing exposed
  if (vis === 'private') {
    if (!pin || pin.length !== 4) { errEl.textContent = 'This room is private. Enter the PIN or use an invite link.'; errEl.classList.remove('hidden'); return false; }
    const { ok, data } = await API.post('/api/rooms/validate', { code, pin });
    if (!ok) { errEl.textContent = data.error || 'Wrong PIN'; errEl.classList.remove('hidden'); return false; }
    return true;
  }

  if (new Date(info.expires_at) < new Date()) { errEl.textContent = 'This room has expired'; errEl.classList.remove('hidden'); return false; }

  // PUBLIC — direct join, no PIN
  if (vis === 'public') {
    const { ok, data } = await API.post('/api/rooms/join-public', { code });
    if (!ok) { errEl.textContent = data.error || 'Failed to join room'; errEl.classList.remove('hidden'); return false; }
    return true;
  }

  // PROTECTED — need PIN or request access
  if (vis === 'protected') {
    if (pin && pin.length === 4) {
      const { ok, data } = await API.post('/api/rooms/validate', { code, pin });
      if (!ok) { errEl.textContent = data.error || 'Wrong PIN'; errEl.classList.remove('hidden'); return false; }
      return true;
    }
    // No PIN — offer request access flow
    errEl.textContent = 'This room is protected. Enter a PIN or request access from the owner.';
    errEl.classList.remove('hidden');
    // Show request-access modal if they are a friend
    openRequestAccess(code, info.name || code);
    return false;
  }

  // Fallback: PIN required
  if (!pin || pin.length !== 4) { errEl.textContent = 'PIN must be exactly 4 digits'; errEl.classList.remove('hidden'); return false; }
  const { ok, data } = await API.post('/api/rooms/validate', { code, pin });
  if (!ok) { errEl.textContent = data.error || 'Room not found or wrong PIN'; errEl.classList.remove('hidden'); return false; }
  return true;
}

async function doJoinFromDash() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const pin = document.getElementById('join-pin').value.trim();
  const err = document.getElementById('join-err');
  err.classList.add('hidden');
  if (code.length < 4) { err.textContent = 'Enter a valid room code'; err.classList.remove('hidden'); return; }
  const ok = await _resolveRoomJoin(code, pin, err);
  if (ok) window.location.href = '/room/' + code;
}

async function doJoinLink() {
  const link = document.getElementById('link-input').value.trim();
  const pin = document.getElementById('link-pin').value.trim();
  const err = document.getElementById('link-err');
  err.classList.add('hidden');
  const match = link.match(/\/join\/([A-Z0-9]{4,8})/i) || link.match(/\/room\/([A-Z0-9]{4,8})/i);
  if (!match) { err.textContent = 'Invalid invite link'; err.classList.remove('hidden'); return; }
  const code = match[1].toUpperCase();
  const ok = await _resolveRoomJoin(code, pin, err);
  if (ok) window.location.href = '/room/' + code;
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

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  if (e.key === 'Enter' && document.getElementById('modal-join').classList.contains('open')) doJoinFromDash();
});

// ── MUSIC PRESENCE (EventBus) ──────────────────────────────────
if (window.EventBus) {
  window.EventBus.on('MUSIC_PRESENCE_UPDATE', (state) => {
    const presenceBox = document.getElementById('sb-music-presence');
    const art = document.getElementById('sb-music-art');
    const txt = document.getElementById('sb-music-text');
    if (!presenceBox || !art || !txt) return;

    if (state.playing && state.track) {
      presenceBox.style.display = 'flex';
      txt.textContent = 'Listening to ' + state.track.title + ' • ' + state.track.artist;
      if (state.track.thumbnail) {
        art.src = state.track.thumbnail;
        art.style.display = 'block';
      } else {
        art.style.display = 'none';
      }
    } else {
      presenceBox.style.display = 'none';
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// ROOM PRIVACY SYSTEM — NEW FUNCTIONS
// ══════════════════════════════════════════════════════════════════

// ── Visibility selector in Create Room modal ─────────────────────
function selectVisibility(vis) {
  document.getElementById('room-visibility').value = vis;
  ['public', 'protected', 'private'].forEach(v => {
    const el = document.getElementById(`vopt-${v}`);
    if (!el) return;
    if (v === vis) {
      el.style.border = '2px solid var(--accent)';
      el.style.background = 'var(--accent-faint, rgba(99,102,241,0.08))';
    } else {
      el.style.border = '2px solid var(--border)';
      el.style.background = '';
    }
  });
}

// ── Friends Activity — rooms visible to me ────────────────────────
async function loadFriendsActivity() {
  const el = document.getElementById('friends-activity-list');
  if (!el) return;
  const { ok, data } = await API.get('/api/rooms/friends-activity', true);
  if (!ok || !data.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No active rooms from your buddies right now.</div>';
    return;
  }
  const tagged = data.map(r => ({ ...r, _isFriendRoom: true }));
  renderRoomList('friends-activity-list', tagged, false);
}

// ── Request Access (Protected Room) ──────────────────────────────
let _requestAccessCode = null;
function openRequestAccess(code, name) {
  _requestAccessCode = code;
  const nameEl = document.getElementById('ra-room-name');
  const codeEl = document.getElementById('ra-room-code');
  if (nameEl) nameEl.textContent = name || code;
  if (codeEl) codeEl.textContent = code;
  const msgEl = document.getElementById('ra-message');
  if (msgEl) msgEl.value = '';
  openModal('modal-request-access');
}

async function submitJoinRequest() {
  if (!_requestAccessCode) return;
  const message = document.getElementById('ra-message')?.value.trim() || '';
  const { ok, data } = await API.post('/api/rooms/request-join', {
    code: _requestAccessCode,
    message,
  }, true);

  if (!ok) {
    showToast('❌ ' + (data.error || 'Could not send request'));
    return;
  }

  // Also push via socket so owner gets real-time notification
  if (window._dashSocket) {
    window._dashSocket.emit('room-join-request', {
      roomCode:      _requestAccessCode,
      requesterId:   user.id,
      requesterName: user.name || user.email || 'Someone',
      message,
    });
  }

  closeModal('modal-request-access');
  showToast('✅ Access request sent! Waiting for owner approval.');
}

// ── Owner: respond to a join request ─────────────────────────────
let _pendingJoinRequest = null; // { requesterId, roomCode, requestId }

async function respondToJoinRequest(decision) {
  if (!_pendingJoinRequest) return;
  const { requesterId, roomCode, requestId } = _pendingJoinRequest;

  const { ok, data } = await API.post('/api/rooms/respond-request', { requestId, decision }, true);
  if (!ok) { showToast('Failed to respond: ' + (data.error || '')); return; }

  // Notify requester via socket
  if (window._dashSocket) {
    window._dashSocket.emit('room-request-respond', {
      requesterId,
      roomCode,
      decision,
      pin: decision === 'accepted' ? data.pin : null,
    });
  }

  document.getElementById('join-request-bar').style.display = 'none';
  _pendingJoinRequest = null;
  showToast(decision === 'accepted' ? '✅ Access granted!' : '🚫 Request rejected');
}

// ── Requester: join after being approved ──────────────────────────
let _approvedRoomCode = null;
function joinAfterApproval() {
  if (_approvedRoomCode) window.location.href = '/room/' + _approvedRoomCode;
}

// ── User Search (by email / name) ────────────────────────────────
async function searchUsers(query) {
  const resultsEl = document.getElementById('user-search-results');
  if (!resultsEl) return;
  if (!query || query.length < 2) { resultsEl.innerHTML = ''; return; }

  const { ok, data } = await API.get(`/api/rooms/users/search?q=${encodeURIComponent(query)}`, true);
  if (!ok || !data.length) {
    resultsEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px">No users found.</div>';
    return;
  }

  resultsEl.innerHTML = data.map(u => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);cursor:default">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">
        ${u.avatar_url ? `<img src="${u.avatar_url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">` : (u.name||'?')[0].toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${escapeHtml(u.name || 'Unknown')}</div>
        <div style="font-size:11px;color:var(--muted)">${escapeHtml(u.email || '')}</div>
      </div>
      ${u.is_friend
        ? '<span style="font-size:11px;color:#22c55e;font-weight:600">✓ Buddy</span>'
        : `<button onclick="sendFriendRequestFromSearch('${u.id}')" style="padding:4px 12px;border-radius:6px;background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:600;cursor:pointer">Add Buddy</button>`
      }
    </div>`).join('');
}

async function sendFriendRequestFromSearch(userId) {
  const { ok, data } = await API.post(`/api/friends/request/${userId}`, {}, true);
  if (ok) { showToast('✅ Buddy request sent!'); searchUsers(document.getElementById('user-search-input')?.value || ''); }
  else showToast('❌ ' + (data.error || 'Failed to send request'));
}

// ══════════════════════════════════════════════════════════════════
// SOCKET: real-time join-request notifications
// ══════════════════════════════════════════════════════════════════
function _initPrivacySocketListeners(sock) {
  window._dashSocket = sock;

  // Owner receives a join request from a friend
  sock.on('room-join-request-incoming', async ({ roomCode, requesterId, requesterName, message, requestedAt }) => {
    // Fetch pending request id from server (for the respond API)
    const { ok, data: pending } = await API.get('/api/rooms/pending-requests', true);
    const req = ok ? pending.find(r => r.requester_id === requesterId && r.room_code === roomCode) : null;

    _pendingJoinRequest = { requesterId, roomCode, requestId: req?.id };

    const bar = document.getElementById('join-request-bar');
    const txt = document.getElementById('jrb-text');
    if (bar && txt) {
      txt.textContent = `🔔 ${requesterName} wants to join your protected room (${roomCode})${message ? ': "' + message + '"' : ''}`;
      bar.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
    }
  });

  // Requester receives the decision
  sock.on('room-request-decision', ({ roomCode, decision, pin }) => {
    const bar = document.getElementById('request-decision-bar');
    const txt = document.getElementById('rdb-text');
    const joinBtn = document.getElementById('rdb-join-btn');
    if (!bar || !txt) return;

    if (decision === 'accepted') {
      _approvedRoomCode = roomCode;
      bar.style.background = '#16a34a';
      bar.style.color = '#fff';
      txt.textContent = `✅ Your access request for room ${roomCode} was accepted!`;
      if (joinBtn) { joinBtn.style.display = 'block'; }
      // If PIN returned, store it for direct join
      if (pin) { window._approvedPin = pin; }
    } else {
      bar.style.background = '#dc2626';
      bar.style.color = '#fff';
      txt.textContent = `🚫 Your access request for room ${roomCode} was rejected.`;
      if (joinBtn) joinBtn.style.display = 'none';
    }
    bar.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
    setTimeout(() => { if (bar) bar.style.display = 'none'; }, 12000);
  });
}

// Override joinAfterApproval to auto-use PIN if available
function joinAfterApproval() {
  if (!_approvedRoomCode) return;
  const pin = window._approvedPin || '';
  window.location.href = `/room/${_approvedRoomCode}${pin ? '?pin=' + pin : ''}`;
}
