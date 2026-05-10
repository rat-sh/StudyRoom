const sharedFiles = [];

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (file.size > 10 * 1024 * 1024) { alert(`${file.name} is too large (max 10MB)`); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const fileData = { name: file.name, size: file.size, type: file.type, data: e.target.result, sharedBy: 'You', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      sharedFiles.push(fileData);
      renderFiles();
      window.parent.postMessage({ type: 'FILE_SHARE', data: { name: file.name, size: file.size, type: file.type, dataUrl: e.target.result } }, '*');
    };
    reader.readAsDataURL(file);
  });
}

window.addEventListener('message', e => {
  const { type, data } = e.data || {};
  if (type === 'FILE_RECEIVED') {
    sharedFiles.push({ ...data, sharedBy: data.sharedBy || 'Peer' });
    renderFiles();
  }
});

function renderFiles() {
  const list = document.getElementById('files-list');
  if (!sharedFiles.length) { list.innerHTML = '<div class="files-empty">No files shared yet</div>'; return; }
  list.innerHTML = sharedFiles.map((f, i) => `
    <div class="file-item">
      <div class="file-icon">${getFileIcon(f.type)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(f.name)}</div>
        <div class="file-meta">${formatSize(f.size)} · ${f.sharedBy} · ${f.time}</div>
      </div>
      <a class="file-dl" href="${f.data}" download="${f.name}">↓</a>
    </div>
  `).join('');
  if (window.parent && window.parent.lucide) window.parent.lucide.createIcons();
  else if (window.lucide) lucide.createIcons();
}

function getFileIcon(type) {
  if (!type) return '<i data-lucide="file" style="width:16px;height:16px"></i>';
  if (type.startsWith('image')) return '<i data-lucide="image" style="width:16px;height:16px"></i>';
  if (type.startsWith('video')) return '<i data-lucide="video" style="width:16px;height:16px"></i>';
  if (type.startsWith('audio')) return '<i data-lucide="music" style="width:16px;height:16px"></i>';
  if (type.includes('pdf')) return '<i data-lucide="file-text" style="width:16px;height:16px"></i>';
  if (type.includes('zip') || type.includes('rar')) return '<i data-lucide="file-archive" style="width:16px;height:16px"></i>';
  if (type.includes('sheet') || type.includes('excel')) return '<i data-lucide="sheet" style="width:16px;height:16px"></i>';
  if (type.includes('word') || type.includes('document')) return '<i data-lucide="file-text" style="width:16px;height:16px"></i>';
  return '<i data-lucide="file" style="width:16px;height:16px"></i>';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
