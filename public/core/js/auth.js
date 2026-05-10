// If already logged in, go to dashboard
if (localStorage.getItem('sr_token')) window.location.href = '/dashboard';

async function doLogin() {
  const btn = document.getElementById('btn');
  const errDiv = document.getElementById('err');
  const errText = document.getElementById('err-text');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  errDiv.classList.add('hidden');
  if (!email || !password) {
    errText.textContent = 'Please fill in all fields.';
    errDiv.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  const { ok, data } = await API.post('/api/auth/login', { email, password });
  if (!ok) {
    errText.textContent = data.error || 'Login failed. Check your credentials.';
    errDiv.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }
  localStorage.setItem('sr_token', data.token);
  localStorage.setItem('sr_user', JSON.stringify(data.user));
  window.location.href = '/dashboard';
}

async function doSignup() {
  const btn = document.getElementById('btn');
  const errDiv = document.getElementById('err');
  const errText = document.getElementById('err-text');
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  errDiv.classList.add('hidden');
  if (!name || !email || !password) {
    errText.textContent = 'Please fill in all fields.';
    errDiv.classList.remove('hidden');
    return;
  }
  if (password.length < 6) {
    errText.textContent = 'Password must be at least 6 characters.';
    errDiv.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account…';
  const { ok, data } = await API.post('/api/auth/signup', { name, email, password });
  if (!ok) {
    errText.textContent = data.error || 'Signup failed. Try again.';
    errDiv.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Create Account';
    return;
  }
  // SUCCESS — go to login so they authenticate
  showToast('Account created! Please sign in.');
  setTimeout(() => { window.location.href = '/'; }, 1500);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('name')) doSignup();
  else doLogin();
});
