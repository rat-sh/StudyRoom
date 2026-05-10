let totalSeconds = 25 * 60;
let endsAt = null;
let running = false;
let interval = null;
let round = 1;
let currentLabel = 'Focus';
const CIRCUMFERENCE = 2 * Math.PI * 54;

function setMode(mins, label) {
  if (running) return;
  totalSeconds = mins * 60;
  currentLabel = label;
  document.getElementById('timer-label').textContent = label;
  document.getElementById('timer-display').textContent = fmt(totalSeconds);
  document.getElementById('ring-fill').style.strokeDashoffset = 0;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const map = { 'Focus': 'mode-focus', 'Short Break': 'mode-short', 'Long Break': 'mode-long' };
  if (map[label]) document.getElementById(map[label]).classList.add('active');
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function toggleTimer() {
  if (running) {
    window.parent.postMessage({ type: 'TIMER_STOP' }, '*');
  } else {
    window.parent.postMessage({ type: 'TIMER_START', data: { duration: totalSeconds } }, '*');
  }
}

function resetTimer() {
  window.parent.postMessage({ type: 'TIMER_STOP' }, '*');
  setTimeout(() => {
    endsAt = null;
    running = false;
    clearInterval(interval);
    document.getElementById('timer-display').textContent = fmt(totalSeconds);
    document.getElementById('ring-fill').style.strokeDashoffset = 0;
    updateBtn();
  }, 100);
}

function startLocal() {
  clearInterval(interval);
  interval = setInterval(() => {
    if (!endsAt) return;
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    document.getElementById('timer-display').textContent = fmt(remaining);
    const pct = remaining / totalSeconds;
    document.getElementById('ring-fill').style.strokeDashoffset = CIRCUMFERENCE * (1 - pct);
    if (remaining <= 0) { clearInterval(interval); }
  }, 500);
}

function updateBtn() {
  const btn = document.getElementById('start-btn');
  btn.innerHTML = running ? '<i data-lucide="pause" style="width:14px;height:14px;margin-right:4px;fill:currentColor"></i> Pause' : '<i data-lucide="play" style="width:14px;height:14px;margin-right:4px;fill:currentColor"></i> Start';
  btn.classList.toggle('running', running);
  if (window.parent && window.parent.lucide) window.parent.lucide.createIcons(); else if (window.lucide) lucide.createIcons();
}

window.addEventListener('message', e => {
  const { type, data } = e.data || {};
  if (type === 'TIMER_SYNC') {
    if (data.running) {
      endsAt = data.endsAt;
      running = true;
      startLocal();
    } else {
      running = false;
      clearInterval(interval);
    }
    updateBtn();
  }
  if (type === 'TIMER_DONE') {
    running = false;
    clearInterval(interval);
    round++;
    document.getElementById('round-num').textContent = round;
    document.getElementById('timer-display').textContent = '00:00';
    document.getElementById('ring-fill').style.strokeDashoffset = CIRCUMFERENCE;
    updateBtn();
    if (Notification.permission === 'granted') new Notification('StudyRoom Timer', { body: `${currentLabel} session done!` });
  }
});

window.parent.postMessage({ type: 'TIMER_REQUEST' }, '*');
if (Notification.permission === 'default') Notification.requestPermission();
