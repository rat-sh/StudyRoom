window.addEventListener('DOMContentLoaded', () => {
  const pathCode = window.location.pathname.split('/join/')[1];
  if (pathCode) {
    document.getElementById('code').value = pathCode.toUpperCase();
    document.getElementById('pin').focus();
  }
  // If logged-in user visits /join, pre-fill name
  const user = API.user();
  if (user) document.getElementById('guestName').value = user.name;
});

async function doJoin() {
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  const guestName = document.getElementById('guestName').value.trim();
  const code = document.getElementById('code').value.trim().toUpperCase();
  const pin = document.getElementById('pin').value.trim();

  err.classList.remove('show');
  if (!guestName) { err.textContent = 'Please enter your name'; err.classList.add('show'); return; }
  if (code.length < 4) { err.textContent = 'Enter a valid room code'; err.classList.add('show'); return; }
  if (pin.length !== 4) { err.textContent = 'PIN must be exactly 4 digits'; err.classList.add('show'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const { ok, data } = await API.post('/api/rooms/validate', { code, pin });
  if (!ok) {
    err.textContent = data.error || 'Room not found or wrong PIN';
    err.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Join Room →';
    return;
  }

  // Store guest session if not logged in
  if (!API.user()) {
    sessionStorage.setItem('sr_guest', JSON.stringify({ name: guestName, guest: true }));
  }
  window.location.href = '/room/' + code;
}

document.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
