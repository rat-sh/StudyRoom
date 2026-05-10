const timers = new Map();

export default function(io, rooms) {
  io.on('connection', (socket) => {
    socket.on('timer-start', ({ roomCode, duration }) => {
      if (timers.has(roomCode)) clearInterval(timers.get(roomCode).interval);
      const endsAt = Date.now() + duration * 1000;
      io.to(roomCode).emit('timer-sync', { endsAt, running: true });
      const interval = setInterval(() => {
        if (Date.now() >= endsAt) {
          clearInterval(interval);
          timers.delete(roomCode);
          io.to(roomCode).emit('timer-done');
        }
      }, 1000);
      timers.set(roomCode, { interval, endsAt });
    });
    socket.on('timer-stop', ({ roomCode }) => {
      if (timers.has(roomCode)) { clearInterval(timers.get(roomCode).interval); timers.delete(roomCode); }
      io.to(roomCode).emit('timer-sync', { running: false });
    });
    socket.on('timer-request', ({ roomCode }) => {
      if (timers.has(roomCode)) socket.emit('timer-sync', { endsAt: timers.get(roomCode).endsAt, running: true });
    });
  });
}
