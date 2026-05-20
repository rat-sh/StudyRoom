/** roomCode -> Map<socketId, { at, name }> */
const roomHands = new Map();

function getHands(roomCode) {
  if (!roomHands.has(roomCode)) roomHands.set(roomCode, new Map());
  return roomHands.get(roomCode);
}

function broadcastHands(io, roomCode) {
  const hands = [...getHands(roomCode).entries()]
    .sort((a, b) => a[1].at - b[1].at)
    .map(([socketId, h]) => ({ socketId, name: h.name, at: h.at }));
  io.to(roomCode).emit('hands-updated', { hands });
}

export default function(io, rooms) {
  io.on('connection', (socket) => {
    socket.on('raise-hand', ({ roomCode, active }) => {
      if (!roomCode) return;
      const hands = getHands(roomCode);
      if (active) {
        hands.set(socket.id, { at: Date.now(), name: socket.data?.user?.name || 'Guest' });
        io.to(roomCode).emit('hand-raised', { socketId: socket.id, name: socket.data?.user?.name, active: true });
      } else {
        hands.delete(socket.id);
        io.to(roomCode).emit('hand-raised', { socketId: socket.id, name: socket.data?.user?.name, active: false });
      }
      broadcastHands(io, roomCode);
    });

    socket.on('send-reaction', ({ roomCode, emoji }) => {
      io.to(roomCode).emit('reaction', { socketId: socket.id, name: socket.data?.user?.name, emoji });
    });

    socket.on('disconnect', () => {
      const roomCode = socket.data?.roomCode;
      if (roomCode && roomHands.has(roomCode)) {
        getHands(roomCode).delete(socket.id);
        broadcastHands(io, roomCode);
      }
    });
  });
}
