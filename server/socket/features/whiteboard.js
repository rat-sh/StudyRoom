export default function whiteboardHandler(io, rooms) {
  const boardState = new Map(); // roomCode → array of draw ops

  io.on('connection', (socket) => {
    socket.on('whiteboard-draw', ({ roomCode, data }) => {
      if (!roomCode) return;
      if (!boardState.has(roomCode)) boardState.set(roomCode, []);
      boardState.get(roomCode).push(data);
      socket.to(roomCode).emit('whiteboard-draw', { socketId: socket.id, data });
    });

    socket.on('whiteboard-clear', ({ roomCode }) => {
      if (!roomCode) return;
      boardState.set(roomCode, []);
      socket.to(roomCode).emit('whiteboard-clear');
    });

    socket.on('whiteboard-request', ({ roomCode }) => {
      if (!roomCode) return;
      const history = boardState.get(roomCode) || [];
      socket.emit('whiteboard-history', { history });
    });

    // Cleanup on room empty (called from core)
    socket.on('disconnect', () => {
      // boardState cleanup handled by core's cleanupRoom
    });
  });
}
