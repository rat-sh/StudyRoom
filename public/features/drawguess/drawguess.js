/**
 * Draw & Guess — Client Logic (v2 — redesigned)
 */

const params    = new URLSearchParams(window.location.search);
const roomCode  = params.get('room') || 'unknown';
const myName    = decodeURIComponent(params.get('name') || 'Player');
const socket    = io();

/* ─── state ─────────────────────────────────────── */
let gameState   = null;
let isDrawing   = false;
let ctx, canvas;
let lastX = 0, lastY = 0;
let currentTool = 'pencil';
let undoStack   = [];
let redoStack   = [];
let round       = 1;
let timerMax    = 60;
let scoreMap    = {};   // id -> { name, score, guessed }
const COLORS    = ['#6366f1','#8b5cf6','#ec4899','#f97316','#22c55e','#06b6d4','#f59e0b','#64748b'];

/* ─── init ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  canvas = document.getElementById('dg-canvas');
  ctx    = canvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Drawing
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup',   onMouseUp);
  canvas.addEventListener('mouseout',  onMouseUp);
  // Touch
  canvas.addEventListener('touchstart', e => { e.preventDefault(); onMouseDown(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMouseMove(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchend',   onMouseUp);

  // Update header
  document.getElementById('hdr-room-code').textContent = roomCode.toUpperCase();
  document.getElementById('hdr-room-name').textContent = 'Room ' + roomCode.toUpperCase();

  socket.emit('dg-join', { roomCode, name: myName });
});

/* ─── canvas helpers ─────────────────────────────── */
function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  const w = wrapper.clientWidth  - 24;
  const h = wrapper.clientHeight - 24;
  // Save current drawing
  const img = canvas.toDataURL();
  canvas.width  = Math.max(w, 100);
  canvas.height = Math.max(h, 100);
  // Restore
  const image = new Image();
  image.onload = () => ctx.drawImage(image, 0, 0);
  image.src = img;
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left),
    y: (e.clientY - rect.top)
  };
}

function canDraw() {
  return gameState && gameState.state === 'playing' && gameState.drawer === socket.id;
}

function onMouseDown(e) {
  if (!canDraw()) return;
  isDrawing = true;
  const { x, y } = getPos(e);
  lastX = x; lastY = y;
  // Save undo state
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  redoStack = [];
}

function onMouseMove(e) {
  if (!isDrawing || !canDraw()) return;
  const { x, y } = getPos(e);
  const color = currentTool === 'eraser' ? '#ffffff' : document.getElementById('dg-color').value;
  const size  = currentTool === 'brush'  ? parseInt(document.getElementById('dg-size').value) * 2 : parseInt(document.getElementById('dg-size').value);

  drawLine(lastX, lastY, x, y, color, size, currentTool);

  socket.emit('dg-draw', {
    roomCode,
    data: {
      x0: lastX / canvas.width, y0: lastY / canvas.height,
      x1: x    / canvas.width, y1: y    / canvas.height,
      color, size, tool: currentTool
    }
  });
  lastX = x; lastY = y;
}

function onMouseUp() { isDrawing = false; }

function drawLine(x0, y0, x1, y1, color, size, tool) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth   = size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.stroke();
  ctx.closePath();
  ctx.globalCompositeOperation = 'source-over';
}

function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn[id^=tool-]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + tool);
  if (btn) btn.classList.add('active');
  canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
}

function dgUndo() {
  if (undoStack.length === 0) return;
  redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  ctx.putImageData(undoStack.pop(), 0, 0);
}
function dgRedo() {
  if (redoStack.length === 0) return;
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  ctx.putImageData(redoStack.pop(), 0, 0);
}

function dgClearCanvas() {
  if (!canDraw()) return;
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit('dg-clear', { roomCode });
}

/* ─── game actions ───────────────────────────────── */
function dgStartRound() {
  socket.emit('dg-start', { roomCode, name: myName });
}

function dgSendGuess() {
  const input = document.getElementById('dg-guess-input');
  const text  = input.value.trim();
  if (!text) return;
  socket.emit('dg-guess', { roomCode, text, name: myName });
  appendChat(myName, text, 'me');
  input.value = '';
}

/* ─── ui helpers ─────────────────────────────────── */
function appendChat(who, text, type = 'normal') {
  const strip = document.getElementById('chat-strip');
  const div   = document.createElement('div');
  div.className = 'chat-msg' + (type === 'system' ? ' system' : '');
  if (type === 'system') {
    div.textContent = text;
  } else {
    div.innerHTML = `<span class="who">${escHtml(who)}:</span> <span class="text">${escHtml(text)}</span>`;
  }
  strip.appendChild(div);
  // Keep only last 6 messages in strip
  while (strip.children.length > 6) strip.removeChild(strip.firstChild);
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showCorrectToast(msg = '✅ Correct!') {
  const t = document.getElementById('correct-toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function updateTimerRing(val, max) {
  const r = 22, circumference = 2 * Math.PI * r; // ≈138.2
  const fill = document.getElementById('timer-ring-fill');
  const offset = circumference - (val / max) * circumference;
  fill.style.strokeDashoffset = offset;
  fill.style.stroke = val <= 10 ? 'var(--danger)' : val <= 20 ? 'var(--warning)' : 'var(--accent)';
  document.getElementById('timer-num').textContent = val;
}

function colorFor(id) {
  let hash = 0;
  for (let c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function renderScores(state) {
  const list = document.getElementById('dg-score-list');
  if (!Object.keys(scoreMap).length) {
    list.innerHTML = '<div class="empty-lb"><i data-lucide="trophy" style="width:32px;height:32px"></i><p>Scores will appear<br>once the game starts</p></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  const sorted = Object.entries(scoreMap).sort((a,b) => b[1].score - a[1].score);
  list.innerHTML = sorted.map(([id, p], i) => {
    const rankCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const medals  = ['🥇','🥈','🥉'];
    const rank    = i < 3 ? medals[i] : i + 1;
    const isDrawing = state && state.drawer === id;
    const hasGuessed = state && state.guessed && state.guessed.includes(id);
    const initials = (p.name || 'P').substring(0,2).toUpperCase();
    return `<div class="lb-item">
      <div class="lb-rank ${rankCls}">${rank}</div>
      <div class="lb-avatar" style="background:${colorFor(id)}">${initials}</div>
      <div class="lb-name">${escHtml(p.name || 'Player')}</div>
      ${isDrawing  ? '<span style="font-size:10px">✏️</span>' : ''}
      ${hasGuessed ? '<div class="lb-guessed-dot"></div>' : ''}
      <div class="lb-score">${p.score}</div>
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function renderParticipants(state) {
  const list = document.getElementById('participants-list');
  const ids  = Object.keys(scoreMap);
  document.getElementById('p-count').textContent = ids.length;
  document.getElementById('hdr-online').innerHTML = `<i data-lucide="users" style="width:13px;height:13px;vertical-align:-2px"></i> ${ids.length} online`;
  if (!ids.length) {
    list.innerHTML = '<div class="empty-lb" style="padding:16px"><p>Waiting for players...</p></div>';
    return;
  }
  list.innerHTML = ids.map((id, i) => {
    const p = scoreMap[id];
    const isMe       = id === socket.id;
    const isDrawing  = state && state.drawer === id;
    const hasGuessed = state && state.guessed && state.guessed.includes(id);
    const initials   = (p.name || 'P').substring(0,2).toUpperCase();
    const badgeHtml  = isDrawing  ? '<span class="badge-drawing">Drawing</span>' :
                       hasGuessed ? '<span class="badge-guessed">Guessed</span>' : '';
    return `<div class="participant-item">
      <div class="participant-avatar" style="background:${colorFor(id)}">${initials}</div>
      <div class="participant-info">
        <div class="participant-name">${escHtml(p.name || 'Player')} ${isMe ? '<span style="font-size:9px;color:var(--text-dim)">(you)</span>' : ''}</div>
        <div class="participant-role">${p.score} pts</div>
      </div>
      ${badgeHtml}
    </div>`;
  }).join('');
}

/* ─── socket listeners ───────────────────────────── */
socket.on('dg-state', (state) => {
  gameState = state;

  // Update score map names
  if (state.scores) {
    for (const [id, info] of Object.entries(state.scores)) {
      if (!scoreMap[id]) scoreMap[id] = { name: info.name || 'Player', score: 0 };
      scoreMap[id].score = info.score !== undefined ? info.score : (typeof info === 'number' ? info : 0);
      if (info.name) scoreMap[id].name = info.name;
    }
  }

  const waiting = document.getElementById('waiting-state');
  const toolbar = document.getElementById('dg-toolbar');

  if (state.state === 'waiting') {
    waiting.style.display = 'flex';
    toolbar.style.display = 'none';
    document.getElementById('word-banner-text').textContent = 'Waiting to Start';
    document.getElementById('word-banner-text').className   = 'word-display';
    document.getElementById('timer-status').textContent = 'Waiting';
    document.getElementById('timer-sub').textContent    = 'Press Start Round to begin';
    document.getElementById('hint-chars').textContent   = '—';
    updateTimerRing(0, timerMax);

  } else if (state.state === 'playing') {
    waiting.style.display = 'none';

    if (state.drawer === socket.id) {
      // I am the drawer
      toolbar.style.display = 'flex';
      canvas.style.cursor   = 'crosshair';
      document.getElementById('timer-status').textContent = '✏️ You are drawing!';
      document.getElementById('hint-chars').textContent   = '—';
    } else {
      toolbar.style.display = 'none';
      canvas.style.cursor   = 'default';
      // hint
      const hint = Array(state.wordLength).fill('_').join(' ');
      document.getElementById('hint-chars').textContent = hint;
      document.getElementById('word-banner-text').textContent = hint;
      document.getElementById('word-banner-text').className   = 'word-display';
      const drawerName = scoreMap[state.drawer]?.name || 'Someone';
      document.getElementById('timer-status').textContent = `${drawerName} is drawing`;
      document.getElementById('timer-sub').textContent    = `${state.wordLength} letters`;
    }

    document.getElementById('round-badge').textContent = `Round ${round}`;
    updateTimerRing(state.timeLeft, timerMax);
  }

  renderScores(state);
  renderParticipants(state);

  if (window.lucide) lucide.createIcons();
});

socket.on('dg-word', (word) => {
  // Only the drawer sees this
  const banner = document.getElementById('word-banner-text');
  banner.textContent = 'DRAW: ' + word.toUpperCase();
  banner.className   = 'word-display drawing';
  document.getElementById('hint-chars').textContent = word.toUpperCase();
  document.getElementById('timer-sub').textContent  = `You're drawing "${word}"`;
});

socket.on('dg-time', (time) => {
  updateTimerRing(time, timerMax);
  document.getElementById('timer-num').textContent = time;
  if (time <= 10) {
    document.getElementById('timer-status').textContent = '⏰ Hurry up!';
  }
});

socket.on('dg-draw', ({ data }) => {
  drawLine(
    data.x0 * canvas.width,  data.y0 * canvas.height,
    data.x1 * canvas.width,  data.y1 * canvas.height,
    data.color, data.size, data.tool || 'pencil'
  );
});

socket.on('dg-clear', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on('dg-system-msg', (msg) => {
  appendChat('', msg, 'system');
  if (msg.includes('guessed')) showCorrectToast('✅ ' + msg);
  if (msg.includes("word was")) round++;
});

socket.on('dg-chat', ({ name, text }) => {
  appendChat(name, text);
});

socket.on('dg-player-joined', ({ name, scores }) => {
  appendChat('', `${name} joined the game`, 'system');
  // Rebuild scoreMap
  if (scores) {
    for (const [id, info] of Object.entries(scores)) {
      if (!scoreMap[id]) scoreMap[id] = { name: info.name || name, score: 0 };
      if (info.name) scoreMap[id].name = info.name;
    }
  }
  renderParticipants(gameState);
  document.getElementById('hdr-online').innerHTML = `<i data-lucide="users" style="width:13px;height:13px;vertical-align:-2px"></i> ${Object.keys(scoreMap).length} online`;
  if (window.lucide) lucide.createIcons();
});

socket.on('dg-player-left', ({ id }) => {
  const name = scoreMap[id]?.name || 'Someone';
  delete scoreMap[id];
  appendChat('', `${name} left the game`, 'system');
  renderParticipants(gameState);
  renderScores(gameState);
});

window.setTool  = setTool;
window.dgUndo   = dgUndo;
window.dgRedo   = dgRedo;
window.dgClearCanvas = dgClearCanvas;
window.dgStartRound  = dgStartRound;
window.dgSendGuess   = dgSendGuess;
