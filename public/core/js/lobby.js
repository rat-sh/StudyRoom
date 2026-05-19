let allRooms = [];
let selectedCode = null;
let hiddenRooms = JSON.parse(localStorage.getItem('sr_hidden_rooms') || '[]');

function deleteFromMyEnd(code) {
  if (!hiddenRooms.includes(code)) {
    hiddenRooms.push(code);
    localStorage.setItem('sr_hidden_rooms', JSON.stringify(hiddenRooms));
  }
  filterRooms();
}

// ── GUEST IDENTITY (Issue 4) ──────────────────────────────────────
// Adjectives + animals produce names like "CuriousTiger42"
const GUEST_ADJS  = ['Curious','Swift','Silent','Brave','Mighty','Bright','Calm','Bold','Sharp','Keen','Witty','Gentle','Lucky','Vivid','Zesty'];
const GUEST_NOUNS = ['Tiger','Panda','Fox','Owl','Wolf','Hawk','Bear','Lion','Eagle','Koala','Lynx','Deer','Raven','Orca','Gecko'];
// Palette of avatar background colors (matches the app's vibe)
const AVATAR_COLORS = ['#00B894','#4ECDC4','#5865F2','#FFA502','#FF6B6B','#A29BFE','#FD79A8','#00CEC9','#6C5CE7','#FDCB6E'];

function generateGuestName() {
  const adj  = GUEST_ADJS [Math.floor(Math.random() * GUEST_ADJS.length)];
  const noun = GUEST_NOUNS[Math.floor(Math.random() * GUEST_NOUNS.length)];
  const num  = Math.floor(Math.random() * 90 + 10); // 10-99
  return `${adj}${noun}${num}`;
}

function getAvatarColor(name) {
  // Deterministic color from name so it stays consistent across renders
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initGuestIdentity() {
  const loggedUser = window.API?.user();

  if (loggedUser) {
    // ── LOGGED-IN STATE ──────────────────────────────────────────
    document.getElementById('logged-identity').style.display = 'flex';
    document.getElementById('auth-links').style.display      = 'none';
    document.getElementById('guest-identity').style.display  = 'none';

    const initStr = initials(loggedUser.name);
    const color   = getAvatarColor(loggedUser.name);
    const avEl    = document.getElementById('logged-nav-avatar');
    avEl.textContent        = initStr;
    avEl.style.background   = color;
    document.getElementById('logged-nav-name').textContent = loggedUser.name;

  } else {
    // ── GUEST STATE ──────────────────────────────────────────────
    // Persist the name for this browser session so it survives refreshes
    let guestName = sessionStorage.getItem('sr_guest_display_name');
    if (!guestName) {
      guestName = generateGuestName();
      sessionStorage.setItem('sr_guest_display_name', guestName);
    }

    document.getElementById('guest-identity').style.display  = 'flex';
    document.getElementById('auth-links').style.display      = 'flex';
    document.getElementById('logged-identity').style.display = 'none';

    const color = getAvatarColor(guestName);
    const avEl  = document.getElementById('guest-nav-avatar');
    avEl.textContent        = initials(guestName);
    avEl.style.background   = color;
    document.getElementById('guest-nav-name').textContent = guestName;

    // Pre-fill the join modal's name input so guests don't have to type
    const nameInput = document.getElementById('guest-name-input');
    if (nameInput && !nameInput.value) nameInput.value = guestName;
  }
}

// ── HOME NAVIGATION (Issue 5) ─────────────────────────────────────
function goHome() {
  window.location.href = window.API?.user() ? '/dashboard' : '/';
}

window.addEventListener('DOMContentLoaded', () => {
  initGuestIdentity();
  loadRooms();
});

async function loadRooms() {
  const topic = document.getElementById('topic-filter').value;
  const url = topic === 'All' ? '/api/lobby/rooms' : `/api/lobby/rooms?topic=${encodeURIComponent(topic)}`;
  const { ok, data } = await API.get(url);
  if (!ok) { showToast('Failed to load rooms'); return; }
  allRooms = data;
  document.getElementById('live-count').textContent = `${data.length} room${data.length !== 1 ? 's' : ''} live`;
  renderRooms(data);
}

function filterRooms() {
  const q = document.getElementById('search').value.toLowerCase();
  renderRooms(allRooms.filter(r => r.name.toLowerCase().includes(q) || (r.topic || '').toLowerCase().includes(q)));
}

function renderRooms(rooms) {
  const grid = document.getElementById('rooms-grid');
  const visibleRooms = rooms.filter(r => !hiddenRooms.includes(r.code));
  
  if (!visibleRooms.length) {
    grid.innerHTML = '<div class="lobby-empty"><div class="empty-icon"><i data-lucide="book-x" style="width:32px;height:32px"></i></div><p>No public rooms right now.<br>Be the first to create one!</p></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  grid.innerHTML = visibleRooms.map(r => {
    const count = r.member_count || 0;
    const max = r.max_members || 10;
    const full = count >= max;
    const pct = Math.min((count / max) * 100, 100);
    return `<div class="lobby-card">
      <div class="lobby-card-top">
        <div class="lobby-card-name">${escapeHtml(r.name)}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="topic-badge">${escapeHtml(r.topic || 'General')}</div>
          <button class="lobby-hide-btn" onclick="event.stopPropagation(); deleteFromMyEnd('${r.code}')" title="Delete from my view">
            <i data-lucide="trash-2" style="width:14px;height:14px;color:var(--danger)"></i>
          </button>
        </div>
      </div>
      <div class="members-bar"><div class="members-bar-fill ${full ? 'full' : ''}" style="width:${pct}%"></div></div>
      <div class="lobby-card-meta">
        <div class="members-count"><i data-lucide="users" style="width:14px;height:14px"></i> ${count}/${max}</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--hint)">${r.code}</div>
      </div>
      <button class="lobby-join-btn" ${full ? 'disabled' : ''} onclick="openNameModal('${r.code}')">
        ${full ? 'Room Full' : 'Join →'}
      </button>
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function openNameModal(code) {
  selectedCode = code;
  document.getElementById('name-modal').classList.add('open');
  setTimeout(() => document.getElementById('guest-name-input').focus(), 150);
}

function closeNameModal() {
  document.getElementById('name-modal').classList.remove('open');
  document.getElementById('guest-name-input').value = '';
}

function joinAnonymous() {
  const adjs = ['Clever', 'Swift', 'Silent', 'Brave', 'Mighty', 'Bright', 'Calm', 'Fast', 'Smart', 'Happy'];
  const nouns = ['Panda', 'Fox', 'Owl', 'Tiger', 'Bear', 'Wolf', 'Hawk', 'Lion', 'Eagle', 'Koala'];
  const name = adjs[Math.floor(Math.random()*adjs.length)] + ' ' + nouns[Math.floor(Math.random()*nouns.length)];
  document.getElementById('guest-name-input').value = name;
  confirmJoin();
}

async function confirmJoin() {
  const name = document.getElementById('guest-name-input').value.trim();
  const err = document.getElementById('modal-err');
  err.classList.add('hidden');
  if (!name) { err.textContent = 'Please enter your name.'; err.classList.remove('hidden'); return; }
  if (!selectedCode) return;
  const { ok, data } = await API.post('/api/rooms/join-public', { code: selectedCode });
  if (!ok) { err.textContent = data.error || 'Could not join'; err.classList.remove('hidden'); return; }
  sessionStorage.setItem('sr_guest', JSON.stringify({ name, guest: true }));
  window.location.href = '/room/' + selectedCode;
}

document.getElementById('guest-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmJoin(); });
document.getElementById('name-modal').addEventListener('click', e => { if (e.target === document.getElementById('name-modal')) closeNameModal(); });
setInterval(loadRooms, 15000);
