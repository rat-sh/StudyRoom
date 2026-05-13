/* ── STUDYROOM CLIENT API ─────────────────────────────────────────────────
   Handles API requests (credentials: include for httpOnly cookies).
   sr_user in localStorage = non-sensitive display info only.
──────────────────────────────────────────────────────────────────────────── */

const API = {
  /** Get cached user info from localStorage (non-sensitive display data) */
  user: () => JSON.parse(localStorage.getItem('sr_user') || 'null'),

  /** POST with credentials (cookie auto-sent by browser) */
  async post(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      return { ok: res.ok, status: res.status, data: await res.json() };
    } catch (e) {
      return { ok: false, status: 0, data: { error: e.message } };
    }
  },

  /** GET with credentials */
  async get(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      return { ok: res.ok, status: res.status, data: await res.json() };
    } catch (e) {
      return { ok: false, status: 0, data: { error: e.message } };
    }
  },

  /** DELETE with credentials */
  async del(url) {
    try {
      const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
      return { ok: res.ok, status: res.status, data: await res.json() };
    } catch (e) {
      return { ok: false, status: 0, data: { error: e.message } };
    }
  }
};

// ── TOAST ──────────────────────────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Clipboard copy with fallback for browsers that block navigator.clipboard */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast('Copied!');
}
