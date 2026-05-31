export default function gamesHandler(io, rooms) {
  // Per-room Sudoku race state
  // sudokuState[roomCode] = { players: Map<socketId, 'p1'|'p2'>, solution, puzzle, winner }
  const sudokuState = new Map();

  // Per-room Chess state
  const roomChessState = new Map();

  function getSudokuRoom(roomCode) {
    if (!sudokuState.has(roomCode)) {
      sudokuState.set(roomCode, { players: new Map(), winner: null });
    }
    return sudokuState.get(roomCode);
  }

  function getRoomChess(roomCode) {
    if (!roomChessState.has(roomCode)) {
      roomChessState.set(roomCode, { w: null, b: null, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', turn: 'w', status: 'waiting' });
    }
    return roomChessState.get(roomCode);
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
      roomChessState.forEach((state, roomCode) => {
        let changed = false;
        if (state.w?.socketId === socket.id) { state.w = null; changed = true; }
        if (state.b?.socketId === socket.id) { state.b = null; changed = true; }
        if (changed) {
          if (!state.w && !state.b) {
            state.status = 'waiting';
            state.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            state.turn = 'w';
          }
          io.to(roomCode).emit('room-chess-state', state);
        }
      });
    });

    // ── In-Meeting Chess ───────────────────────────────────────────
    socket.on('room-chess-join', ({ roomCode }) => {
      const state = getRoomChess(roomCode);
      socket.emit('room-chess-state', state);
    });

    socket.on('room-chess-slot', ({ roomCode, slot, name }) => {
      const state = getRoomChess(roomCode);
      if (state[slot]) return; // already taken
      
      // Remove from other slot if switching
      if (slot === 'w' && state.b?.socketId === socket.id) state.b = null;
      if (slot === 'b' && state.w?.socketId === socket.id) state.w = null;
      
      state[slot] = { socketId: socket.id, name };
      
      if (state.w && state.b && state.status === 'waiting') {
        state.status = 'active';
      }
      
      io.to(roomCode).emit('room-chess-state', state);
    });

    socket.on('room-chess-move', ({ roomCode, from, to, promotion, fen, turn }) => {
      const state = getRoomChess(roomCode);
      state.fen = fen;
      state.turn = turn;
      socket.to(roomCode).emit('room-chess-move', { from, to, promotion, fen, turn });
    });

    socket.on('room-chess-reset', ({ roomCode }) => {
      const state = getRoomChess(roomCode);
      state.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      state.turn = 'w';
      state.status = (state.w && state.b) ? 'active' : 'waiting';
      io.to(roomCode).emit('room-chess-state', state);
    });

  });
}
