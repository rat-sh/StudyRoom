/** Online chess PVP — match rooms by gameId */
const chessGames = new Map();

function genGameId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function getGame(gameId) {
  const id = (gameId || '').toUpperCase();
  return chessGames.get(id) || null;
}

export default function chessHandler(io) {
  io.on('connection', (socket) => {

    socket.on('chess-create', ({ name, userId }) => {
      let gameId = genGameId();
      while (chessGames.has(gameId)) gameId = genGameId();
      const game = {
        id: gameId,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        white: { socketId: socket.id, name: name || 'Player 1', userId: userId || null },
        black: null,
        turn: 'w',
        status: 'waiting',
        chat: [],
      };
      chessGames.set(gameId, game);
      socket.join(`chess:${gameId}`);
      socket.data.chessGameId = gameId;
      socket.emit('chess-created', { gameId, color: 'w', game: publicGameState(game) });
    });

    socket.on('chess-join', ({ gameId, name, userId }) => {
      const game = getGame(gameId);
      if (!game) return socket.emit('chess-error', { error: 'Game not found' });
      if (game.black) return socket.emit('chess-error', { error: 'Game is full' });
      if (game.white.socketId === socket.id) {
        socket.join(`chess:${game.id}`);
        return socket.emit('chess-joined', { gameId: game.id, color: 'w', game: publicGameState(game) });
      }
      game.black = { socketId: socket.id, name: name || 'Player 2', userId: userId || null };
      game.status = 'active';
      socket.join(`chess:${game.id}`);
      socket.data.chessGameId = game.id;
      io.to(`chess:${game.id}`).emit('chess-started', { game: publicGameState(game) });
      socket.emit('chess-joined', { gameId: game.id, color: 'b', game: publicGameState(game) });
    });

    socket.on('chess-move', ({ gameId, from, to, promotion, fen, turn }) => {
      const game = getGame(gameId);
      if (!game || game.status !== 'active') return;
      const isWhite = game.white.socketId === socket.id;
      const isBlack = game.black?.socketId === socket.id;
      if (!isWhite && !isBlack) return;
      const expected = isWhite ? 'w' : 'b';
      if (turn && turn !== expected) return;
      game.fen = fen;
      game.turn = turn === 'w' ? 'b' : 'w';
      socket.to(`chess:${game.id}`).emit('chess-move', { from, to, promotion, fen, turn: game.turn });
    });

    socket.on('chess-chat', ({ gameId, message, name }) => {
      const game = getGame(gameId);
      if (!game) return;
      const entry = { name: name || 'Player', message, at: Date.now(), socketId: socket.id };
      game.chat.push(entry);
      if (game.chat.length > 100) game.chat.shift();
      io.to(`chess:${game.id}`).emit('chess-chat', entry);
    });

    socket.on('chess-resign', ({ gameId }) => {
      const game = getGame(gameId);
      if (!game) return;
      game.status = 'ended';
      const winner = game.white.socketId === socket.id ? 'b' : 'w';
      io.to(`chess:${game.id}`).emit('chess-ended', { reason: 'resign', winner });
    });

    /** WebRTC voice signaling — relay only between players in the same chess game */
    socket.on('chess-rtc', ({ gameId, to, data }) => {
      const game = getGame(gameId);
      if (!game || !to || !data) return;
      const inGame =
        game.white.socketId === socket.id ||
        game.black?.socketId === socket.id;
      if (!inGame) return;
      const peerOk =
        to === game.white.socketId || to === game.black?.socketId;
      if (!peerOk) return;
      io.to(to).emit('chess-rtc', { from: socket.id, data });
    });

    socket.on('disconnect', () => {
      const gid = socket.data?.chessGameId;
      if (!gid) return;
      const game = getGame(gid);
      if (!game) return;
      if (game.white.socketId === socket.id) game.white.disconnected = true;
      if (game.black?.socketId === socket.id) game.black.disconnected = true;
      socket.to(`chess:${gid}`).emit('chess-opponent-left');
    });
  });
}

function publicGameState(game) {
  return {
    id: game.id,
    fen: game.fen,
    status: game.status,
    turn: game.turn,
    white: { name: game.white.name, socketId: game.white.socketId },
    black: game.black
      ? { name: game.black.name, socketId: game.black.socketId }
      : null,
    chat: game.chat.slice(-30),
  };
}
