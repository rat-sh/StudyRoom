export default function gamesHandler(io, rooms) {
  // Per-room Sudoku race state
  // sudokuState[roomCode] = { players: Map<socketId, 'p1'|'p2'>, solution, puzzle, winner }
  const sudokuState = new Map();

  function getSudokuRoom(roomCode) {
    if (!sudokuState.has(roomCode)) {
      sudokuState.set(roomCode, { players: new Map(), winner: null });
    }
    return sudokuState.get(roomCode);
  }

  io.on('connection', (socket) => {

    // ── Tic Tac Toe ────────────────────────────────────────────────
    socket.on('ttt-move', ({ roomCode, index, player }) => {
      socket.to(roomCode).emit('ttt-move', { index, player });
    });
    socket.on('ttt-reset', ({ roomCode }) => {
      socket.to(roomCode).emit('ttt-reset');
    });

    // ── Dots and Boxes ─────────────────────────────────────────────
    socket.on('dab-move', ({ roomCode, type, r, c, player }) => {
      socket.to(roomCode).emit('dab-move', { type, r, c, player });
    });
    socket.on('dab-reset', ({ roomCode }) => {
      socket.to(roomCode).emit('dab-reset');
    });

    // ── Rock Paper Scissors ────────────────────────────────────────
    socket.on('rps-move', ({ roomCode, move, player }) => {
      socket.to(roomCode).emit('rps-move', { move, player });
    });
    socket.on('rps-reset', ({ roomCode }) => {
      socket.to(roomCode).emit('rps-reset');
    });

    // ── Sudoku Race ────────────────────────────────────────────────

    // Client joins the Sudoku tab — assign player slot or spectator
    socket.on('sudoku-join', ({ roomCode }) => {
      const state = getSudokuRoom(roomCode);
      let role = 'spectator';
      if (!state.players.has(socket.id)) {
        const slots = [...state.players.values()];
        if (!slots.includes('p1')) role = 'p1';
        else if (!slots.includes('p2')) role = 'p2';
        state.players.set(socket.id, role);
      } else {
        role = state.players.get(socket.id);
      }
      socket.emit('sudoku-role', { role });
    });

    // Host emits start with a generated board — broadcast to all with per-client roles
    socket.on('sudoku-start', ({ roomCode, solution, puzzle }) => {
      const state = getSudokuRoom(roomCode);
      state.solution = solution;
      state.puzzle = puzzle;
      state.winner = null;

      // Broadcast to every socket in the room, each gets their role
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (!roomSockets) return;

      roomSockets.forEach(sid => {
        const role = state.players.get(sid) || 'spectator';
        io.to(sid).emit('sudoku-start', { solution, puzzle, role });
      });
    });

    // Player fills a cell — relay to everyone EXCEPT the sender
    socket.on('sudoku-cell', ({ roomCode, r, c, val }) => {
      socket.to(roomCode).emit('sudoku-cell', { r, c, val });
    });

    // Player claims completion — validate on server, broadcast winner
    socket.on('sudoku-complete', ({ roomCode }) => {
      const state = getSudokuRoom(roomCode);
      if (state.winner) return; // already decided

      const myRole = state.players.get(socket.id);
      if (!myRole || myRole === 'spectator') return;

      state.winner = myRole;
      io.to(roomCode).emit('sudoku-winner', { winner: myRole });
    });

    // On disconnect — free up the player slot
    socket.on('disconnect', () => {
      sudokuState.forEach((state, roomCode) => {
        if (state.players.has(socket.id)) {
          state.players.delete(socket.id);
        }
      });
    });

  });
}
