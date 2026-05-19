const API = {
  token: () => localStorage.getItem('sr_token'),
  user: () => JSON.parse(localStorage.getItem('sr_user') || 'null'),

  async post(url, body, auth = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = 'Bearer ' + this.token();
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: await res.json() };
  },

  async get(url, auth = false) {
    const headers = {};
    if (auth) headers['Authorization'] = 'Bearer ' + this.token();
    const res = await fetch(url, { headers, cache: 'no-store' });
    return { ok: res.ok, status: res.status, data: await res.json() };
  },

  async patch(url, body, auth = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = 'Bearer ' + this.token();
    const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: await res.json() };
  },

  async delete(url, auth = false) {
    const headers = {};
    if (auth) headers['Authorization'] = 'Bearer ' + this.token();
    const res = await fetch(url, { method: 'DELETE', headers });
    return { ok: res.ok, status: res.status, data: await res.json() };
  }
};

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  
  let lottieUrl = 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f514/lottie.json'; // Bell
  let cleanMsg = msg;
  
  if (msg.includes('✅')) {
    lottieUrl = 'https://fonts.gstatic.com/s/e/notoemoji/latest/2705/lottie.json'; // Checkmark
    cleanMsg = msg.replace('✅', '').trim();
  } else if (msg.includes('❌')) {
    lottieUrl = 'https://fonts.gstatic.com/s/e/notoemoji/latest/274c/lottie.json'; // Cross
    cleanMsg = msg.replace('❌', '').trim();
  }

  t.innerHTML = `<lottie-player src="${lottieUrl}" background="transparent" speed="1" style="width: 18px; height: 18px;" loop autoplay></lottie-player><span>${escapeHtml(cleanMsg)}</span>`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── THEME ──────────────────────────────────────────────────────
(function() {
  const storedTheme = localStorage.getItem('sr_theme') || 'light';
  document.documentElement.setAttribute('data-theme', storedTheme);
})();

document.addEventListener('DOMContentLoaded', () => {
  const storedTheme = localStorage.getItem('sr_theme') || 'light';
  const iconId = document.getElementById('theme-icon');
  if (iconId) {
    iconId.setAttribute('data-lucide', storedTheme === 'dark' ? 'sun' : 'moon');
  }
});

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('sr_theme', newTheme);
  const iconId = document.getElementById('theme-icon');
  if (iconId && window.lucide) {
    iconId.setAttribute('data-lucide', newTheme === 'dark' ? 'sun' : 'moon');
    lucide.createIcons();
  }
}

// ── HOME NAVIGATION (Issue 5) ─────────────────────────────────────
// Called by clicking the StudyRoom logo on any page.
// Logged-in users → /dashboard   |   Guests/visitors → /
function goHome() {
  window.location.href = API.user() ? '/dashboard' : '/';
}

// ── INTERACTIVE CURSOR ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!window.matchMedia("(pointer: fine)").matches) return;

  const dot = document.createElement('div');
  dot.className = 'custom-cursor-dot';
  const ring = document.createElement('div');
  ring.className = 'custom-cursor-ring';
  
  document.body.appendChild(ring);
  document.body.appendChild(dot);
  
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX;
  let ringY = mouseY;
  let isDown = false;
  
  const style = document.createElement('style');
  style.innerHTML = `*:not(input):not(textarea) { cursor: none !important; }`;
  document.head.appendChild(style);

  document.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.transform = `translate(calc(${mouseX}px - 50%), calc(${mouseY}px - 50%))`;
  });
  
  const loop = () => {
    ringX += (mouseX - ringX) * 0.25;
    ringY += (mouseY - ringY) * 0.25;
    const scale = isDown ? ' scale(0.85)' : ' scale(1)';
    ring.style.transform = `translate(calc(${ringX}px - 50%), calc(${ringY}px - 50%))` + scale;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  
  document.addEventListener('mouseover', e => {
    const t = e.target;
    const isClickable = t.tagName === 'A' || t.tagName === 'BUTTON' || t.closest('a') || t.closest('button') || t.onclick || window.getComputedStyle(t).cursor === 'pointer';
    if (isClickable) {
      document.body.classList.add('cursor-hover');
    } else {
      document.body.classList.remove('cursor-hover');
    }
  });
  
  document.addEventListener('mousedown', () => isDown = true);
  document.addEventListener('mouseup', () => isDown = false);
});
