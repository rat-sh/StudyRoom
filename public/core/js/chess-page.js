/* Chess page — AI, local, online PVP + game chat */
const user = API.user();
const playerName = user?.name || sessionStorage.getItem('sr_guest_display_name') || 'Guest';
const playerId = user?.id || null;

const socket = io({ transports: ['websocket'] });
let game = null;
let board = null;
let myColor = null;
let gameId = null;
let myRole = 'ai'; // ai | local | pvp
let pvpStatus = 'idle';

const urlGame = new URLSearchParams(location.search).get('game');

window.addEventListener('DOMContentLoaded', () => {
  initAppSidebar('games');
  if (window.lucide) lucide.createIcons();
  if (window.ChessVoice) ChessVoice.init(socket);
  initBoard();
  bindUI();
  if (urlGame) {
    document.getElementById('modeSelect').value = 'pvp';
    joinPvpGame(urlGame);
  }
});

function bindUI() {
  document.getElementById('modeSelect')?.addEventListener('change', onModeChange);
  document.getElementById('resetBtn')?.addEventListener('click', resetBoard);
  document.getElementById('createPvpBtn')?.addEventListener('click', createPvpGame);
  document.getElementById('joinPvpBtn')?.addEventListener('click', () => {
    const id = document.getElementById('joinGameId')?.value.trim().toUpperCase();
    if (id) joinPvpGame(id);
  });
  document.getElementById('copyLinkBtn')?.addEventListener('click', copyInviteLink);
  document.getElementById('chessChatSend')?.addEventListener('click', sendChessChat);
  document.getElementById('chessChatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChessChat();
  });
}

function onModeChange() {
  myRole = document.getElementById('modeSelect').value;
  const pvp = document.getElementById('pvpControls');
  if (pvp) pvp.style.display = myRole === 'pvp' ? 'flex' : 'none';
  if (myRole !== 'pvp' && window.ChessVoice) ChessVoice.clearPeers();
  resetBoard();
  setStatus(myRole === 'local' ? 'Local 2-player on one device' : myRole === 'pvp' ? 'Create or join an online match' : 'You play White vs Stockfish');
}

function initBoard() {
  game = new Chess();
  const cfg = {
    draggable: true,
    position: 'start',
    pieceTheme: pieceTheme,
    onDragStart,
    onDrop,
    onSnapEnd: () => board.position(game.fen()),
  };
  board = Chessboard('board', cfg);
  onModeChange();
}

function resetBoard() {
  if (window.ChessVoice) ChessVoice.stopVoice();
  game.reset();
  board.orientation('white');
  board.start();
  clearHighlights();
  if (myRole === 'pvp' && gameId) socket.emit('chess-resign', { gameId });
  updateStatus();
}

function canMovePiece(piece) {
  if (game.game_over()) return false;
  if (myRole === 'local') return true;
  if (myRole === 'ai') {
    return !((game.turn() === 'w' && piece.search(/^b/) !== -1) || (game.turn() === 'b' && piece.search(/^w/) !== -1));
  }
  if (myRole === 'pvp') {
    if (pvpStatus !== 'active' || !myColor) return false;
    const mine = myColor === 'w' ? /^w/ : /^b/;
    const theirs = myColor === 'w' ? /^b/ : /^w/;
    return game.turn() === myColor.charAt(0) && piece.search(mine) !== -1 && piece.search(theirs) === -1;
  }
  return false;
}

function onDragStart(source, piece) {
  return canMovePiece(piece);
}

function onDrop(source, target) {
  clearHighlights();
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (!move) return 'snapback';
  playMoveSound(move);
  highlightMove(move.from, move.to);
  updateStatus();

  if (myRole === 'pvp' && gameId && myColor) {
    const fen = game.fen();
    socket.emit('chess-move', {
      gameId,
      from: source,
      to: target,
      promotion: 'q',
      fen,
      turn: game.turn() === 'w' ? 'w' : 'b',
    });
    return;
  }

  if (myRole === 'ai' && !game.game_over() && game.turn() === 'b') {
    setTimeout(makeStockfishMove, 200);
  }
}

function applyRemoteMove({ from, to, promotion, fen }) {
  game.load(fen);
  board.position(fen);
  clearHighlights();
  highlightMove(from, to);
  updateStatus();
}

// ── PVP ───────────────────────────────────────────────────────────
function createPvpGame() {
  socket.emit('chess-create', { name: playerName, userId: playerId });
}

function joinPvpGame(id) {
  socket.emit('chess-join', { gameId: id, name: playerName, userId: playerId });
}

function copyInviteLink() {
  if (!gameId) return;
  const url = `${location.origin}/chess?game=${gameId}`;
  navigator.clipboard.writeText(url).then(() => showToast('Invite link copied'));
}

socket.on('chess-created', ({ gameId: id, color, game: g }) => {
  gameId = id;
  myColor = color;
  myRole = 'pvp';
  pvpStatus = g.status;
  setupPvpUI(g, color);
  syncVoicePeers(g);
  history.replaceState(null, '', `/chess?game=${id}`);
  showToast('Match created — share the game ID');
});

socket.on('chess-joined', ({ gameId: id, color, game: g }) => {
  gameId = id;
  myColor = color;
  myRole = 'pvp';
  pvpStatus = g.status;
  setupPvpUI(g, color);
  syncVoicePeers(g);
  if (g.fen) { game.load(g.fen); board.position(g.fen); }
  board.orientation(color === 'w' ? 'white' : 'black');
  if (g.status === 'active') {
    showToast('Joined match — good luck!');
    ChessVoice?.autoConnect();
  } else showToast('Waiting for opponent…');
  updateStatus();
});

socket.on('chess-started', ({ game: g }) => {
  pvpStatus = 'active';
  setupPvpUI(g, myColor);
  syncVoicePeers(g);
  if (g.fen) { game.load(g.fen); board.position(g.fen); }
  showToast('Opponent joined — game started!');
  ChessVoice?.autoConnect();
  updateStatus();
});

socket.on('chess-move', (payload) => applyRemoteMove(payload));

socket.on('chess-chat', appendChat);

socket.on('chess-ended', ({ reason, winner }) => {
  setStatus(reason === 'resign' ? `Game over — ${winner === 'w' ? 'White' : 'Black'} wins` : 'Game ended');
});

socket.on('chess-error', ({ error }) => showToast(error || 'Chess error'));

socket.on('chess-opponent-left', () => {
  ChessVoice?.stopVoice();
  ChessVoice?.setPeers(gameId, null, null, socket.id);
  showToast('Opponent disconnected');
});

function syncVoicePeers(g) {
  if (!window.ChessVoice || !g) return;
  const w = g.white?.socketId;
  const b = g.black?.socketId;
  if (g.status === 'active' && w && b) {
    ChessVoice.setPeers(g.id, w, b, socket.id);
  } else {
    ChessVoice.setPeers(g.id, w || null, b || null, socket.id);
  }
}

function setupPvpUI(g, color) {
  document.getElementById('modeSelect').value = 'pvp';
  document.getElementById('pvpControls').style.display = 'flex';
  document.getElementById('gameIdDisplay').value = g.id;
  const opp = color === 'w' ? g.black : g.white;
  document.getElementById('pvpMeta').innerHTML = `
    <div>You: <strong>${escapeHtml(color === 'w' ? g.white?.name : g.black?.name || playerName)}</strong> (${color === 'w' ? 'White' : 'Black'})</div>
    <div>Opponent: <strong>${opp ? escapeHtml(opp.name) : 'Waiting…'}</strong></div>
    <div>Status: <strong>${g.status}</strong></div>`;
  const chatEl = document.getElementById('chessChatMessages');
  chatEl.innerHTML = '';
  (g.chat || []).forEach(appendChat);
}

function sendChessChat() {
  const input = document.getElementById('chessChatInput');
  const text = input?.value.trim();
  if (!text) return;
  if (myRole === 'pvp' && gameId) {
    socket.emit('chess-chat', { gameId, message: text, name: playerName });
    input.value = '';
    return;
  }
  appendChat({ name: playerName, message: text, at: Date.now() });
  input.value = '';
}

function appendChat({ name, message }) {
  const el = document.getElementById('chessChatMessages');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'chess-chat-msg';
  div.innerHTML = `<span class="who">${escapeHtml(name)}</span>${escapeHtml(message)}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ── AI ────────────────────────────────────────────────────────────
async function makeStockfishMove() {
  if (game.game_over()) return;
  try {
    const res = await fetch('/api/chess/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: game.fen(), depth: 10 }),
    });
    const data = await res.json();
    if (!res.ok || !data.bestmove || data.bestmove === '(none)') return makeRandomFallback();
    const uci = data.bestmove;
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : 'q',
    });
    if (!move) return makeRandomFallback();
    playMoveSound(move);
    highlightMove(move.from, move.to);
    board.position(game.fen());
    updateStatus();
  } catch {
    makeRandomFallback();
  }
}

function makeRandomFallback() {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return;
  const m = moves[Math.floor(Math.random() * moves.length)];
  game.move(m.san);
  playMoveSound(m);
  highlightMove(m.from, m.to);
  board.position(game.fen());
  updateStatus();
}

function updateStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  let t = game.turn() === 'w' ? 'White' : 'Black';
  if (game.in_checkmate()) el.textContent = `Checkmate — ${t} wins`;
  else if (game.in_draw()) el.textContent = 'Draw';
  else {
    let s = `${t} to move`;
    if (game.in_check()) s += ' (check)';
    if (myRole === 'pvp' && myColor) s += ` · You are ${myColor === 'w' ? 'White' : 'Black'}`;
    el.textContent = s;
  }
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

function pieceTheme(piece) {
  const color = piece.charAt(0) === 'w' ? 'white' : 'black';
  const map = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
  return `/core/assets/chess/images/imgs-80px/${color}_${map[piece.charAt(1)]}.png`;
}

const moveSound = new Audio('/core/assets/chess/sounds/move.wav');
const captureSound = new Audio('/core/assets/chess/sounds/capture.wav');

function playMoveSound(move) {
  const a = move.captured ? captureSound : moveSound;
  a.currentTime = 0;
  a.play().catch(() => {});
}

function clearHighlights() {
  $('#board').find('.square-55d63').removeClass('highlight-white highlight-black');
}

function highlightMove(from, to) {
  const $b = $('#board');
  [$b.find('.square-' + from), $b.find('.square-' + to)].forEach($sq => {
    if ($sq.hasClass('black-3c85d')) $sq.addClass('highlight-black');
    else $sq.addClass('highlight-white');
  });
}
