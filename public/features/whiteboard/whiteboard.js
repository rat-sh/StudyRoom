// ── STATE ──────────────────────────────────────────────────────
const roomCode = new URLSearchParams(window.location.search).get('room');
let currentTool = 'select';
let currentColor = '#00B894';
let currentSize = 4;
let isPanning = false;

// ── INIT FABRIC CANVAS ─────────────────────────────────────────
const canvas = new fabric.Canvas('wb-canvas', {
  isDrawingMode: false,
  selection: true,
  preserveObjectStacking: true,
  backgroundColor: '#FFFFFF',
  width: document.querySelector('.wb-board-area').clientWidth,
  height: document.querySelector('.wb-board-area').clientHeight
});

function resize() {
  const container = document.querySelector('.wb-board-area');
  canvas.setWidth(container.clientWidth);
  canvas.setHeight(container.clientHeight);
  canvas.renderAll();
}
window.addEventListener('resize', resize);
resize();

// ── SETUP BRUSH ───────────────────────────────────────────────
canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
canvas.freeDrawingBrush.color = currentColor;
canvas.freeDrawingBrush.width = currentSize;

// ── TOOL & UI LOGIC ───────────────────────────────────────────
window.setTool = function(t) {
  currentTool = t;
  document.querySelectorAll('.wb-tool').forEach(b => {
    if (['tool-select','tool-pen','tool-line','tool-rect','tool-circle','tool-text','tool-eraser'].includes(b.id)) {
      b.classList.remove('active');
    }
  });
  const el = document.getElementById('tool-' + t);
  if (el) el.classList.add('active');

  // Configure Fabric based on tool
  canvas.isDrawingMode = (t === 'pen' || t === 'eraser');
  if (t === 'eraser') {
    // Basic eraser: draw white lines
    canvas.freeDrawingBrush.color = '#FFFFFF';
    canvas.freeDrawingBrush.width = currentSize * 5;
  } else {
    canvas.freeDrawingBrush.color = currentColor;
    canvas.freeDrawingBrush.width = currentSize;
  }
  
  // Selection mode
  const isSelect = (t === 'select');
  canvas.selection = isSelect;
  canvas.forEachObject(o => {
    o.selectable = isSelect;
    o.evented = isSelect;
  });
  
  canvas.defaultCursor = t === 'text' ? 'text' : (isSelect ? 'default' : 'crosshair');
};

window.setColor = function(c) {
  currentColor = c;
  document.getElementById('color-swatch').style.background = c;
  if (currentTool !== 'eraser') {
    canvas.freeDrawingBrush.color = c;
  }
  const activeObj = canvas.getActiveObject();
  if (activeObj) {
    if (activeObj.type === 'i-text' || activeObj.type === 'textbox') {
      activeObj.set('fill', c);
    } else if (activeObj.type === 'path') {
      activeObj.set('stroke', c);
    } else {
      activeObj.set('stroke', c);
    }
    canvas.renderAll();
    syncObject(activeObj);
    saveState();
  }
};

window.setSize = function(s) {
  currentSize = s;
  document.querySelectorAll('#tool-thin,#tool-mid,#tool-thick').forEach(b => b.classList.remove('active-size'));
  const map = { 2: 'tool-thin', 4: 'tool-mid', 8: 'tool-thick' };
  if (map[s]) document.getElementById(map[s]).classList.add('active-size');
  
  if (currentTool !== 'eraser') {
    canvas.freeDrawingBrush.width = s;
  } else {
    canvas.freeDrawingBrush.width = s * 5;
  }
};

// ── SHAPE & TEXT DRAWING LOGIC ────────────────────────────────
let shape, origX, origY;
let isDrawingShape = false;

canvas.on('mouse:down', function(o) {
  if (o.e.altKey || o.e.code === 'Space') {
    isPanning = true;
    canvas.selection = false;
    return;
  }
  if (currentTool === 'select' || currentTool === 'pen' || currentTool === 'eraser') return;
  
  const pointer = canvas.getPointer(o.e);
  origX = pointer.x;
  origY = pointer.y;
  isDrawingShape = true;

  if (currentTool === 'text') {
    const text = new fabric.Textbox('Type here...', {
      left: origX, top: origY,
      fill: currentColor, fontSize: currentSize * 4 + 8,
      fontFamily: 'Inter',
      width: 150,
      id: generateId()
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    setTool('select');
    isDrawingShape = false;
  } else if (currentTool === 'rect') {
    shape = new fabric.Rect({ left: origX, top: origY, width: 0, height: 0, fill: 'transparent', stroke: currentColor, strokeWidth: currentSize, id: generateId() });
    canvas.add(shape);
  } else if (currentTool === 'circle') {
    shape = new fabric.Ellipse({ left: origX, top: origY, rx: 0, ry: 0, fill: 'transparent', stroke: currentColor, strokeWidth: currentSize, id: generateId() });
    canvas.add(shape);
  } else if (currentTool === 'line') {
    shape = new fabric.Line([origX, origY, origX, origY], { stroke: currentColor, strokeWidth: currentSize, id: generateId() });
    canvas.add(shape);
  }
});

canvas.on('mouse:move', function(o) {
  if (isPanning && o.e.movementX !== undefined) {
    const delta = new fabric.Point(o.e.movementX, o.e.movementY);
    canvas.relativePan(delta);
    return;
  }
  if (!isDrawingShape || !shape) return;
  
  const pointer = canvas.getPointer(o.e);
  if (currentTool === 'rect') {
    shape.set({ width: Math.abs(origX - pointer.x), height: Math.abs(origY - pointer.y) });
    shape.set({ left: Math.min(origX, pointer.x), top: Math.min(origY, pointer.y) });
  } else if (currentTool === 'circle') {
    shape.set({ rx: Math.abs(origX - pointer.x)/2, ry: Math.abs(origY - pointer.y)/2 });
    shape.set({ left: Math.min(origX, pointer.x), top: Math.min(origY, pointer.y) });
  } else if (currentTool === 'line') {
    shape.set({ x2: pointer.x, y2: pointer.y });
  }
  canvas.renderAll();
});

canvas.on('mouse:up', function(o) {
  if (isPanning) {
    isPanning = false;
    canvas.selection = currentTool === 'select';
    return;
  }
  if (isDrawingShape && shape) {
    shape.setCoords();
    syncObject(shape);
    saveState();
    shape = null;
  }
  isDrawingShape = false;
});

// Zooming
canvas.on('mouse:wheel', function(opt) {
  const delta = opt.e.deltaY;
  let zoom = canvas.getZoom();
  zoom *= 0.999 ** delta;
  if (zoom > 5) zoom = 5;
  if (zoom < 0.1) zoom = 0.1;
  canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
  opt.e.preventDefault();
  opt.e.stopPropagation();
});

// Keyboard shortcuts for delete
window.addEventListener('keydown', e => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const active = canvas.getActiveObjects();
    if (active.length > 0) {
      // Dont delete if typing in a textbox
      if (active[0].isEditing) return;
      active.forEach(obj => {
        canvas.remove(obj);
        removeObjectRemote(obj.id);
      });
      canvas.discardActiveObject();
      saveState();
    }
  }
});

// ── SYNC LOGIC ───────────────────────────────────────────────
let ignoreSync = false;

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

canvas.on('path:created', function(e) {
  if (ignoreSync) return;
  e.path.set('id', generateId());
  syncObject(e.path);
  saveState();
});

canvas.on('object:modified', function(e) {
  if (ignoreSync) return;
  const target = e.target;
  if (target.type === 'activeSelection') {
    target._objects.forEach(obj => syncObject(obj));
  } else {
    syncObject(target);
  }
  saveState();
});

function syncObject(obj) {
  if (!obj || !obj.id) return;
  const json = obj.toJSON(['id']);
  window.parent.postMessage({ type: 'WHITEBOARD_DRAW', data: { action: 'update', obj: json } }, '*');
}

function removeObjectRemote(id) {
  if (!id) return;
  window.parent.postMessage({ type: 'WHITEBOARD_DRAW', data: { action: 'remove', id } }, '*');
}

window.clearBoard = function() {
  canvas.clear();
  canvas.backgroundColor = '#FFFFFF';
  window.parent.postMessage({ type: 'WHITEBOARD_CLEAR' }, '*');
  saveState();
};

window.addEventListener('message', e => {
  const { type, data } = e.data || {};
  if (type === 'CLEAR') {
    ignoreSync = true;
    canvas.clear();
    canvas.backgroundColor = '#FFFFFF';
    ignoreSync = false;
  } else if (type === 'DRAW') {
    handleRemoteDraw(data);
  }
});

function handleRemoteDraw(data) {
  if (!data || !data.action) return;
  ignoreSync = true;
  
  if (data.action === 'remove') {
    const obj = canvas.getObjects().find(o => o.id === data.id);
    if (obj) canvas.remove(obj);
  } else if (data.action === 'update' && data.obj) {
    const existingObj = canvas.getObjects().find(o => o.id === data.obj.id);
    if (existingObj) {
      existingObj.set(data.obj);
      existingObj.setCoords();
      canvas.renderAll();
    } else {
      fabric.util.enlivables = fabric.util.enlivables || []; // safety
      fabric.util.enlivenObjects([data.obj], function(enlivenedObjects) {
        if (enlivenedObjects.length > 0) {
          const obj = enlivenedObjects[0];
          obj.set({ selectable: currentTool === 'select', evented: currentTool === 'select' });
          canvas.add(obj);
        }
      });
    }
  }
  ignoreSync = false;
}

// ── SAVE / LOAD STATE ─────────────────────────────────────────
async function saveState() {
  if (!roomCode) return;
  const json = canvas.toJSON(['id']);
  try {
    await fetch(`/api/whiteboard/${roomCode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: json })
    });
  } catch (err) {
    console.error('Failed to save whiteboard state:', err);
  }
}

async function loadState() {
  if (!roomCode) return;
  try {
    const res = await fetch(`/api/whiteboard/${roomCode}`);
    if (!res.ok) return;
    const elements = await res.json();
    if (elements && Object.keys(elements).length > 0 && elements.objects) {
      ignoreSync = true;
      canvas.loadFromJSON(elements, () => {
        canvas.forEachObject(o => {
          o.selectable = currentTool === 'select';
          o.evented = currentTool === 'select';
        });
        canvas.renderAll();
        ignoreSync = false;
      });
    }
  } catch (err) {
    console.error('Failed to load whiteboard state:', err);
  }
}

// Load initial state on startup
loadState();

// ── EXPORT ───────────────────────────────────────────────────
window.exportImage = function() {
  const dataURL = canvas.toDataURL({
    format: 'png',
    quality: 1
  });
  const link = document.createElement('a');
  link.download = `whiteboard-${roomCode || 'export'}.png`;
  link.href = dataURL;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

window.exportPDF = function() {
  if (!window.jspdf) {
    alert('PDF generator not loaded yet. Please try again.');
    return;
  }
  const dataURL = canvas.toDataURL({ format: 'png', quality: 1 });
  const { jsPDF } = window.jspdf;
  
  // Create landscape PDF matching canvas aspect ratio
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'l' : 'p',
    unit: 'px',
    format: [canvas.width, canvas.height]
  });
  
  pdf.addImage(dataURL, 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(`whiteboard-${roomCode || 'export'}.pdf`);
};

// ── KEYBOARD ACTIONS & UNDO ────────────────────────────────────
window.undoLast = function() {
  const objects = canvas.getObjects();
  if (objects.length > 0) {
    const lastObj = objects[objects.length - 1];
    canvas.remove(lastObj);
    removeObjectRemote(lastObj.id);
    saveState();
  }
};

document.addEventListener('keydown', e => {
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || (canvas.getActiveObject() && canvas.getActiveObject().isEditing)) return;
  
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoLast();
    return;
  }
  
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'p' || e.key === 'P') setTool('pen');
  if (e.key === 'e' || e.key === 'E') setTool('eraser');
  if (e.key === 't' || e.key === 'T') setTool('text');
  if (e.key === 'r' || e.key === 'R') setTool('rect');
});
