let currentMediaTab = 'all';
let mediaSearchTimeout = null;
const MAX_STORAGE = 100 * 1024 * 1024; // 100MB fake limit for visualization

function setMediaTab(tab, btnEl) {
  currentMediaTab = tab;
  document.querySelectorAll('.media-tab').forEach(el => el.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  loadMedia();
}

function debounceMediaSearch() {
  clearTimeout(mediaSearchTimeout);
  mediaSearchTimeout = setTimeout(loadMedia, 300);
}

function triggerMediaUpload() {
  document.getElementById('media-upload-input').click();
}

function triggerFolderUpload() {
  document.getElementById('media-folder-input').click();
}

function getFileType(file) {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf') return 'pdf';
  return 'other';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function handleMediaUpload(e) {
  const files = e.target.files || e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  
  const total = files.length;
  let completed = 0;
  
  if (total > 1) {
    showToast(`Starting upload of ${total} files...`);
  }
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > 50 * 1024 * 1024) {
      showToast('File too large (max 50MB): ' + file.name);
      completed++;
      continue;
    }
    
    // Convert to base64 for MVP upload
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const b64 = ev.target.result;
      const fileType = getFileType(file);
      
      // Determine source context (e.g., if inside a room, tag it as room)
      let source = 'direct';
      let roomCode = null;
      if (window.location.pathname.startsWith('/room/')) {
        source = 'room';
        roomCode = window.location.pathname.split('/room/')[1];
      }
      
      try {
        const { ok, data } = await window.API.post('/api/media/upload', {
          fileName: file.webkitRelativePath || file.name, // Use relative path if folder upload
          fileType,
          mimeType: file.type,
          fileSize: file.size,
          data: b64,
          source,
          roomCode
        });
        
        completed++;
        if (total === 1) {
          if (ok) showToast('Uploaded: ' + file.name);
          else showToast('Failed: ' + (data?.error || 'Unknown error'));
        } else {
          // Queue progress
          if (completed % 5 === 0 || completed === total) {
            showToast(`Upload queue: ${completed}/${total} completed`);
          }
        }
        
        if (ok && completed === total) {
          loadMedia();
        }
      } catch (err) {
        completed++;
        if (total === 1) showToast('Upload error');
      }
    };
    reader.readAsDataURL(file);
  }
}

async function loadMedia() {
  const search = document.getElementById('media-search').value;
  const room = document.getElementById('media-room-filter').value;
  const uploader = document.getElementById('media-uploader-filter')?.value;
  const dateStr = document.getElementById('media-date-filter')?.value;
  const grid = document.getElementById('media-grid');
  const empty = document.getElementById('media-empty');
  
  const query = new URLSearchParams();
  query.append('tab', currentMediaTab);
  if (search) query.append('search', search);
  if (room) query.append('room', room);
  if (uploader) query.append('uploader', uploader);
  if (dateStr) query.append('date', dateStr);
  
  const { ok, data } = await window.API.get('/api/media?' + query.toString());
  if (!ok) {
    showToast('Failed to load media');
    return;
  }
  
  // Update storage bar
  const used = data.storageUsed || 0;
  const pct = Math.min(100, (used / MAX_STORAGE) * 100);
  document.getElementById('media-storage-bar').style.width = pct + '%';
  document.getElementById('media-storage-text').textContent = formatBytes(used) + ' / 100 MB';
  
  const items = data.items || [];
  grid.innerHTML = '';
  
  if (items.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
  } else {
    grid.style.display = 'flex';
    empty.style.display = 'none';
    
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.style = 'background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden;position:relative;display:flex;flex-direction:column;cursor:pointer;transition:transform 0.2s';
      card.onmouseover = () => card.style.transform = 'translateY(-2px)';
      card.onmouseout = () => card.style.transform = '';
      card.onclick = () => previewMedia(item);
      
      let previewHtml = '';
      if (item.fileType === 'image') {
        previewHtml = `<div style="height:120px;background:url('${item.data}') center/cover"></div>`;
      } else if (item.fileType === 'video') {
        previewHtml = `<div style="height:120px;background:#000;display:flex;align-items:center;justify-content:center"><i data-lucide="video" style="width:32px;height:32px;color:#fff"></i></div>`;
      } else {
        const iconMap = { audio: 'music', pdf: 'file-text', link: 'link' };
        const icon = iconMap[item.fileType] || 'file';
        previewHtml = `<div style="height:120px;background:var(--bg3);display:flex;align-items:center;justify-content:center"><i data-lucide="${icon}" style="width:32px;height:32px;color:var(--muted)"></i></div>`;
      }
      
      const isStarred = item.starredBy && window.API.user() && item.starredBy.includes(window.API.user().id);
      const starColor = isStarred ? 'var(--accent)' : 'var(--muted)';
      
      card.innerHTML = `
        ${previewHtml}
        <div style="padding:12px;flex:1;display:flex;flex-direction:column">
          <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;display:flex;justify-content:space-between">
            <span>${formatBytes(item.fileSize)}</span>
            <span>${new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <button onclick="toggleStarMedia('${item._id}', event)" style="position:absolute;top:8px;right:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px;cursor:pointer;color:${starColor}">
          <i data-lucide="star" style="width:14px;height:14px"></i>
        </button>
      `;
      grid.appendChild(card);
    });
    if (window.lucide) lucide.createIcons();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.innerText = str;
  return div.innerHTML;
}

async function toggleStarMedia(id, e) {
  e.stopPropagation();
  const { ok } = await window.API.post(`/api/media/${id}/star`);
  if (ok) loadMedia();
}

function previewMedia(item) {
  // Create a modal to preview media
  const overlay = document.createElement('div');
  overlay.id = 'media-preview-modal';
  overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = () => overlay.remove();
  
  const content = document.createElement('div');
  content.style = 'background:var(--bg);border-radius:12px;padding:20px;max-width:800px;width:100%;max-height:90vh;overflow-y:auto;position:relative';
  content.onclick = (e) => e.stopPropagation();
  
  let mediaHtml = '';
  if (item.fileType === 'image') {
    mediaHtml = `<img src="${item.data}" style="max-width:100%;border-radius:8px">`;
  } else if (item.fileType === 'video') {
    mediaHtml = `<video src="${item.data}" controls style="max-width:100%;border-radius:8px"></video>`;
  } else if (item.fileType === 'audio') {
    mediaHtml = `<audio src="${item.data}" controls style="width:100%"></audio>`;
  } else {
    mediaHtml = `<div style="text-align:center;padding:40px"><i data-lucide="file" style="width:48px;height:48px;color:var(--muted);margin-bottom:16px"></i><p>Preview not available for this file type.</p><a href="${item.data}" download="${escapeHtml(item.fileName)}" style="color:var(--accent)">Download File</a></div>`;
  }
  
  let sourceBtnHtml = '';
  if (item.source === 'chat' && item.chatId) {
    sourceBtnHtml = `<button onclick="window.location.href='/chat?id=${item.chatId}'" style="background:var(--bg3);border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text)">View in Chat</button>`;
  } else if (item.source === 'room' && item.roomCode) {
    sourceBtnHtml = `<button onclick="window.location.href='/room/${item.roomCode}'" style="background:var(--bg3);border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text)">Go to Room</button>`;
  }
  
  const isOwner = window.API.user() && item.uploader._id === window.API.user().id;
  
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0;font-size:16px;display:flex;align-items:center;gap:8px">
        <span id="preview-filename">${escapeHtml(item.fileName)}</span>
        ${isOwner ? `<i data-lucide="edit-2" style="width:14px;height:14px;cursor:pointer;color:var(--muted)" onclick="renameMedia('${item._id}', '${escapeHtml(item.fileName).replace(/'/g, "\\'")}')"></i>` : ''}
      </h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        ${sourceBtnHtml}
        <button onclick="copyMediaLink('${item._id}')" style="background:var(--bg3);border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text)">Copy Link</button>
        <button onclick="downloadMedia('${item.data}', '${escapeHtml(item.fileName)}')" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600">Download</button>
        ${isOwner ? `<button onclick="deleteMedia('${item._id}')" style="background:rgba(239,68,68,0.1);color:#ef4444;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600">Delete</button>` : ''}
        <button onclick="document.getElementById('media-preview-modal')?.remove()" style="background:var(--bg3);border:none;border-radius:6px;padding:6px;cursor:pointer;color:var(--text)"><i data-lucide="x" style="width:16px;height:16px"></i></button>
      </div>
    </div>
    ${mediaHtml}
  `;
  
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();
}

async function renameMedia(id, currentName) {
  const newName = prompt('Enter new filename:', currentName);
  if (!newName || newName === currentName) return;
  const { ok, data } = await window.API.post(`/api/media/${id}/rename`, { newName });
  if (ok) {
    document.getElementById('preview-filename').textContent = data.fileName;
    loadMedia();
    showToast('File renamed');
  } else {
    showToast('Rename failed');
  }
}

function copyMediaLink(id) {
  // In a real app we would copy a real route, for now we mock it
  navigator.clipboard.writeText(window.location.origin + '/api/media/download/' + id);
  showToast('Link copied to clipboard');
}

function downloadMedia(data, filename) {
  const a = document.createElement('a');
  a.href = data;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function deleteMedia(id) {
  if (!confirm('Delete this media permanently?')) return;
  const { ok } = await window.API.delete(`/api/media/${id}`);
  if (ok) {
    document.getElementById('media-preview-modal')?.remove();
    loadMedia();
    showToast('File deleted');
  } else {
    showToast('Failed to delete file');
  }
}

// Setup Drag & Drop
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('media-dropzone');
  const overlay = document.getElementById('media-drag-overlay');
  
  if (!dropzone || !overlay) return;
  
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, preventDefaults, false);
  });
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => overlay.style.display = 'flex', false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => overlay.style.display = 'none', false);
  });
  
  dropzone.addEventListener('drop', (e) => {
    handleMediaUpload(e);
  }, false);

  // Paste Support (for screenshots/clipboards)
  document.addEventListener('paste', (e) => {
    // Only intercept if we are actively viewing the Media panel to avoid messing up chat/text inputs
    if (document.getElementById('panel-media')?.classList.contains('active')) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          files.push(items[i].getAsFile());
        }
      }
      if (files.length > 0) {
        handleMediaUpload({ target: { files } });
      }
    }
  });
  
  // Listen for panel switches to trigger loadMedia
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.target.id === 'panel-media' && mutation.target.classList.contains('active')) {
        loadMedia();
      }
    });
  });
  const panelMedia = document.getElementById('panel-media');
  if (panelMedia) observer.observe(panelMedia, { attributes: true, attributeFilter: ['class'] });

  // ── Live Sync / Socket Events via EventBus ──
  if (window.EventBus) {
    EventBus.on('FILE_UPLOADED', (media) => {
      if (media.uploader && window.API.user() && media.uploader._id !== window.API.user().id) {
        showToast('New file uploaded: ' + escapeHtml(media.fileName));
      }
      if (document.getElementById('panel-media')?.classList.contains('active')) {
        loadMedia(); // Live refresh
      }
    });

    EventBus.on('MEDIA_SHARED', (media) => {
      if (media.uploader && window.API.user() && media.uploader._id !== window.API.user().id) {
        showToast('Media shared in chat: ' + escapeHtml(media.fileName));
      }
      if (document.getElementById('panel-media')?.classList.contains('active')) {
        loadMedia();
      }
    });

    EventBus.on('FILE_DELETED', () => {
      if (document.getElementById('panel-media')?.classList.contains('active')) {
        loadMedia();
      }
    });

    EventBus.on('FILE_EDITED', (payload) => {
      if (document.getElementById('panel-media')?.classList.contains('active')) {
        loadMedia(); // Live refresh on rename
      }
    });
  }
});
