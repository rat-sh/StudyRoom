/**
 * Chip Music Bot — StudyRoom
 * Handles /play, /pause, /resume, /skip, /stop, /queue commands in chat
 * Renders Discord/Chip-style bot message cards in the chat panel
 * Plays music via YouTube IFrame API (shared for all room members)
 */

window.MusicBot = (() => {
  let socket = null;
  let roomCode = null;
  let currentState = {
    playing: false,
    track: null,
    queue: [],
    currentIndex: 0,
    elapsed: 0,
    pausedOffset: 0,
    startedAt: null,
  };
  let progressInterval = null;
  let localElapsed = 0;

  // ── YOUTUBE IFRAME PLAYER ─────────────────────────────────────
  let ytPlayer = null;
  let playerReady = false;
  let pendingVideoId = null;   // queued up if player not ready yet
  let pendingSeek   = 0;

  /**
   * Called automatically by the YouTube IFrame API script once it loads.
   * The function name MUST be `onYouTubeIframeAPIReady` (global).
   */
  window.onYouTubeIframeAPIReady = function () {
    const container = document.getElementById('yt-player');
    if (!container) return;

    // ── AUDIO-ONLY: keep iframe alive but completely invisible ──
    // We CANNOT use display:none — the YT IFrame API won't initialize.
    // Instead we park it 1×1 px off-screen so the audio plays silently.
    container.style.cssText = `
      position: fixed;
      width: 1px;
      height: 1px;
      left: -9999px;
      top: -9999px;
      opacity: 0;
      pointer-events: none;
      z-index: -1;
    `;

    ytPlayer = new YT.Player('yt-player', {
      height: '1',
      width: '1',
      playerVars: {
        autoplay: 1,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  };

  function onPlayerReady() {
    playerReady = true;
    // If a video was requested before the player was ready, load it now
    if (pendingVideoId) {
      loadVideo(pendingVideoId, pendingSeek);
      pendingVideoId = null;
      pendingSeek = 0;
    }
  }

  function onPlayerStateChange(event) {
    // YT.PlayerState.ENDED = 0
    if (event.data === YT.PlayerState.ENDED) {
      socket && socket.emit('music-track-ended', { roomCode });
      hidePlayer();
    }
  }

  function onPlayerError(event) {
    console.warn('YT player error:', event.data);
    showChipMessage('error', '⚠️ Could not play this track. Try `/skip` for the next one.');
  }

  function loadVideo(videoId, seekSeconds = 0) {
    if (!ytPlayer) return;
    // Player is always off-screen — just load the video, audio will play
    ytPlayer.loadVideoById({
      videoId,
      startSeconds: seekSeconds,
    });
    ytPlayer.setVolume(80); // ensure not muted
  }

  // No-op kept for call-sites that reference hidePlayer()
  function hidePlayer() { /* player is always hidden (audio-only mode) */ }

  function playTrackNow(track, seekSeconds = 0) {
    if (!track || !track.videoId) return;
    if (!playerReady) {
      // Player not ready yet — queue it up
      pendingVideoId = track.videoId;
      pendingSeek = seekSeconds;
      return;
    }
    loadVideo(track.videoId, seekSeconds);
  }

  // ── INIT ────────────────────────────────────────────────────
  function init(sock, code) {
    socket = sock;
    roomCode = code;

    // Request current state (handles late joiners)
    socket.emit('music-state-request', { roomCode });

    // Socket listeners
    socket.on('music-sync', onSync);
    socket.on('music-now-playing', onNowPlaying);
    socket.on('music-queued', onQueued);
    socket.on('music-ended', onEnded);
    socket.on('music-volume', ({ volume }) => {
      updateVolumeUI(volume);
      if (ytPlayer && playerReady) ytPlayer.setVolume(volume);
    });
  }

  // ── COMMAND PARSER ──────────────────────────────────────────
  function parseCommand(text) {
    const t = text.trim();
    if (!t.startsWith('/')) return false;

    const parts = t.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case 'play':
        if (!args) {
          showChipMessage('error', '⚠️ Usage: `/play <song title or URL>`');
          return true;
        }
        handlePlay(args);
        return true;
      case 'pause':
        socket.emit('music-pause', { roomCode });
        if (ytPlayer && playerReady) ytPlayer.pauseVideo();
        return true;
      case 'resume':
        socket.emit('music-resume', { roomCode });
        if (ytPlayer && playerReady) ytPlayer.playVideo();
        return true;
      case 'skip':
        socket.emit('music-skip', { roomCode });
        return true;
      case 'stop':
        socket.emit('music-stop', { roomCode });
        if (ytPlayer && playerReady) ytPlayer.stopVideo();
        hidePlayer();
        showChipMessage('stopped', null);
        return true;
      case 'queue':
      case 'q':
        showQueueCard();
        return true;
      case 'volume':
      case 'vol': {
        const vol = parseInt(args, 10);
        if (isNaN(vol) || vol < 0 || vol > 100) {
          showChipMessage('error', '⚠️ Usage: `/volume 0-100`');
        } else {
          socket.emit('music-volume', { roomCode, volume: vol });
          if (ytPlayer && playerReady) ytPlayer.setVolume(vol);
          showChipMessage('info', `🔊 Volume set to **${vol}%**`);
        }
        return true;
      }
      case 'nowplaying':
      case 'np':
        if (currentState.track) {
          renderNowPlayingCard(currentState, true);
        } else {
          showChipMessage('info', '📭 Nothing is playing right now. Use `/play <song>` to start.');
        }
        return true;
      default:
        return false;
    }
  }

  // ── PLAY HANDLER ────────────────────────────────────────────
  async function handlePlay(query) {
    const userName = window.API?.user()?.name
      || (sessionStorage.getItem('sr_guest') && JSON.parse(sessionStorage.getItem('sr_guest'))?.name)
      || 'Someone';

    // ── Single toast — updates from "Searching" → "Playing" ──
    showToast(`🔍 Searching for "${query}"…`, 6000);

    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();

      if (!data || !data.videoId) {
        showToast(`⚠️ No results found for "${query}"`);
        return;
      }

      const track = {
        videoId:     data.videoId,
        title:       data.title,
        artist:      data.channel || 'YouTube',
        duration:    data.duration || 0,
        thumbnail:   data.thumbnail || null,
        url:         `https://www.youtube.com/watch?v=${data.videoId}`,
        requestedBy: userName,
        id:          Date.now().toString(),
      };

      socket.emit('music-play', { roomCode, track });

    } catch (err) {
      console.error('Music search error:', err);
      showChipMessage('error', '⚠️ Could not search YouTube. Check your API key or network.');
    }
  }

  // ── SOCKET HANDLERS ─────────────────────────────────────────
  function onSync(state) {
    currentState = state;
    localElapsed = state.elapsed || 0;

    clearInterval(progressInterval);
    if (state.playing) {
      progressInterval = setInterval(tickProgress, 1000);
      // If we have a track and the player is idle, load + seek
      if (state.track && state.track.videoId) {
        const playerState = ytPlayer && playerReady ? ytPlayer.getPlayerState() : -1;
        // -1=unstarted, 0=ended, 5=video cued
        if (playerState <= 0 || playerState === 5) {
          playTrackNow(state.track, state.elapsed || 0);
        }
      }
    } else {
      // Paused state
      if (ytPlayer && playerReady) {
        const ps = ytPlayer.getPlayerState();
        if (ps === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
      }
    }

    updateOpenProgressBar();
  }

  function onNowPlaying({ track }) {
    currentState.track = track;
    currentState.playing = true;
    localElapsed = 0;
    clearInterval(progressInterval);
    progressInterval = setInterval(tickProgress, 1000);

    // Update the single toast to show what's now playing
    showToast(`▶ Playing: ${track.title}`, 3500);

    // Start audio playback
    playTrackNow(track, 0);
    // Render the Now Playing card in chat (rich UI, not a duplicate toast)
    renderNowPlayingCard(currentState, false);
  }

  function onQueued({ track, queuePosition, addedBy }) {
    renderQueuedCard(track, queuePosition, addedBy);
  }

  function onEnded() {
    currentState.playing = false;
    currentState.track = null;
    clearInterval(progressInterval);
    hidePlayer();
    showChipMessage('info', '✅ Queue finished! Use `/play <song>` to add more tracks.');
  }

  // ── PROGRESS TICK ───────────────────────────────────────────
  function tickProgress() {
    if (!currentState.playing) return;
    localElapsed++;
    updateOpenProgressBar();

    if (currentState.track && currentState.track.duration > 0) {
      if (localElapsed >= currentState.track.duration) {
        socket.emit('music-track-ended', { roomCode });
        clearInterval(progressInterval);
      }
    }
  }

  function updateOpenProgressBar() {
    const fill = document.querySelector('.chip-progress-fill');
    const timeEl = document.querySelector('.chip-elapsed-time');
    if (fill && currentState.track) {
      const pct = Math.min((localElapsed / currentState.track.duration) * 100, 100);
      fill.style.width = pct + '%';
    }
    if (timeEl) {
      timeEl.textContent = fmtTime(localElapsed);
    }
  }

  // ── RENDER: NOW PLAYING CARD ─────────────────────────────────
  function renderNowPlayingCard(state, isNpCommand) {
    const track = state.track;
    if (!track) return;

    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    // Remove old card
    const old = document.getElementById('chip-now-playing');
    if (old) old.remove();

    const card = document.createElement('div');
    card.className = 'chip-msg';
    card.id = 'chip-now-playing';

    const elapsed = state.elapsed || 0;
    localElapsed = elapsed;
    const pct = track.duration > 0 ? Math.min((elapsed / track.duration) * 100, 100) : 0;

    card.innerHTML = `
      <div class="chip-avatar">🎵</div>
      <div class="chip-body">
        <div class="chip-header">
          <span class="chip-name">Chip</span>
          <span class="chip-badge">APP</span>
          <span class="chip-time">${nowTime()}</span>
        </div>
        <div class="chip-card chip-card-playing">
          <div class="chip-card-top">
            <div class="chip-thumb">
              ${track.thumbnail ? `<img src="${escHtml(track.thumbnail)}" alt="thumb"/>` : '🎵'}
            </div>
            <div class="chip-info">
              <div class="chip-status-label">▶ Now Playing</div>
              <div class="chip-track-title" title="${escHtml(track.title)}">${escHtml(track.title)}</div>
              <div class="chip-track-artist">${escHtml(track.artist)}</div>
              <div class="chip-duration"><span class="chip-elapsed-time">${fmtTime(elapsed)}</span> / ${fmtTime(track.duration)}</div>
            </div>
          </div>
          <div class="chip-progress-wrap">
            <div class="chip-progress-bar" onclick="MusicBot.seekTo(event, this, ${track.duration})">
              <div class="chip-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="chip-progress-times">
              <span class="chip-elapsed-time">${fmtTime(elapsed)}</span>
              <span>${fmtTime(track.duration)}</span>
            </div>
          </div>
          <div class="chip-controls">
            <button class="chip-ctrl-btn primary" onclick="MusicBot.ctrlTogglePlay(this)">
              ${state.playing ? '⏸ Pause' : '▶ Resume'}
            </button>
            <button class="chip-ctrl-btn" onclick="MusicBot.ctrlSkip()">⏭ Skip</button>
            <button class="chip-ctrl-btn danger" onclick="MusicBot.ctrlStop()">⏹</button>
          </div>
          <div class="chip-volume-row">
            <span>🔊</span>
            <input type="range" class="chip-volume-slider" min="0" max="100" value="80"
              oninput="MusicBot.onVolumeSlider(this.value)" id="chip-vol-slider"/>
            <span id="chip-vol-val">80%</span>
          </div>
          <div class="chip-footer">
            Requested by <strong>${escHtml(track.requestedBy || 'Unknown')}</strong>
            &nbsp;·&nbsp; <a onclick="MusicBot.showQueueCard()">View queue (${state.queue.length})</a>
            ${track.videoId ? `&nbsp;·&nbsp; <a href="https://youtu.be/${track.videoId}" target="_blank" rel="noopener">Open in YouTube ↗</a>` : ''}
          </div>
        </div>
      </div>
    `;

    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── RENDER: QUEUED CARD ──────────────────────────────────────
  function renderQueuedCard(track, position, addedBy) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    const card = document.createElement('div');
    card.className = 'chip-msg';
    card.innerHTML = `
      <div class="chip-avatar">🎵</div>
      <div class="chip-body">
        <div class="chip-header">
          <span class="chip-name">Chip</span>
          <span class="chip-badge">APP</span>
          <span class="chip-time">${nowTime()}</span>
        </div>
        <div class="chip-card chip-card-queued">
          <div class="chip-card-top">
            <div class="chip-thumb">
              ${track.thumbnail ? `<img src="${escHtml(track.thumbnail)}" alt="thumb"/>` : '🎵'}
            </div>
            <div class="chip-info">
              <div class="chip-status-label">Queued at position #${position}</div>
              <div class="chip-track-title" title="${escHtml(track.title)}">${escHtml(track.title)}</div>
              <div class="chip-track-artist">${escHtml(track.artist)}</div>
              <div class="chip-duration">${fmtTime(track.duration)}</div>
            </div>
          </div>
          <div class="chip-footer">
            Added by <strong>${escHtml(addedBy || 'Unknown')}</strong>
          </div>
        </div>
      </div>
    `;
    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── RENDER: QUEUE LIST CARD ──────────────────────────────────
  function showQueueCard() {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    if (!currentState.queue.length) {
      showChipMessage('info', '📭 The queue is empty. Use `/play <song>` to add tracks.');
      return;
    }

    const qItems = currentState.queue.slice(currentState.currentIndex).map((t, i) => `
      <div class="chip-queue-item">
        <span class="chip-queue-num">${i === 0 ? '▶' : '#' + (i + 1)}</span>
        <span class="chip-queue-title">${escHtml(t.title)}</span>
        <span class="chip-queue-dur">${fmtTime(t.duration)}</span>
      </div>
    `).join('');

    const card = document.createElement('div');
    card.className = 'chip-msg';
    card.innerHTML = `
      <div class="chip-avatar">🎵</div>
      <div class="chip-body">
        <div class="chip-header">
          <span class="chip-name">Chip</span>
          <span class="chip-badge">APP</span>
          <span class="chip-time">${nowTime()}</span>
        </div>
        <div class="chip-card">
          <div class="chip-status-label" style="color:var(--text2);margin-bottom:8px">
            🎶 Queue — ${currentState.queue.length - currentState.currentIndex} track(s)
          </div>
          <div class="chip-queue-list">${qItems}</div>
        </div>
      </div>
    `;
    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── RENDER: SIMPLE INFO/ERROR MESSAGE ───────────────────────
  function showChipMessage(type, text) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    const colors = { error: '#FF4757', info: '#5865F2', stopped: 'var(--hint)' };
    const color = colors[type] || '#5865F2';

    const div = document.createElement('div');
    div.className = 'chip-msg';
    div.innerHTML = `
      <div class="chip-avatar">🎵</div>
      <div class="chip-body">
        <div class="chip-header">
          <span class="chip-name">Chip</span>
          <span class="chip-badge">APP</span>
          <span class="chip-time">${nowTime()}</span>
        </div>
        <div class="chip-card" style="border-left-color:${color}">
          <div style="font-size:13px;color:var(--text2)">${text || '⏹ Music stopped.'}</div>
        </div>
      </div>
    `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── CONTROL BUTTON HANDLERS ──────────────────────────────────
  function ctrlTogglePlay(btn) {
    if (currentState.playing) {
      socket.emit('music-pause', { roomCode });
      if (ytPlayer && playerReady) ytPlayer.pauseVideo();
      btn.textContent = '▶ Resume';
    } else {
      socket.emit('music-resume', { roomCode });
      if (ytPlayer && playerReady) ytPlayer.playVideo();
      btn.textContent = '⏸ Pause';
    }
  }

  function ctrlSkip() {
    socket.emit('music-skip', { roomCode });
  }

  function ctrlStop() {
    socket.emit('music-stop', { roomCode });
    if (ytPlayer && playerReady) ytPlayer.stopVideo();
    hidePlayer();
  }

  function onVolumeSlider(val) {
    const el = document.getElementById('chip-vol-val');
    if (el) el.textContent = val + '%';
    socket.emit('music-volume', { roomCode, volume: parseInt(val, 10) });
    if (ytPlayer && playerReady) ytPlayer.setVolume(parseInt(val, 10));
  }

  function updateVolumeUI(volume) {
    const slider = document.getElementById('chip-vol-slider');
    const label = document.getElementById('chip-vol-val');
    if (slider) slider.value = volume;
    if (label) label.textContent = volume + '%';
  }

  function seekTo(e, barEl, duration) {
    const rect = barEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekSec = Math.floor(pct * duration);
    localElapsed = seekSec;
    updateOpenProgressBar();
    if (ytPlayer && playerReady) ytPlayer.seekTo(seekSec, true);
  }

  // ── HELPERS ─────────────────────────────────────────────────
  function fmtTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Public API
  return { init, parseCommand, ctrlTogglePlay, ctrlSkip, ctrlStop, onVolumeSlider, showQueueCard, seekTo };
})();