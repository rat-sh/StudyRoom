/* ── TIMER SOCKET FEATURE ─────────────────────────────────────────────────
   Shared timer with sync, start, stop, and per-room state.
──────────────────────────────────────────────────────────────────────────── */

const log = process.env.NODE_ENV !== 'production' ? console.log : () => {};

export default function timerHandler(io, rooms, timers) {
  io.on('connection', (socket) => {

    socket.on('timer-start', ({ roomCode, duration }) => {
      if (!roomCode || !duration || duration < 1) return;

      if (timers.has(roomCode)) clearInterval(timers.get(roomCode).interval);
      const endsAt = Date.now() + duration * 1000;
      io.to(roomCode).emit('timer-sync', { endsAt, running: true });

      const interval = setInterval(() => {
        if (Date.now() >= endsAt) {
          clearInterval(interval);
          timers.delete(roomCode);
          io.to(roomCode).emit('timer-done');
          log('[timer] done for room', roomCode);
        }
      }, 1000);

      timers.set(roomCode, { interval, endsAt });
      log('[timer] started for room', roomCode, 'duration', duration);
    });

    socket.on('timer-stop', ({ roomCode }) => {
      if (!roomCode) return;
      if (timers.has(roomCode)) {
        clearInterval(timers.get(roomCode).interval);
        timers.delete(roomCode);
      }
      io.to(roomCode).emit('timer-sync', { running: false });
    });

    socket.on('timer-request', ({ roomCode }) => {
      if (!roomCode) return;
      if (timers.has(roomCode)) {
        socket.emit('timer-sync', { endsAt: timers.get(roomCode).endsAt, running: true });
      }
    });
  });
}
