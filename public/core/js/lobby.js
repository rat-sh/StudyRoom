let allRooms = [];
let selectedCode = null;

window.addEventListener('DOMContentLoaded', loadRooms);

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
  if (!rooms.length) {
    grid.innerHTML = '<div class="lobby-empty"><div class="empty-icon"><i data-lucide="book-x" style="width:32px;height:32px"></i></div><p>No public rooms right now.<br>Be the first to create one!</p></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  grid.innerHTML = rooms.map(r => {
    const count = r.member_count || 0;
    const max = r.max_members || 10;
    const full = count >= max;
    const pct = Math.min((count / max) * 100, 100);
    return `<div class="lobby-card">
      <div class="lobby-card-top">
        <div class="lobby-card-name">${escapeHtml(r.name)}</div>
        <div class="topic-badge">${escapeHtml(r.topic || 'General')}</div>
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
