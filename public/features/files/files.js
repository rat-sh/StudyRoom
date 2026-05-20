let sharedFiles = [];
const params = new URLSearchParams(window.location.search);
const roomCode = params.get('room');

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

async function loadRoomFiles() {
  if (!window.parent.API) return;
  const { ok, data } = await window.parent.API.get(`/api/media?room=${roomCode}`);
  if (ok) {
    sharedFiles = data.items || [];
    renderFiles();
  }
}

// Initial load
setTimeout(loadRoomFiles, 500);

// Listen to parent EventBus for live sync
if (window.parent.EventBus) {
  window.parent.EventBus.on('FILE_UPLOADED', (m) => { if (m.roomCode === roomCode) loadRoomFiles(); });
  window.parent.EventBus.on('FILE_DELETED', loadRoomFiles);
  window.parent.EventBus.on('FILE_EDITED', loadRoomFiles);
}

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (file.size > 50 * 1024 * 1024) { alert(`${file.name} is too large (max 50MB)`); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const { ok } = await window.parent.API.post('/api/media/upload', {
          fileName: file.webkitRelativePath || file.name,
          fileType: getFileType(file),
          mimeType: file.type,
          fileSize: file.size,
          data: e.target.result,
          source: 'room',
          roomCode
        });
        if (ok) loadRoomFiles();
      } catch(err) {
        console.error(err);
      }
    };
    reader.readAsDataURL(file);
  });
}

function renderFiles() {
  const list = document.getElementById('files-list');
  if (!sharedFiles.length) { list.innerHTML = '<div class="files-empty">No files shared yet</div>'; return; }
  list.innerHTML = sharedFiles.map((f, i) => `
    <div class="file-item">
      <div class="file-icon">${getFileIcon(f.fileType)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(f.fileName)}</div>
        <div class="file-meta">${formatSize(f.fileSize)} · ${f.uploader?.name || 'Unknown'} · ${new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <a class="file-dl" href="${f.data}" download="${escapeHtml(f.fileName)}">↓</a>
    </div>
  `).join('');
  if (window.parent && window.parent.lucide) window.parent.lucide.createIcons();
  else if (window.lucide) lucide.createIcons();
}

function getFileType(file) {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf') return 'pdf';
  return 'other';
}

function getFileIcon(type) {
  if (!type) return '<i data-lucide="file" style="width:16px;height:16px"></i>';
  if (type === 'image') return '<i data-lucide="image" style="width:16px;height:16px"></i>';
  if (type === 'video') return '<i data-lucide="video" style="width:16px;height:16px"></i>';
  if (type === 'audio') return '<i data-lucide="music" style="width:16px;height:16px"></i>';
  if (type === 'pdf') return '<i data-lucide="file-text" style="width:16px;height:16px"></i>';
  return '<i data-lucide="file" style="width:16px;height:16px"></i>';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.innerText = str;
  return div.innerHTML;
}
