/* ── MUSIC SOCKET FEATURE ─────────────────────────────────────────────────
   Handles music queue, playback state, sync, and auto-advance.
   State is per-room in-memory. Late joiners get full sync with elapsed time.
──────────────────────────────────────────────────────────────────────────── */

const log = process.env.NODE_ENV !== 'production' ? console.log : () => {};

function buildSyncPayload(state) {
  if (!state) return { playing: false, track: null, queue: [], elapsed: 0 };
  const elapsed = state.playing && state.startedAt
    ? (Date.now() - state.startedAt) / 1000 + (state.pausedOffset || 0)
    : (state.pausedOffset || 0);
  return {
    playing: state.playing,
    track: state.track,
    queue: state.queue,
    currentIndex: state.currentIndex,
    elapsed
  };
}

function advanceQueue(io, roomCode, musicState) {
  const state = musicState.get(roomCode);
  if (!state) return;

  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.queue.length) {
    // Queue exhausted
    state.track = null;
    state.playing = false;
    state.startedAt = null;
    state.pausedOffset = 0;
    io.to(roomCode).emit('music-ended');
    io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    log('[music] queue ended for room', roomCode);
    return;
  }

  state.currentIndex = nextIndex;
  state.track = state.queue[nextIndex];
  state.playing = true;
  state.startedAt = Date.now();
  state.pausedOffset = 0;
  io.to(roomCode).emit('music-now-playing', {
    track: state.track,
    queuePosition: nextIndex + 1
  });
  io.to(roomCode).emit('music-sync', buildSyncPayload(state));
  log('[music] advancing to track', nextIndex, 'in room', roomCode);
}

export default function musicHandler(io, rooms, musicState) {
  io.on('connection', (socket) => {

    // ── PLAY / ADD TO QUEUE ────────────────────────────────────────────
    socket.on('music-play', ({ roomCode, track }) => {
      if (!roomCode || !track?.videoId) return;

      if (!musicState.has(roomCode)) {
        musicState.set(roomCode, {
          queue: [],
          currentIndex: 0,
          playing: false,
          startedAt: null,
          pausedOffset: 0,
          track: null
        });
      }
      const state = musicState.get(roomCode);
      state.queue.push(track);

      if (!state.track) {
        // Nothing playing — start immediately
        state.track = track;
        state.currentIndex = state.queue.length - 1;
        state.playing = true;
        state.startedAt = Date.now();
        state.pausedOffset = 0;
        io.to(roomCode).emit('music-now-playing', {
          track,
          queuePosition: state.queue.length
        });
      } else {
        // Already playing or paused — add to queue
        io.to(roomCode).emit('music-queued', {
          track,
          queuePosition: state.queue.length,
          addedBy: track.requestedBy
        });
      }
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // ── PAUSE / RESUME ─────────────────────────────────────────────────
    socket.on('music-pause', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state || !state.playing) return;
      state.pausedOffset = (Date.now() - state.startedAt) / 1000 + (state.pausedOffset || 0);
      state.playing = false;
      state.startedAt = null;
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    socket.on('music-resume', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state || state.playing || !state.track) return;
      state.playing = true;
      state.startedAt = Date.now();
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // ── SKIP ──────────────────────────────────────────────────────────
    socket.on('music-skip', ({ roomCode }) => {
      advanceQueue(io, roomCode, musicState);
    });

    // ── TRACK ENDED (client reports playback finished) ────────────────
    socket.on('music-track-ended', ({ roomCode }) => {
      advanceQueue(io, roomCode, musicState);
    });

    // ── SYNC REQUEST (late joiner) ────────────────────────────────────
    socket.on('music-sync-request', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      socket.emit('music-sync', buildSyncPayload(state));
    });
  });
}
