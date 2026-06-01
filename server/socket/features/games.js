/** In-room games: invite-only sessions + relay for legacy events */

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function gamesHandler(io, rooms) {
  const sudokuState = new Map();
  const roomChessState = new Map();
  /** @type {Map<string, object>} sessionId -> session */
  const gameSessions = new Map();

  function getSudokuRoom(roomCode) {
    if (!sudokuState.has(roomCode)) {
      sudokuState.set(roomCode, { players: new Map(), winner: null });
    }
    return sudokuState.get(roomCode);
  }

  function getRoomChess(roomCode) {
    if (!roomChessState.has(roomCode)) {
      roomChessState.set(roomCode, {
        w: null,
        b: null,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        turn: 'w',
        status: 'waiting',
      });
    }
    return roomChessState.get(roomCode);
  }

  function getSession(sessionId) {
    return gameSessions.get(sessionId);
  }

  function playerRole(session, socketId) {
    if (session.hostSocketId === socketId) return session.hostRole;
    if (session.guestSocketId === socketId) return session.guestRole;
    return null;
  }

  function emitToSession(session, event, payload) {
    const ids = [session.hostSocketId, session.guestSocketId].filter(Boolean);
    ids.forEach((sid) => io.to(sid).emit(event, payload));
  }

  function broadcastSessionInvite(roomCode, payload) {
    io.to(roomCode).emit('game-invite-update', payload);
  }

  function endSession(sessionId, reason = 'ended') {
    const session = gameSessions.get(sessionId);
    if (!session) return;
    session.status = 'ended';
    emitToSession(session, 'game-session-ended', { sessionId, reason });
    gameSessions.delete(sessionId);
  }

  function createSession(roomCode, gameType, hostSocketId, invitedSocketId, hostName) {
    const sessionId = genId();
    const base = {
      sessionId,
      roomCode,
      gameType,
      hostSocketId,
      guestSocketId: null,
      invitedSocketId,
      hostName,
      guestName: null,
      status: 'pending',
      hostRole: 'p1',
      guestRole: 'p2',
      createdAt: Date.now(),
    };

    if (gameType === 'ttt') {
      base.state = { board: Array(9).fill(''), turn: 'X' };
      base.hostRole = 'X';
      base.guestRole = 'O';
    } else if (gameType === 'dab') {
      const S = 4;
      base.state = {
        dabH: Array(S + 1)
          .fill()
          .map(() => Array(S).fill(false)),
        dabV: Array(S)
          .fill()
          .map(() => Array(S + 1).fill(false)),
        dabBoxes: Array(S)
          .fill()
          .map(() => Array(S).fill(0)),
        dabTurn: 1,
        dabScores: { 1: 0, 2: 0 },
      };
      base.hostRole = 1;
      base.guestRole = 2;
    } else if (gameType === 'rps') {
      base.state = { p1Move: null, p2Move: null };
    } else if (gameType === 'bottle') {
      base.state = { players: [], spinning: false, result: null };
    } else if (gameType === 'ludo') {
      base.state = {
        positions: { p1: 0, p2: 0 },
        turn: 1,
        lastRoll: null,
        winner: null,
      };
    } else if (gameType === 'chess') {
      base.state = {};
      base.hostRole = 'w';
      base.guestRole = 'b';
    }

    gameSessions.set(sessionId, base);
    return base;
  }

  function findActiveChessSession(roomCode) {
    for (const s of gameSessions.values()) {
      if (s.roomCode === roomCode && s.gameType === 'chess' && s.status === 'active') return s;
    }
    return null;
  }

  function syncSessionState(session) {
    emitToSession(session, 'game-session-state', {
      sessionId: session.sessionId,
      gameType: session.gameType,
      status: session.status,
      state: session.state,
      hostName: session.hostName,
      guestName: session.guestName,
      hostSocketId: session.hostSocketId,
      guestSocketId: session.guestSocketId,
    });
  }

  io.on('connection', (socket) => {
    // ── Invite-only game sessions ─────────────────────────────────
    socket.on('game-invite', ({ roomCode, gameType, targetSocketId, hostName }) => {
      if (!roomCode || !gameType || !targetSocketId) return;
      if (targetSocketId === socket.id) return;

      const session = createSession(
        roomCode,
        gameType,
        socket.id,
        targetSocketId,
        hostName || socket.data?.user?.name || 'Host'
      );

      io.to(targetSocketId).emit('game-invite-received', {
        sessionId: session.sessionId,
        gameType,
        fromSocketId: socket.id,
        fromName: session.hostName,
        roomCode,
      });

      socket.emit('game-invite-sent', {
        sessionId: session.sessionId,
        gameType,
        targetSocketId,
      });

      broadcastSessionInvite(roomCode, {
        type: 'pending',
        sessionId: session.sessionId,
        gameType,
        hostName: session.hostName,
      });
    });

    socket.on('game-invite-respond', ({ sessionId, accept }) => {
      const session = getSession(sessionId);
      if (!session || session.status !== 'pending') return;
      if (socket.id !== session.invitedSocketId) return;

      if (!accept) {
        io.to(session.hostSocketId).emit('game-invite-declined', { sessionId });
        gameSessions.delete(sessionId);
        return;
      }

      session.guestSocketId = socket.id;
      session.guestName = socket.data?.user?.name || 'Guest';
      session.status = 'active';

      if (session.gameType === 'chess') {
        const state = getRoomChess(session.roomCode);
        state.w = { socketId: session.hostSocketId, name: session.hostName };
        state.b = { socketId: session.guestSocketId, name: session.guestName };
        state.status = 'active';
        io.to(session.roomCode).emit('room-chess-state', state);
      }

      io.to(session.hostSocketId).emit('game-invite-accepted', {
        sessionId,
        guestName: session.guestName,
        guestSocketId: socket.id,
      });

      syncSessionState(session);
    });

    socket.on('game-session-leave', ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session) return;
      if (socket.id !== session.hostSocketId && socket.id !== session.guestSocketId) return;
      endSession(sessionId, 'left');
    });

    // TTT — server authoritative
    socket.on('game-ttt-move', ({ sessionId, index }) => {
      const session = getSession(sessionId);
      if (!session || session.status !== 'active' || session.gameType !== 'ttt') return;
      const role = playerRole(session, socket.id);
      if (!role || session.state.turn !== role) return;
      if (session.state.board[index]) return;

      session.state.board[index] = role;
      session.state.turn = role === 'X' ? 'O' : 'X';
      syncSessionState(session);
    });

    socket.on('game-ttt-reset', ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session || session.gameType !== 'ttt') return;
      if (socket.id !== session.hostSocketId) return;
      session.state = { board: Array(9).fill(''), turn: 'X' };
      syncSessionState(session);
    });

    // Dots & Boxes
    socket.on('game-dab-move', ({ sessionId, type, r, c }) => {
      const session = getSession(sessionId);
      if (!session || session.status !== 'active' || session.gameType !== 'dab') return;
      const player = playerRole(session, socket.id);
      if (!player || session.state.dabTurn !== player) return;

      const st = session.state;
      if (type === 'h' && st.dabH[r][c]) return;
      if (type === 'v' && st.dabV[r][c]) return;

      if (type === 'h') st.dabH[r][c] = true;
      else st.dabV[r][c] = true;

      const S = 4;
      let scored = false;
      for (let br = 0; br < S; br++) {
        for (let bc = 0; bc < S; bc++) {
          if (
            st.dabBoxes[br][bc] === 0 &&
            st.dabH[br][bc] &&
            st.dabH[br + 1][bc] &&
            st.dabV[br][bc] &&
            st.dabV[br][bc + 1]
          ) {
            st.dabBoxes[br][bc] = player;
            st.dabScores[player]++;
            scored = true;
          }
        }
      }
      if (!scored) st.dabTurn = st.dabTurn === 1 ? 2 : 1;
      syncSessionState(session);
    });

    socket.on('game-dab-reset', ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session || session.gameType !== 'dab') return;
      if (socket.id !== session.hostSocketId) return;
      const S = 4;
      session.state = {
        dabH: Array(S + 1)
          .fill()
          .map(() => Array(S).fill(false)),
        dabV: Array(S)
          .fill()
          .map(() => Array(S + 1).fill(false)),
        dabBoxes: Array(S)
          .fill()
          .map(() => Array(S).fill(0)),
        dabTurn: 1,
        dabScores: { 1: 0, 2: 0 },
      };
      syncSessionState(session);
    });

    // RPS
    socket.on('game-rps-move', ({ sessionId, move }) => {
      const session = getSession(sessionId);
      if (!session || session.status !== 'active' || session.gameType !== 'rps') return;
      const role = playerRole(session, socket.id);
      if (!role) return;
      const key = role === 'p1' ? 'p1Move' : 'p2Move';
      if (session.state[key]) return;
      session.state[key] = move;
      syncSessionState(session);
    });

    socket.on('game-rps-reset', ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session || session.gameType !== 'rps') return;
      session.state = { p1Move: null, p2Move: null };
      syncSessionState(session);
    });

    // Bottle round — host invites; guest can join; others spectate via room
    socket.on('game-bottle-join', ({ sessionId, name }) => {
      const session = getSession(sessionId);
      if (!session || session.gameType !== 'bottle') return;
      if (session.status === 'pending' && socket.id === session.invitedSocketId) {
        session.guestSocketId = socket.id;
        session.guestName = name || socket.data?.user?.name || 'Guest';
        session.status = 'active';
      }
      const st = session.state;
      if (!st.players.find((p) => p.socketId === socket.id)) {
        st.players.push({ socketId: socket.id, name: name || socket.data?.user?.name || 'Player' });
      }
      syncSessionState(session);
    });

    socket.on('game-bottle-spin', ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session || session.gameType !== 'bottle') return;
      if (socket.id !== session.hostSocketId) return;
      const st = session.state;
      if (st.players.length < 2 || st.spinning) return;
      st.spinning = true;
      st.result = null;
      syncSessionState(session);
      const pick = st.players[Math.floor(Math.random() * st.players.length)];
      setTimeout(() => {
        st.spinning = false;
        st.result = pick;
        syncSessionState(session);
      }, 2200);
    });

    // Simple 2-player ludo race
    socket.on('game-ludo-roll', ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session || session.status !== 'active' || session.gameType !== 'ludo') return;
      const player = playerRole(session, socket.id);
      if (!player || session.state.turn !== player || session.state.winner) return;

      const roll = Math.floor(Math.random() * 6) + 1;
      session.state.lastRoll = roll;
      const posKey = player === 1 ? 'p1' : 'p2';
      session.state.positions[posKey] = Math.min(30, session.state.positions[posKey] + roll);
      if (session.state.positions[posKey] >= 30) session.state.winner = player;

      session.state.turn = player === 1 ? 2 : 1;
      syncSessionState(session);
    });

    // ── Legacy relays (no session — backward compat) ──────────────
    socket.on('ttt-move', ({ roomCode, index, player }) => {
      socket.to(roomCode).emit('ttt-move', { index, player });
    });
    socket.on('ttt-reset', ({ roomCode }) => {
      socket.to(roomCode).emit('ttt-reset');
    });
    socket.on('dab-move', ({ roomCode, type, r, c, player }) => {
      socket.to(roomCode).emit('dab-move', { type, r, c, player });
    });
    socket.on('dab-reset', ({ roomCode }) => {
      socket.to(roomCode).emit('dab-reset');
    });
    socket.on('rps-move', ({ roomCode, move, player }) => {
      socket.to(roomCode).emit('rps-move', { move, player });
    });
    socket.on('rps-reset', ({ roomCode }) => {
      socket.to(roomCode).emit('rps-reset');
    });

    // ── Sudoku Race ─────────────────────────────────────────────
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

    socket.on('sudoku-start', ({ roomCode, solution, puzzle }) => {
      const state = getSudokuRoom(roomCode);
      state.solution = solution;
      state.puzzle = puzzle;
      state.winner = null;

      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (!roomSockets) return;

      roomSockets.forEach((sid) => {
        const role = state.players.get(sid) || 'spectator';
        io.to(sid).emit('sudoku-start', { solution, puzzle, role });
      });
    });

    socket.on('sudoku-cell', ({ roomCode, r, c, val }) => {
      socket.to(roomCode).emit('sudoku-cell', { r, c, val });
    });

    socket.on('sudoku-complete', ({ roomCode }) => {
      const state = getSudokuRoom(roomCode);
      if (state.winner) return;
      const myRole = state.players.get(socket.id);
      if (!myRole || myRole === 'spectator') return;
      state.winner = myRole;
      io.to(roomCode).emit('sudoku-winner', { winner: myRole });
    });

    // ── In-Meeting Chess ──────────────────────────────────────────
    socket.on('room-chess-join', ({ roomCode }) => {
      const state = getRoomChess(roomCode);
      socket.emit('room-chess-state', state);
    });

    socket.on('room-chess-slot', ({ roomCode, slot, name }) => {
      const state = getRoomChess(roomCode);
      const invited = findActiveChessSession(roomCode);
      if (invited) {
        if (slot === 'w' && socket.id !== invited.hostSocketId) return;
        if (slot === 'b' && socket.id !== invited.guestSocketId) return;
      }
      if (state[slot]) return;
      if (slot === 'w' && state.b?.socketId === socket.id) state.b = null;
      if (slot === 'b' && state.w?.socketId === socket.id) state.w = null;
      state[slot] = { socketId: socket.id, name: name || socket.data?.user?.name || 'Player' };
      if (state.w && state.b && state.status === 'waiting') state.status = 'active';
      io.to(roomCode).emit('room-chess-state', state);
    });

    socket.on('room-chess-move', ({ roomCode, fen, turn }) => {
      const state = getRoomChess(roomCode);
      state.fen = fen;
      state.turn = turn;
      socket.to(roomCode).emit('room-chess-move', { fen });
    });

    socket.on('room-chess-reset', ({ roomCode }) => {
      const state = getRoomChess(roomCode);
      state.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      state.turn = 'w';
      state.status = state.w && state.b ? 'active' : 'waiting';
      io.to(roomCode).emit('room-chess-state', state);
    });

    socket.on('disconnect', () => {
      sudokuState.forEach((state) => {
        if (state.players.has(socket.id)) state.players.delete(socket.id);
      });

      roomChessState.forEach((state, roomCode) => {
        let changed = false;
        if (state.w?.socketId === socket.id) {
          state.w = null;
          changed = true;
        }
        if (state.b?.socketId === socket.id) {
          state.b = null;
          changed = true;
        }
        if (changed) {
          if (!state.w && !state.b) {
            state.status = 'waiting';
            state.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            state.turn = 'w';
          }
          io.to(roomCode).emit('room-chess-state', state);
        }
      });

      gameSessions.forEach((session, sessionId) => {
        if (
          session.hostSocketId === socket.id ||
          session.guestSocketId === socket.id ||
          session.invitedSocketId === socket.id
        ) {
          endSession(sessionId, 'disconnect');
        }
      });
    });
  });
}
