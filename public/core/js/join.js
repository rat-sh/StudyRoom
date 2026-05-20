// ── Public room identity picker + join logic ─────────────────────────────
let _roomIsPublic = false;
let _joinMode     = null; // 'account' | 'guest'

async function checkRoomVisibility(code) {
  if (!code || code.length < 4) return;
  const { ok, data } = await API.get(`/api/rooms/info/${code}`);
  if (!ok) return;
  _roomIsPublic = !!data.is_public;
  const pinField = document.getElementById('pin-field');
  const sub = document.querySelector('.sub');

  if (_roomIsPublic) {
    if (pinField) pinField.style.display = 'none';
    if (sub) sub.textContent = 'Public room — no PIN required.';

    // If already logged in → show identity picker instead of name field
    const loggedUser = window.API?.user();
    if (loggedUser) {
      _showIdentityPicker(loggedUser);
    }
  } else {
    if (pinField) pinField.style.display = '';
    if (sub) sub.textContent = 'Enter the room code and PIN to join.';
  }
}

function _showIdentityPicker(loggedUser) {
  const picker = document.getElementById('identity-picker');
  if (!picker) return;

  // Populate account option with real user data
  const accName = document.getElementById('ip-account-name');
  const accEmail = document.getElementById('ip-account-email');
  const accAvatar = document.getElementById('ip-account-avatar');
  if (accName) accName.textContent = loggedUser.name;
  if (accEmail) accEmail.textContent = loggedUser.email;
  if (accAvatar) accAvatar.textContent = (loggedUser.name[0] || '?').toUpperCase();

  // Generate temp guest name
  const guestName = 'Guest_' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const guestNameEl = document.getElementById('ip-guest-name');
  if (guestNameEl) guestNameEl.textContent = guestName;

  // Hide main join form, show picker
  const mainForm = document.getElementById('join-main-form');
  if (mainForm) mainForm.style.display = 'none';
  picker.style.display = 'flex';
}

function selectIdentity(mode) {
  _joinMode = mode;
  const loggedUser = window.API?.user();

  if (mode === 'account' && loggedUser) {
    // Use real account — pre-fill name, skip name input
    const nameEl = document.getElementById('guestName');
    if (nameEl) nameEl.value = loggedUser.name;
    // Store account identity (NOT as guest)
    sessionStorage.removeItem('sr_guest');
  } else {
    // Anonymous mode — generate temp identity
    const guestName = document.getElementById('ip-guest-name')?.textContent
      || 'Guest_' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const nameEl = document.getElementById('guestName');
    if (nameEl) nameEl.value = guestName;
    sessionStorage.setItem('sr_guest', JSON.stringify({ name: guestName, guest: true }));
  }

  // Hide picker, show form with name pre-filled
  document.getElementById('identity-picker').style.display = 'none';
  const mainForm = document.getElementById('join-main-form');
  if (mainForm) mainForm.style.display = '';

  // Trigger join immediately for account mode on public rooms
  if (_roomIsPublic) doJoin();
}

async function doJoin() {
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  const errText = document.getElementById('err-text');
  const guestName = document.getElementById('guestName').value.trim();
  const code = document.getElementById('code').value.trim().toUpperCase();
  const pin = document.getElementById('pin').value.trim();

  err.classList.add('hidden');

  if (!guestName) { errText.textContent = 'Please enter your name.'; err.classList.remove('hidden'); return; }
  if (code.length < 4) { errText.textContent = 'Enter a valid room code.'; err.classList.remove('hidden'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    if (_roomIsPublic) {
      const { ok, data } = await API.post('/api/rooms/join-public', { code });
      if (!ok) { errText.textContent = data.error || 'Could not join room'; err.classList.remove('hidden'); return; }
    } else {
      if (pin.length !== 4) { errText.textContent = 'PIN must be 4 digits.'; err.classList.remove('hidden'); return; }
      const { ok, data } = await API.post('/api/rooms/validate', { code, pin });
      if (!ok) { errText.textContent = data.error || 'Could not join room'; err.classList.remove('hidden'); return; }
    }

    // Only store guest session if in anonymous mode (account mode uses real auth)
    if (_joinMode !== 'account') {
      const stored = sessionStorage.getItem('sr_guest');
      if (!stored) sessionStorage.setItem('sr_guest', JSON.stringify({ name: guestName, guest: true }));
    }

    window.location.href = '/room/' + code;
  } catch (e) {
    errText.textContent = 'Something went wrong. Please try again.';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join Room →';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const pathCode = window.location.pathname.split('/join/')[1];
  if (pathCode) {
    const codeEl = document.getElementById('code');
    codeEl.value = pathCode.toUpperCase();
    checkRoomVisibility(pathCode.toUpperCase());
    document.getElementById('guestName')?.focus();
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

