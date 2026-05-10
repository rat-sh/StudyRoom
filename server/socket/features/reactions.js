export default function(io, rooms) {
  io.on('connection', (socket) => {
    socket.on('raise-hand', ({ roomCode }) => {
      io.to(roomCode).emit('hand-raised', { socketId: socket.id, name: socket.data?.user?.name });
    });
    socket.on('send-reaction', ({ roomCode, emoji }) => {
      io.to(roomCode).emit('reaction', { socketId: socket.id, name: socket.data?.user?.name, emoji });
    });
  });
}
