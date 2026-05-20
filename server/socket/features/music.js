
const musicState = new Map();
// Structure: { queue: [], currentIndex: 0, playing: false, startedAt: null, pausedAt: null, pausedOffset: 0, track: null, mode: 'collaborative', skipVotes: new Set() }

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

    // Toggle Mode
    socket.on('music-mode-toggle', ({ roomCode, mode, isHost }) => {
      const state = musicState.get(roomCode);
      if (!state || !isHost) return;
      state.mode = mode; // 'collaborative' or 'host-only'
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Play a track (adds to queue or plays immediately)
    socket.on('music-play', ({ roomCode, track }) => {
      // track: { title, artist, duration, thumbnail, url, requestedBy, id (unique) }
      let state = musicState.get(roomCode);
      if (!state) {
        state = { queue: [], currentIndex: 0, playing: false, startedAt: null, pausedAt: null, pausedOffset: 0, track: null, mode: 'collaborative', skipVotes: new Set() };
        musicState.set(roomCode, state);
      }
      
      // Enforce host-only
      // if (state.mode === 'host-only' && !isHost) return socket.emit('music-error', 'Host-only mode enabled');

      // Generate unique queue ID if not present
      if (!track.qid) track.qid = Math.random().toString(36).substring(2, 10);

      if (!state.playing && state.queue.length === 0) {
        // Play immediately
        state.track = track;
        state.queue = [track];
        state.currentIndex = 0;
        state.playing = true;
        state.startedAt = Date.now();
        state.pausedAt = null;
        state.pausedOffset = 0;
        state.skipVotes.clear();
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

    // Resume
    socket.on('music-resume', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state || state.playing) return;
      state.playing = true;
      state.startedAt = Date.now() - (state.pausedOffset * 1000);
      state.pausedAt = null;
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Vote to Skip / Force Skip
    socket.on('music-skip', ({ roomCode, userId, isHost }) => {
      const state = musicState.get(roomCode);
      if (!state || !state.track) return;
      
      if (isHost || state.mode === 'collaborative') {
        state.skipVotes.add(userId);
        // If host skips, or if enough votes (let's say 2 for now, or just force for simplicity)
        if (isHost || state.skipVotes.size >= 1) { // Temporary simple skip
          advanceQueue(state);
          io.to(roomCode).emit('music-sync', buildSyncPayload(state));
          if (state.track) {
            io.to(roomCode).emit('music-now-playing', { track: state.track, queuePosition: state.currentIndex + 1 });
          } else {
            io.to(roomCode).emit('music-ended');
          }
        } else {
           io.to(roomCode).emit('music-sync', buildSyncPayload(state)); // update votes
        }
      }
    });

    // Reorder Queue
    socket.on('music-reorder', ({ roomCode, fromIndex, toIndex }) => {
      const state = musicState.get(roomCode);
      if (!state || state.queue.length <= 1) return;
      
      // You can't reorder past tracks or the currently playing track
      if (fromIndex <= state.currentIndex || toIndex <= state.currentIndex) return;
      
      const [movedItem] = state.queue.splice(fromIndex, 1);
      state.queue.splice(toIndex, 0, movedItem);
      
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Remove from queue
    socket.on('music-remove', ({ roomCode, index }) => {
      const state = musicState.get(roomCode);
      if (!state || index <= state.currentIndex || index >= state.queue.length) return;
      state.queue.splice(index, 1);
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Flush / wipe queue
    socket.on('music-flush', ({ roomCode }) => {
      const state = musicState.get(roomCode);
      if (!state) return;
      // Keep only current and history, drop everything upcoming
      if (state.currentIndex + 1 < state.queue.length) {
         state.queue.splice(state.currentIndex + 1);
      }
      io.to(roomCode).emit('music-sync', buildSyncPayload(state));
    });

    // Stop / clear queue entirely
    socket.on('music-stop', ({ roomCode }) => {
      musicState.set(roomCode, { queue: [], currentIndex: 0, playing: false, startedAt: null, pausedAt: null, pausedOffset: 0, track: null, mode: 'collaborative', skipVotes: new Set() });
      io.to(roomCode).emit('music-sync', buildSyncPayload(musicState.get(roomCode)));
    });

    // Volume
    socket.on('music-volume', ({ roomCode, volume }) => {
      socket.to(roomCode).emit('music-volume', { volume });
    });

    // Track ended naturally
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
  state.skipVotes.clear();
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
  const now = Date.now();
  if (state.playing && state.startedAt) {
    elapsed = (now - state.startedAt) / 1000; // Float for precision
  } else if (!state.playing && state.pausedOffset > 0) {
    elapsed = state.pausedOffset;
  }
  return {
    playing: state.playing,
    track: state.track,
    queue: state.queue,
    currentIndex: state.currentIndex,
    elapsed,
    pausedOffset: state.pausedOffset,
    startedAt: state.startedAt,
    serverTime: now, // Critical for latency compensation
    mode: state.mode,
    skipVotes: Array.from(state.skipVotes)
  };
}