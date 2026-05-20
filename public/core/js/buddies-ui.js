/** Shared buddies dropdown + friend action card */
let _buddiesCache = [];

async function loadBuddiesForNav() {
  const token = API.token();
  if (!token) return [];
  const { ok, data } = await API.get('/api/friends', true);
  if (!ok) return [];
  _buddiesCache = (data || []).filter(b => b.status === 'accepted');
  return _buddiesCache;
}

function toggleBuddiesDropdown(e) {
  e?.stopPropagation();
  const dd = document.getElementById('buddies-dropdown');
  if (!dd) return;
  const open = dd.classList.toggle('open');
  if (open) renderBuddiesDropdown();
}

function closeBuddiesDropdown() {
  document.getElementById('buddies-dropdown')?.classList.remove('open');
  document.getElementById('friend-card-popover')?.classList.remove('open');
}

async function renderBuddiesDropdown() {
  const dd = document.getElementById('buddies-dropdown');
  if (!dd) return;
  await loadBuddiesForNav();
  const online = _buddiesCache.filter(b => window._buddyOnlineIds?.has?.(b.friend.id));
  const offline = _buddiesCache.filter(b => !window._buddyOnlineIds?.has?.(b.friend.id));

  function row(b, on) {
    const f = b.friend;
    const av = f.avatar_url
      ? `<img src="${escapeHtml(f.avatar_url)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`
      : initials(f.name);
    return `<div class="buddies-dd-row" onclick="openFriendCard(event, '${f.id}', '${escapeHtml(f.name).replace(/'/g, "\\'")}')">
      <div class="buddies-dd-av">${av}</div>
      <span class="buddies-dd-name">${escapeHtml(f.name)}</span>
      <span class="buddies-dd-dot ${on ? 'online' : ''}"></span>
    </div>`;
  }

  if (!_buddiesCache.length) {
    dd.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center">No buddies yet</div>';
    return;
  }

  let html = '';
  if (online.length) {
    html += '<div class="buddies-dd-section">Online</div>' + online.map(b => row(b, true)).join('');
  }
  if (offline.length) {
    html += '<div class="buddies-dd-section">Offline</div>' + offline.map(b => row(b, false)).join('');
  }
  dd.innerHTML = html;
}

function openFriendCard(e, friendId, friendName) {
  e.stopPropagation();
  closeBuddiesDropdown();
  let pop = document.getElementById('friend-card-popover');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'friend-card-popover';
    pop.className = 'friend-card-popover';
    document.body.appendChild(pop);
  }
  const x = Math.min(e.clientX, window.innerWidth - 280);
  const y = Math.min(e.clientY, window.innerHeight - 200);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  pop.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div class="buddies-dd-av" style="width:40px;height:40px">${initials(friendName)}</div>
      <div>
        <div style="font-weight:700;font-size:14px">${escapeHtml(friendName)}</div>
        <div style="font-size:11px;color:var(--muted)">Buddy</div>
      </div>
    </div>
    <div class="friend-card-actions">
      <button class="primary" onclick="friendActionChat('${friendId}')">💬 Chat</button>
      <button onclick="friendActionInvite()">🎥 Invite to Room</button>
      <button onclick="friendActionGames()">🎮 Games</button>
      <button onclick="closeFriendCard()">Close</button>
    </div>`;
  pop.classList.add('open');
  setTimeout(() => document.addEventListener('click', closeFriendCard, { once: true }), 10);
}

function closeFriendCard() {
  document.getElementById('friend-card-popover')?.classList.remove('open');
}

async function friendActionChat(friendSupabaseId) {
  closeFriendCard();
  const { ok, data } = await API.post(`/api/chat/dm/${friendSupabaseId}`, {}, true);
  if (ok) window.location.href = `/chat/${data._id}`;
  else showToast(data?.error || 'Could not open chat');
}

function friendActionInvite(friendId) {
  closeFriendCard();
  showToast('Open dashboard to create a room, then share the invite link');
  window.location.href = '/dashboard';
  const nav = document.getElementById('nav-home');
  if (nav) setTimeout(() => { if (typeof setPanel === 'function') setPanel('home', nav); }, 300);
}

function friendActionGames() {
  closeFriendCard();
  window.location.href = '/dashboard';
  setTimeout(() => {
    const nav = document.getElementById('nav-games');
    if (nav) setPanel('games', nav);
  }, 400);
}

document.addEventListener('click', () => closeBuddiesDropdown());
