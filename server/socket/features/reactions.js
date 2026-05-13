/* ── REACTIONS + HAND QUEUE SOCKET FEATURE ───────────────────────────────
   Handles emoji reactions and the raise-hand priority queue.
   Hand queue: toggle raise/lower, persist state, broadcast queue updates.
──────────────────────────────────────────────────────────────────────────── */

const log = process.env.NODE_ENV !== 'production' ? console.log : () => {};

export default function reactionsHandler(io, rooms, handQueues) {
  io.on('connection', (socket) => {

    // ── EMOJI REACTIONS ────────────────────────────────────────────────
    socket.on('send-reaction', ({ roomCode, emoji }) => {
      if (!roomCode || !emoji) return;
      io.to(roomCode).emit('reaction', {
        socketId: socket.id,
        name: socket.data?.user?.name,
        emoji
      });
    });

    // ── RAISE / LOWER HAND ────────────────────────────────────────────
    socket.on('raise-hand', ({ roomCode }) => {
      if (!roomCode) return;

      if (!handQueues.has(roomCode)) handQueues.set(roomCode, []);
      const queue = handQueues.get(roomCode);
      const existing = queue.find(h => h.socketId === socket.id);

      if (existing) {
        // Lower hand — toggle off
        handQueues.set(roomCode, queue.filter(h => h.socketId !== socket.id));
        io.to(roomCode).emit('hand-lowered', { socketId: socket.id });
        log('[reactions] hand lowered by', socket.data?.user?.name);
      } else {
        // Raise hand — add to queue
        queue.push({
          socketId: socket.id,
          name: socket.data?.user?.name || 'Guest',
          raisedAt: Date.now()
        });
        const position = queue.length;
        io.to(roomCode).emit('hand-raised', {
          socketId: socket.id,
          name: socket.data?.user?.name || 'Guest',
          position
        });
        log('[reactions] hand raised by', socket.data?.user?.name, 'pos', position);
      }

      io.to(roomCode).emit('hand-queue-update', handQueues.get(roomCode));
    });

    // ── CLEANUP ON DISCONNECT ─────────────────────────────────────────
    socket.on('disconnect', () => {
      const { roomCode } = socket.data || {};
      if (!roomCode) return;

      const queue = handQueues.get(roomCode);
      if (queue) {
        const had = queue.some(h => h.socketId === socket.id);
        if (had) {
          handQueues.set(roomCode, queue.filter(h => h.socketId !== socket.id));
          io.to(roomCode).emit('hand-lowered', { socketId: socket.id });
          io.to(roomCode).emit('hand-queue-update', handQueues.get(roomCode));
        }
      }
    });
  });
}
