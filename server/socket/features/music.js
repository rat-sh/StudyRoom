
const musicState = new Map();
// Structure: { queue: [], currentIndex: 0, playing: false, startedAt: null, pausedAt: null, pausedOffset: 0, track: null }

export default function(io, rooms) {
  io.on('connection', (socket) => {

    // When a user joins a room, send them the current music state
    socket.on('music-state-request', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (state) {
        const syncPayload = buildSyncPayload(state);
        socket.emit('music-sync', syncPayload);
      }
    });

    // Play a track (adds to queue or plays immediately)
    socket.on('music-play', ({ roomCode, track }) => {
      // track: { title, artist, duration, thumbnail, url, requestedBy }
      let state = musicState.get(roomCode);
      if (!state) {
        state = { queue: [], currentIndex: 0, playing: false, startedAt: null, pausedAt: null, pausedOffset: 0, track: null };
        musicState.set(roomCode, state);
      }

      if (!state.playing && state.queue.length === 0) {
        // Play immediately
        state.track = track;
        state.queue = [track];
        state.currentIndex = 0;
        state.playing = true;
        state.startedAt = Date.now();
        state.pausedAt = null;
        state.pausedOffset = 0;
        io.to(roomCode).emit('music-now-playing', { track, queuePosition: 1 });
      } else {
        // Add to queue
        state.queue.push(track);
        const pos = state.queue.length;
        io.to(roomCode).emit('music-queued', { track, queuePosition: pos, addedBy: track.requestedBy });
      }
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Pause
    socket.on('music-pause', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state || !state.playing) return;
      state.playing = false;
      state.pausedAt = Date.now();
      // Save how far we are into the track
      if (state.startedAt) {
        state.pausedOffset = Math.floor((state.pausedAt - state.startedAt) / 1000);
      }
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Resume — resumes from exact paused position
    socket.on('music-resume', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state || state.playing) return;
      state.playing = true;
      // Recalculate startedAt so elapsed = pausedOffset
      state.startedAt = Date.now() - (state.pausedOffset * 1000);
      state.pausedAt = null;
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Skip
    socket.on('music-skip', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state) return;
      advanceQueue(state);
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
      if (state.track) {
        io.to(roomCode).emit('music-now-playing', { track: state.track, queuePosition: state.currentIndex + 1 });
      } else {
        io.to(roomCode).emit('music-ended');
      }
    });

    // Stop / clear queue
    socket.on('music-stop', ({ roomCode }) => {
      musicState.set(roomCode, { queue: [], currentIndex: 0, playing: false, startedAt: null, pausedAt: null, pausedOffset: 0, track: null });
      io.to(roomCode).emit('music-sync', buildSyncPayload(musicState.get(roomCode)));
    });

    // Volume (broadcast only, not persisted)
    socket.on('music-volume', ({ roomCode, volume }) => {
      socket.to(roomCode).emit('music-volume', { volume });
    });

    // Track ended naturally (client tells server)
    socket.on('music-track-ended', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state) return;
      advanceQueue(state);
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
      if (state.track) {
        io.to(roomCode).emit('music-now-playing', { track: state.track, queuePosition: state.currentIndex + 1 });
      } else {
        io.to(roomCode).emit('music-ended');
      }
    });
  });
}

function advanceQueue(state) {
  state.currentIndex++;
  if (state.currentIndex < state.queue.length) {
    state.track = state.queue[state.currentIndex];
    state.playing = true;
    state.startedAt = Date.now();
    state.pausedOffset = 0;
    state.pausedAt = null;
  } else {
    state.track = null;
    state.playing = false;
    state.startedAt = null;
    state.pausedOffset = 0;
    state.pausedAt = null;
  }
}

function buildSyncPayload(state) {
  let elapsed = 0;
  if (state.playing && state.startedAt) {
    elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  } else if (!state.playing && state.pausedOffset > 0) {
    elapsed = state.pausedOffset;
  }
  return {
    playing: state.playing,
    track: state.track,
    queue: state.queue,
    currentIndex: state.currentIndex,
    elapsed,          // seconds into current track
    pausedOffset: state.pausedOffset,
    startedAt: state.startedAt,
  };
}