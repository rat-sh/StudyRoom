/** Shared dashboard sidebar — same nav on dashboard, chat, lobby, chess, etc. */
let sbCollapsed = false;

const SIDEBAR_PAGES = {
  home: { panel: 'home', href: '/dashboard?panel=home' },
  rooms: { panel: 'rooms', href: '/dashboard?panel=rooms' },
  games: { panel: 'games', href: '/dashboard?panel=games' },
  friends: { panel: 'friends', href: '/dashboard?panel=friends' },
  chat: { href: '/chat' },
  lobby: { href: '/lobby' },
  media: { panel: 'media', href: '/dashboard?panel=media' },
  settings: { panel: 'settings', href: '/dashboard?panel=settings' },
};

function isDashboardPage() {
  const p = location.pathname;
  return p === '/dashboard' || p.endsWith('/dashboard.html');
}

function navDashboard(panel, el) {
  if (isDashboardPage() && typeof setPanel === 'function') {
    setPanel(panel, el);
  } else {
    window.location.href = '/dashboard?panel=' + panel;
  }
}

function navExternal(href) {
  if (location.pathname === href || location.pathname + location.search === href) return;
  window.location.href = href;
}

function getAppLayout() {
  return document.getElementById('dash-layout') || document.getElementById('app-shell');
}

function toggleSidebarCollapse() {
  sbCollapsed = !sbCollapsed;
  applySidebarLayout();
}

function applySidebarLayout() {
  const layout = getAppLayout();
  if (!layout) return;
  const narrow = window.innerWidth <= 960;
  layout.classList.toggle('sb-collapsed', narrow || sbCollapsed);
  const icon = document.getElementById('sidebar-toggle-icon');
  if (icon) {
    icon.setAttribute('data-lucide', (narrow || sbCollapsed) ? 'chevrons-right' : 'chevrons-left');
    if (window.lucide) lucide.createIcons();
  }
}

function initSidebarUserMenu() {
  const btn = document.getElementById('sidebar-user-btn');
  const pop = document.getElementById('sidebar-signout-pop');
  if (!btn || !pop) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.toggle('open');
  });
  document.addEventListener('click', () => pop.classList.remove('open'));
  pop.addEventListener('click', e => e.stopPropagation());
}

function populateSidebarUser() {
  const user = API.user();
  const shortEl = document.getElementById('sb-name-short');
  const tipEl = document.getElementById('sidebar-user-tooltip');
  const avEl = document.getElementById('sb-avatar');
  const pop = document.getElementById('sidebar-signout-pop');
  if (!shortEl || !tipEl || !avEl) return;

  if (user) {
    const shortName = (user.name || 'User').split(' ')[0];
    shortEl.textContent = shortName;
    tipEl.textContent = user.name;
    avEl.textContent = initials(user.name);
    if (pop) {
      pop.innerHTML = '<button type="button" onclick="logout()">Sign out</button>';
    }
    return;
  }

  const guestName = sessionStorage.getItem('sr_guest_display_name') || 'Guest';
  shortEl.textContent = guestName.split(' ')[0] || guestName;
  tipEl.textContent = guestName;
  avEl.textContent = initials(guestName);
  if (pop) {
    pop.innerHTML = '<button type="button" onclick="window.location.href=\'/\'">Log in</button>';
  }
}

function navItem(active, key, opts) {
  const isActive = active === key;
  const cls = 'nav-item' + (isActive ? ' active' : '');
  const id = 'nav-' + key;
  if (opts.href) {
    return `<div class="${cls}" id="${id}" onclick="navExternal('${opts.href}')" title="${opts.title}">
      <div class="nav-icon-wrap">${opts.icon}</div><span class="nav-label">${opts.label}</span>
    </div>`;
  }
  const panel = opts.panel || key;
  return `<div class="${cls}" id="${id}" onclick="navDashboard('${panel}', this)" title="${opts.title}">
    <div class="nav-icon-wrap">${opts.icon}</div><span class="nav-label">${opts.label}</span>
  </div>`;
}

function initAppSidebar(active) {
  const el = document.getElementById('app-sidebar');
  if (!el) return;

  el.className = 'sidebar';
  el.id = 'app-sidebar';
  el.innerHTML = `
    <div class="sidebar-logo" onclick="goHome()" title="Go to dashboard" style="cursor:pointer">
      <div class="sidebar-logo-icon"><i data-lucide="book-open" style="width:18px;height:18px"></i></div>
      <span class="sidebar-logo-text">StudyRoom</span>
    </div>
    <button class="sidebar-collapse-btn" id="sidebar-toggle" onclick="toggleSidebarCollapse()" title="Collapse sidebar" type="button">
      <i data-lucide="chevrons-left" id="sidebar-toggle-icon" style="width:16px;height:16px"></i>
    </button>

    <div class="nav-section-label sidebar-section-label">Main</div>
    ${navItem(active, 'home', { title: 'Home', label: 'Home', icon: '<i data-lucide="home"></i>', panel: 'home' })}
    ${navItem(active, 'rooms', { title: 'My Rooms', label: 'My Rooms', icon: '<i data-lucide="door-open"></i>', panel: 'rooms' })}
    ${navItem(active, 'games', { title: 'Games', label: 'Games', icon: '<i data-lucide="gamepad-2"></i>', panel: 'games' })}
    ${navItem(active, 'friends', { title: 'Buddies', label: 'Buddies', icon: '<i data-lucide="users"></i>', panel: 'friends' })}
    <div class="nav-item${active === 'chat' ? ' active' : ''}" id="nav-chat" onclick="navExternal('/chat')" title="Messages">
      <div class="nav-icon-wrap" style="position:relative">
        <i data-lucide="message-square"></i>
        <span id="chat-unread-badge" style="display:none;position:absolute;top:-4px;right:-4px;background:var(--accent);color:#fff;border-radius:8px;font-size:9px;font-weight:700;padding:1px 4px;min-width:14px;text-align:center"></span>
      </div>
      <span class="nav-label">Messages</span>
    </div>
    ${navItem(active, 'lobby', { title: 'Public Lobby', label: 'Public Lobby', href: '/lobby', icon: '<i data-lucide="globe"></i>' })}
    ${navItem(active, 'media', { title: 'Media Hub', label: 'Media Hub', icon: '<i data-lucide="folder-open"></i>', panel: 'media' })}

    <hr class="sidebar-sep"/>
    <div class="nav-section-label sidebar-section-label">Account</div>
    <div class="nav-item" id="nav-theme" onclick="toggleTheme()" title="Toggle Theme">
      <div class="nav-icon-wrap"><i data-lucide="moon" id="theme-icon"></i></div><span class="nav-label">Toggle Theme</span>
    </div>
    ${navItem(active, 'settings', { title: 'Settings', label: 'Settings', icon: '<i data-lucide="settings"></i>', panel: 'settings' })}

    <div class="sidebar-user-wrap" id="sidebar-user-wrap">
      <div class="sidebar-user-btn" id="sidebar-user-btn" type="button">
        <div class="user-av" id="sb-avatar">?</div>
        <span class="sidebar-user-short" id="sb-name-short">...</span>
        <span class="sidebar-user-dot" title="Online"></span>
      </div>
      <div class="sidebar-user-tooltip" id="sidebar-user-tooltip">...</div>
      <div class="sidebar-signout-pop" id="sidebar-signout-pop">
        <button type="button" onclick="logout()">Sign out</button>
      </div>
      <div id="sb-music-presence" class="sidebar-music-presence" style="display:none">
        <img id="sb-music-art" src="" alt="" />
        <marquee id="sb-music-text" scrollamount="2">Listening...</marquee>
      </div>
    </div>
  `;

  populateSidebarUser();
  initSidebarUserMenu();
  applySidebarLayout();
  if (!window._appSidebarResizeBound) {
    window._appSidebarResizeBound = true;
    window.addEventListener('resize', applySidebarLayout);
  }
  if (window.lucide) lucide.createIcons();

  const storedTheme = localStorage.getItem('sr_theme') || 'light';
  const themeIcon = document.getElementById('theme-icon');
  if (themeIcon) themeIcon.setAttribute('data-lucide', storedTheme === 'dark' ? 'sun' : 'moon');
  if (window.lucide) lucide.createIcons();
}

/** @deprecated use initAppSidebar */
function initAppNav(active) {
  const map = { chess: 'games' };
  initAppSidebar(map[active] || active);
}

function applyDashboardPanelFromUrl() {
  if (!isDashboardPage()) return;
  const panel = new URLSearchParams(location.search).get('panel');
  if (!panel) return;
  const navEl = document.getElementById('nav-' + panel);
  if (navEl && typeof setPanel === 'function') setPanel(panel, navEl);
}
