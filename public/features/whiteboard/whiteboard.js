const canvas = document.getElementById('wb-canvas');
const ctx = canvas.getContext('2d');
let tool = 'pen';
let color = '#00B894';
let size = 4;
let drawing = false;
let startX, startY;
let history = [];
let snapshot;

// ── RESIZE ───────────────────────────────────────────────────────
function resize() {
  // Use the board area container (not the whole wrap) for precise sizing
  const boardArea = canvas.parentElement; // .wb-board-area
  if (!boardArea) return;

  // Save the latest drawn frame before resizing wipes the canvas
  const imgData = history.length ? history[history.length - 1] : null;

  canvas.width  = boardArea.clientWidth;
  canvas.height = boardArea.clientHeight;

  // Always restore white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (imgData) {
    const img = new Image();
    img.src = imgData;
    img.onload = () => ctx.drawImage(img, 0, 0);
  }
}
window.addEventListener('resize', resize);
resize();

// ── TOOL SELECTION ────────────────────────────────────────────────
function setTool(t) {
  tool = t;
  document.querySelectorAll('.wb-tool').forEach(b => {
    if (['tool-pen','tool-line','tool-rect','tool-circle','tool-text','tool-eraser'].includes(b.id)) {
      b.classList.remove('active');
    }
  });
  const el = document.getElementById('tool-' + t);
  if (el) el.classList.add('active');
  canvas.style.cursor = t === 'eraser' ? 'cell' : t === 'text' ? 'text' : 'crosshair';
}

function setColor(c) {
  color = c;
  document.getElementById('color-swatch').style.background = c;
}

function setSize(s) {
  size = s;
  document.querySelectorAll('#tool-thin,#tool-mid,#tool-thick').forEach(b => b.classList.remove('active-size'));
  const map = { 2: 'tool-thin', 4: 'tool-mid', 8: 'tool-thick' };
  if (map[s]) document.getElementById(map[s]).classList.add('active-size');
}

// ── POSITION HELPER ───────────────────────────────────────────────
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

// ── TEXT TOOL ──────────────────────────────────────────────────────
function placeTextInput(x, y) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'wb-text-input';
  inp.style.left = (canvas.getBoundingClientRect().left + x) + 'px';
  inp.style.top = (canvas.getBoundingClientRect().top + y) + 'px';
  inp.style.fontSize = (size * 4 + 8) + 'px';
  inp.style.color = color;
  document.body.appendChild(inp);
  inp.focus();
  const commit = () => {
    const text = inp.value.trim();
    if (text) {
      ctx.font = `${size * 4 + 8}px Inter,sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y + size * 4);
      saveHistory();
      window.parent.postMessage({ type: 'WHITEBOARD_DRAW', data: { tool: 'text', color, size, x, y, text } }, '*');
    }
    inp.remove();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') inp.remove(); });
}

// ── EVENTS ────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', start);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', end);
canvas.addEventListener('mouseleave', end);
canvas.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, { passive: false });
canvas.addEventListener('touchmove', e => { e.preventDefault(); draw(e); }, { passive: false });
canvas.addEventListener('touchend', end);

function start(e) {
  const { x, y } = getPos(e);
  if (tool === 'text') { placeTextInput(x, y); return; }
  drawing = true;
  startX = x; startY = y;
  snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (tool === 'pen' || tool === 'eraser') {
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
}

function draw(e) {
  if (!drawing) return;
  const { x, y } = getPos(e);
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  if (tool === 'pen') {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
    window.parent.postMessage({ type: 'WHITEBOARD_DRAW', data: { tool, color, size, x, y, startX, startY, action: 'move' } }, '*');
  } else if (tool === 'eraser') {
    ctx.lineWidth = size * 5;
    ctx.lineCap = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
  } else {
    // Shape tools: preview
    ctx.putImageData(snapshot, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    if (tool === 'rect') {
      ctx.strokeRect(startX, startY, x - startX, y - startY);
    } else if (tool === 'circle') {
      const rx = (x - startX) / 2, ry = (y - startY) / 2;
      ctx.ellipse(startX + rx, startY + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === 'line') {
      ctx.moveTo(startX, startY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
}

function end(e) {
  if (!drawing) return;
  drawing = false;
  ctx.globalCompositeOperation = 'source-over';
  if (tool !== 'pen' && tool !== 'eraser' && e) {
    const pos = e.changedTouches ? getPos({ touches: e.changedTouches }) : (e.type === 'mouseleave' ? { x: startX, y: startY } : getPos(e));
    window.parent.postMessage({ type: 'WHITEBOARD_DRAW', data: { tool, color, size, x: pos.x, y: pos.y, startX, startY, action: 'end' } }, '*');
  }
  saveHistory();
}

function saveHistory() {
  history.push(canvas.toDataURL());
  if (history.length > 40) history.shift();
}

function undoLast() {
  if (history.length > 1) {
    history.pop();
    const img = new Image();
    img.src = history[history.length - 1];
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    history = [];
  }
}

function clearBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  history = [];
  window.parent.postMessage({ type: 'WHITEBOARD_CLEAR' }, '*');
}

// ── KEYBOARD SHORTCUTS ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (document.querySelector('.wb-text-input:focus')) return;
  if (e.ctrlKey && e.key === 'z') { undoLast(); return; }
  if (e.key === 'p' || e.key === 'P') setTool('pen');
  if (e.key === 'e' || e.key === 'E') setTool('eraser');
  if (e.key === 't' || e.key === 'T') setTool('text');
  if (e.key === 'r' || e.key === 'R') setTool('rect');
});

// ── RECEIVE REMOTE DRAWS ──────────────────────────────────────────
window.addEventListener('message', e => {
  const { type, data } = e.data || {};
  if (type === 'DRAW') {
    ctx.globalCompositeOperation = 'source-over';
    if (data.tool === 'text' && data.text) {
      ctx.font = `${data.size * 4 + 8}px Inter,sans-serif`;
      ctx.fillStyle = data.color;
      ctx.fillText(data.text, data.x, data.y + data.size * 4);
    } else if (data.action === 'move' && data.tool === 'pen') {
      ctx.strokeStyle = data.color;
      ctx.lineWidth = data.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineTo(data.x, data.y);
      ctx.stroke();
    } else if (data.action === 'end') {
      ctx.strokeStyle = data.color;
      ctx.lineWidth = data.size;
      ctx.beginPath();
      if (data.tool === 'rect') {
        ctx.strokeRect(data.startX, data.startY, data.x - data.startX, data.y - data.startY);
      } else if (data.tool === 'circle') {
        const rx = (data.x - data.startX) / 2, ry = (data.y - data.startY) / 2;
        ctx.ellipse(data.startX + rx, data.startY + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (data.tool === 'line') {
        ctx.moveTo(data.startX, data.startY);
        ctx.lineTo(data.x, data.y);
        ctx.stroke();
      }
    }
  }
  if (type === 'CLEAR') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    history = [];
  }
});
