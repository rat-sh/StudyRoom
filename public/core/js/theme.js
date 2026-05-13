/* ── STUDYROOM THEME PICKER ───────────────────────────────────────────────
   Manages theme persistence and the floating theme picker panel.
   Apply theme before DOM paint: inline script in <head> reads sr_theme.
──────────────────────────────────────────────────────────────────────────── */

const THEMES = [
  { id: 'light',  label: 'Light',  accent: '#E60023', bg: '#FFFFFF' },
  { id: 'dark',   label: 'Dark',   accent: '#E60023', bg: '#18181C' },
  { id: 'green',  label: 'Green',  accent: '#2D7A2D', bg: '#FFFFFF' },
  { id: 'pink',   label: 'Pink',   accent: '#C2185B', bg: '#FFFFFF' },
  { id: 'blue',   label: 'Blue',   accent: '#0057B8', bg: '#FFFFFF' },
  { id: 'grey',   label: 'Grey',   accent: '#424242', bg: '#FFFFFF' },
  { id: 'ash',    label: 'Ash',    accent: '#8B6914', bg: '#FAF8F5' },
  { id: 'purple', label: 'Purple', accent: '#6200EA', bg: '#FFFFFF' },
  { id: 'sunset', label: 'Sunset', accent: '#E65100', bg: '#FFFFFF' },
];

let themePickerOpen = false;

/** Apply theme immediately to <html> and save to localStorage */
function applyTheme(themeId) {
  document.documentElement.setAttribute('data-theme', themeId);
  localStorage.setItem('sr_theme', themeId);
  // Update all swatch checkmarks
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === themeId);
  });
}

/** Get current theme from localStorage */
function getCurrentTheme() {
  return localStorage.getItem('sr_theme') || 'light';
}

/** Build and inject the theme picker panel into the DOM */
function createThemePickerPanel() {
  if (document.getElementById('theme-picker-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'theme-picker-panel';
  panel.className = 'theme-picker-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Choose your theme');

  const current = getCurrentTheme();
  panel.innerHTML = `
    <div class="theme-picker-title">Choose your vibe</div>
    <div class="theme-swatches">
      ${THEMES.map(t => `
        <button
          class="theme-swatch${t.id === current ? ' active' : ''}"
          data-theme="${t.id}"
          aria-label="Theme: ${t.label}"
          onclick="applyTheme('${t.id}');updateThemePickerUI()"
          title="${t.label}"
        >
          <span class="swatch-circle" style="
            background: linear-gradient(135deg, ${t.accent} 50%, ${t.bg} 50%);
          "></span>
          <span class="swatch-label">${t.label}</span>
        </button>
      `).join('')}
    </div>
  `;
  document.body.appendChild(panel);

  // Close on outside click
  document.addEventListener('click', (e) => {
    const btn = document.getElementById('theme-picker-btn');
    if (themePickerOpen && !panel.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
      closeThemePicker();
    }
  });
}

/** Open/close theme picker, position it relative to trigger button */
function toggleThemePicker() {
  if (!themePickerOpen) {
    openThemePicker();
  } else {
    closeThemePicker();
  }
}

function openThemePicker() {
  if (!document.getElementById('theme-picker-panel')) {
    createThemePickerPanel();
  }
  const panel = document.getElementById('theme-picker-panel');
  const btn = document.getElementById('theme-picker-btn');

  if (btn) {
    const rect = btn.getBoundingClientRect();
    panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    panel.style.left = rect.left + 'px';
  } else {
    panel.style.bottom = '80px';
    panel.style.right = '20px';
    panel.style.left = 'auto';
  }

  panel.classList.add('open');
  themePickerOpen = true;
  updateThemePickerUI();
}

function closeThemePicker() {
  const panel = document.getElementById('theme-picker-panel');
  if (panel) panel.classList.remove('open');
  themePickerOpen = false;
}

/** Update swatch checkmarks to reflect current theme */
function updateThemePickerUI() {
  const current = getCurrentTheme();
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === current);
  });
}

// Apply theme on script load (before DOMContentLoaded completes)
(function() {
  const t = localStorage.getItem('sr_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
