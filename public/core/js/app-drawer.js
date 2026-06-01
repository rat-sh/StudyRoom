/**
 * Global quick panel (right drawer) — available on dashboard, lobby, chat, chess, etc.
 * Open state persists in localStorage across page navigations.
 */

const APP_DRAWER_KEY = 'sr_app_drawer_open';

function isDrawerOpen() {
  const stored = localStorage.getItem(APP_DRAWER_KEY);
  if (stored === null) return window.innerWidth > 960;
  return stored === '1';
}

function setDrawerOpen(open) {
  localStorage.setItem(APP_DRAWER_KEY, open ? '1' : '0');
  applyAppDrawerState();
}

function toggleAppDrawer() {
  const layout = getAppLayout();
  if (!layout) return;
  const open = layout.classList.contains('drawer-open');
  setDrawerOpen(!open);
}

function applyAppDrawerState() {
  const layout = getAppLayout();
  if (!layout) return;
  const open = isDrawerOpen();
  const isDash = typeof isDashboardPage === 'function' && isDashboardPage();

  if (isDash) {
    layout.classList.toggle('drawer-closed', !open);
    layout.classList.toggle('drawer-open', open);
  } else {
    layout.classList.toggle('drawer-open', open);
  }

  const navBtn = document.getElementById('nav-drawer');
  if (navBtn) navBtn.classList.toggle('active', open);

  const fab = document.getElementById('app-drawer-fab');
  if (fab) fab.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function getDrawerMarkup() {
  return `
    <div class="rp-card profile-card">
      <div class="rp-profile-header">
        <div class="rp-avatar-wrap">
          <div class="rp-avatar" id="ad-avatar">?</div>
        </div>
        <div>
          <div class="rp-name" id="ad-name">...</div>
          <div class="rp-email" id="ad-email"></div>
        </div>
        <button type="button" class="rp-settings-btn" onclick="window.location.href='/dashboard?panel=settings'" title="Settings">
          <i data-lucide="settings" style="width:16px;height:16px"></i>
        </button>
      </div>
      <div class="rp-buddies-row buddies-dropdown-wrap" id="ad-buddies-row" onclick="openBuddiesFromDrawer(event)" style="cursor:pointer" title="Buddies">
        <i data-lucide="users" style="width:13px;height:13px;color:var(--muted)"></i>
        <span id="ad-buddy-count" style="font-size:12px;font-weight:600">0</span>
        <span style="font-size:12px;color:var(--muted)">Buddies ▾</span>
        <div class="buddies-dropdown" id="buddies-dropdown" onclick="event.stopPropagation()"></div>
      </div>
    </div>
    <div class="rp-card activity-card">
      <div class="rp-card-header">
        <span class="rp-card-title">Activity</span>
        <span class="rp-activity-total" id="ad-total-hours">0h</span>
      </div>
      <div class="activity-chart" id="ad-activity-chart"></div>
      <div class="activity-months" id="ad-activity-months"></div>
    </div>
    <div class="rp-card todo-card">
      <div class="rp-card-header">
        <span class="rp-card-title">To-Do</span>
        <button type="button" class="todo-add-btn" onclick="window.location.href='/dashboard?panel=home'" title="Manage on dashboard">
          <i data-lucide="external-link" style="width:14px;height:14px"></i>
        </button>
      </div>
      <div id="ad-todo-list" class="todo-list" style="font-size:12px;color:var(--muted)">Loading…</div>
    </div>
    <div class="rp-card" style="padding:10px">
      <button type="button" class="btn-go" style="width:100%;font-size:12px;padding:8px" onclick="window.location.href='/chat'">
        <i data-lucide="message-square" style="width:14px;height:14px;margin-right:6px"></i> Open Messages
      </button>
    </div>
  `;
}

function ensureDrawerFab() {
  if (document.getElementById('app-drawer-fab')) return;
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'app-drawer-fab';
  fab.className = 'app-drawer-fab';
  fab.title = 'Open quick panel';
  fab.setAttribute('aria-label', 'Open quick panel');
  fab.innerHTML = '<i data-lucide="panel-right" style="width:22px;height:22px"></i>';
  fab.onclick = () => setDrawerOpen(true);
  document.body.appendChild(fab);

  if (!document.getElementById('app-drawer-backdrop')) {
    const bd = document.createElement('div');
    bd.id = 'app-drawer-backdrop';
    bd.className = 'app-drawer-backdrop';
    bd.onclick = () => setDrawerOpen(false);
    document.body.appendChild(bd);
  }
}

function ensureInjectedDrawer() {
  const layout = getAppLayout();
  if (!layout) return null;

  if (typeof isDashboardPage === 'function' && isDashboardPage()) {
    const rp = document.getElementById('right-panel');
    if (rp) {
      rp.classList.add('app-drawer-bound');
      return rp;
    }
  }

  let drawer = document.getElementById('app-drawer');
  if (!drawer) {
    drawer = document.createElement('aside');
    drawer.className = 'app-drawer right-panel';
    drawer.id = 'app-drawer';
    drawer.innerHTML = getDrawerMarkup();
    layout.appendChild(drawer);
  }
  return drawer;
}

async function loadAppDrawerData() {
  const user = API.user();
  if (!user) return;

  const { ok, data } = await API.get('/api/users/me', true);
  if (ok && data) {
    const av = document.getElementById('ad-avatar');
    const name = document.getElementById('ad-name');
    const email = document.getElementById('ad-email');
    if (data.avatar_url && av) {
      av.innerHTML = `<img src="${escapeHtml(data.avatar_url)}" alt=""/>`;
    } else if (av) {
      av.textContent = initials(data.name || user.name);
    }
    if (name) name.textContent = data.name || user.name;
    if (email) email.textContent = data.email || '';
  }

  const { ok: fOk, data: friends } = await API.get('/api/friends', true);
  if (fOk) {
    const count = (friends || []).filter(b => b.status === 'accepted').length;
    const el = document.getElementById('ad-buddy-count');
    if (el) el.textContent = count;
  }

  const { ok: aOk, data: act } = await API.get('/api/activity', true);
  if (aOk && act?.chart) {
    const chart = document.getElementById('ad-activity-chart');
    const labels = document.getElementById('ad-activity-months');
    const total = document.getElementById('ad-total-hours');
    if (total) total.textContent = (act.totalHours || 0) + 'h';
    if (chart && labels) {
      chart.innerHTML = '';
      labels.innerHTML = '';
      const maxMin = Math.max(...act.chart.map(d => d.minutes), 1);
      act.chart.forEach(d => {
        const h = Math.max(4, (d.minutes / maxMin) * 100);
        const hours = (d.minutes / 60).toFixed(1);
        chart.innerHTML += `<div class="activity-bar" style="height:${h}%" data-tip="${hours}h"></div>`;
        labels.innerHTML += `<span>${d.month}</span>`;
      });
    }
  }

  const { ok: tOk, data: todos } = await API.get('/api/todos', true);
  const list = document.getElementById('ad-todo-list');
  if (list && tOk) {
    const items = (todos || []).slice(0, 5);
    if (!items.length) {
      list.innerHTML = '<div style="padding:4px 0">No tasks yet</div>';
    } else {
      list.innerHTML = items.map(t =>
        `<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:flex-start">
          <span style="color:var(--accent)">○</span>
          <span style="flex:1;color:var(--text)">${escapeHtml(t.title)}</span>
        </div>`
      ).join('');
    }
  }
}

function openBuddiesFromDrawer(e) {
  e?.stopPropagation();
  if (typeof isDashboardPage === 'function' && isDashboardPage() && typeof openBuddiesFromProfile === 'function') {
    openBuddiesFromProfile(e);
    return;
  }
  if (typeof renderBuddiesDropdown === 'function') {
    loadBuddiesForNav().then(() => {
      const dd = document.getElementById('buddies-dropdown');
      if (dd) {
        renderBuddiesDropdown();
        dd.classList.add('open');
      }
    });
  }
}

function initAppDrawer() {
  const layout = getAppLayout();
  if (!layout) return;

  layout.classList.add('has-app-drawer');
  ensureInjectedDrawer();
  ensureDrawerFab();
  applyAppDrawerState();

  const isDash = typeof isDashboardPage === 'function' && isDashboardPage();
  if (!isDash) {
    loadAppDrawerData();
  }

  if (window.lucide) lucide.createIcons();
}

window.toggleAppDrawer = toggleAppDrawer;
window.setDrawerOpen = setDrawerOpen;
window.openBuddiesFromDrawer = openBuddiesFromDrawer;
window.initAppDrawer = initAppDrawer;
