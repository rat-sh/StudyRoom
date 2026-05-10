export default function(io, rooms) {
  io.on('connection', (socket) => {
    socket.on('whiteboard-draw', ({ roomCode, data }) => {
      socket.to(roomCode).emit('whiteboard-draw', { socketId: socket.id, data });
    });
    socket.on('whiteboard-clear', ({ roomCode }) => {
      socket.to(roomCode).emit('whiteboard-clear');
    });
  });
}
