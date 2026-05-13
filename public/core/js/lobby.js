/* ── LOBBY JS — socket-based live updates, no polling ────────────────────── */

let allRooms = [];
let activeTopicFilter = '';
let pendingJoinCode = null;

const TYPEWRITER_WORDS = ['study squad', 'focus zone', 'music room', 'chess match'];
let twIdx = 0, twCharIdx = 0, twDeleting = false;

// ── INIT ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  startTypewriter();
  loadRooms();
  connectLobbySocket();
});

// ── SOCKET (live updates) ────────────────────────────────────────────────────
function connectLobbySocket() {
  try {
    const sock = io({ reconnection: true });
    sock.emit('join-lobby');
    sock.on('lobby-update', loadRooms);
  } catch (_) {}
}

// ── TYPEWRITER ───────────────────────────────────────────────────────────────
function startTypewriter() {
  const el = document.getElementById('hero-tw');
  if (!el) return;
  function tick() {
    const word = TYPEWRITER_WORDS[twIdx];
    el.textContent = twDeleting ? word.slice(0, twCharIdx--) : word.slice(0, twCharIdx++);
    if (!twDeleting && twCharIdx > word.length) { twDeleting = true; setTimeout(tick, 1400); return; }
    if (twDeleting && twCharIdx < 0) { twDeleting = false; twIdx = (twIdx + 1) % TYPEWRITER_WORDS.length; twCharIdx = 0; }
    setTimeout(tick, twDeleting ? 60 : 100);
  }
  tick();
}

// ── LOAD ROOMS ───────────────────────────────────────────────────────────────
async function loadRooms() {
  const { ok, data } = await API.get('/api/lobby');
  if (ok && Array.isArray(data)) {
    allRooms = data;
    renderRooms(allRooms);
  }
}

function filterRooms() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const filtered = allRooms.filter(r =>
    (!activeTopicFilter || r.topic === activeTopicFilter) &&
    (!q || r.name.toLowerCase().includes(q) || (r.topic || '').toLowerCase().includes(q))
  );
  renderRooms(filtered);
}

function filterByTopic(topic, btn) {
  activeTopicFilter = topic;
  document.querySelectorAll('.topic-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  filterRooms();
}

function renderRooms(rooms) {
  const grid = document.getElementById('lobby-grid');
  if (!rooms.length) {
    grid.innerHTML = `<div class="lobby-empty"><span class="empty-icon">🔍</span><h3>No rooms found</h3><p>Try a different filter or create your own!</p></div>`;
    return;
  }
  grid.innerHTML = rooms.map(r => {
    const pct = r.max_members ? Math.round((r.member_count / r.max_members) * 100) : 0;
    const featured = r.member_count >= 5;
    return `<div class="lobby-card${featured ? ' featured' : ''}" onclick="openJoin('${r.code}', '${escapeHtml(r.name)}', '${escapeHtml(r.topic || '')}')">
      <div class="card-badges">
        ${featured ? '<span class="featured-badge">🔥 Featured</span>' : ''}
        <span class="badge topic">${escapeHtml(r.topic || 'General')}</span>
      </div>
      <div class="card-room-name">${escapeHtml(r.name)}</div>
      <div class="card-topic">${r.member_count || 0} / ${r.max_members || 10} members</div>
      <div class="card-members">
        <div class="member-bar-bg"><div class="member-bar-fill" style="width:${pct}%"></div></div>
        <div class="member-text">${r.member_count || 0} studying now</div>
      </div>
      <button class="card-join-btn">Join Room →</button>
    </div>`;
  }).join('');
}

// ── JOIN ─────────────────────────────────────────────────────────────────────
function openJoin(code, name, topic) {
  pendingJoinCode = code;
  document.getElementById('join-room-desc').textContent = `"${name}" · ${topic}`;
  document.getElementById('join-err').classList.add('hidden');
  document.getElementById('modal-join').classList.add('open');
}

async function confirmJoin() {
  if (!pendingJoinCode) return;
  const btn = document.getElementById('join-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  const { ok, data } = await API.post('/api/rooms/join-public', { code: pendingJoinCode });
  if (!ok) {
    document.getElementById('join-err').textContent = data.error || 'Could not join room';
    document.getElementById('join-err').classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Join Now →';
    return;
  }
  window.location.href = '/room/' + pendingJoinCode;
}

function closeModal() {
  document.getElementById('modal-join').classList.remove('open');
  pendingJoinCode = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});
