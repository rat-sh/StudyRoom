const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room') || 'solo';

// Nav logic
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.game-container').forEach(c => c.classList.add('hidden'));
    document.getElementById('game-' + btn.dataset.game).classList.remove('hidden');
  });
});

// ── TIC TAC TOE ──────────────────────────────────────────────────
let tttBoard = ['', '', '', '', '', '', '', '', ''];
let tttTurn = 'X';
let myPlayerTTT = null; // 'X' or 'O' assigned dynamically based on who moves first or joins first

function updateTTTUI() {
  const cells = document.querySelectorAll('.ttt-cell');
  for (let i = 0; i < 9; i++) {
    cells[i].textContent = tttBoard[i];
    cells[i].className = 'ttt-cell ' + tttBoard[i];
  }
  checkWinnerTTT();
}

function makeMoveTTT(index) {
  if (tttBoard[index] !== '' || document.getElementById('ttt-status').textContent.includes('wins')) return;
  
  if (!myPlayerTTT) myPlayerTTT = tttTurn; // Assign myself the current turn if unassigned
  if (tttTurn !== myPlayerTTT) return; // Not my turn
  
  tttBoard[index] = myPlayerTTT;
  updateTTTUI();
  tttTurn = tttTurn === 'X' ? 'O' : 'X';
  document.getElementById('ttt-status').textContent = `Turn: ${tttTurn}`;
  
  socket.emit('ttt-move', { roomCode, index, player: myPlayerTTT });
}

socket.on('ttt-move', ({ index, player }) => {
  if (!myPlayerTTT) myPlayerTTT = player === 'X' ? 'O' : 'X';
  tttBoard[index] = player;
  tttTurn = player === 'X' ? 'O' : 'X';
  document.getElementById('ttt-status').textContent = `Turn: ${tttTurn}`;
  updateTTTUI();
});

function checkWinnerTTT() {
  const winPatterns = [
    [0,1,2], [3,4,5], [6,7,8], // rows
    [0,3,6], [1,4,7], [2,5,8], // cols
    [0,4,8], [2,4,6] // diagonals
  ];
  for (let p of winPatterns) {
    if (tttBoard[p[0]] && tttBoard[p[0]] === tttBoard[p[1]] && tttBoard[p[0]] === tttBoard[p[2]]) {
      document.getElementById('ttt-status').textContent = `${tttBoard[p[0]]} wins!`;
      return;
    }
  }
  if (!tttBoard.includes('')) {
    document.getElementById('ttt-status').textContent = "It's a draw!";
  }
}

function requestResetTTT() {
  resetTTTLocally();
  socket.emit('ttt-reset', { roomCode });
}

function resetTTTLocally() {
  tttBoard = ['', '', '', '', '', '', '', '', ''];
  tttTurn = 'X';
  myPlayerTTT = null;
  document.getElementById('ttt-status').textContent = "Tic Tac Toe";
  updateTTTUI();
}

socket.on('ttt-reset', () => resetTTTLocally());


// ── HOUSE BUILDING (Dots & Boxes) ──────────────────────────────
const DAB_SIZE = 4; // 4x4 boxes (requires 5x5 dots)
let dabH = Array(DAB_SIZE + 1).fill().map(() => Array(DAB_SIZE).fill(false)); // Horizontal lines
let dabV = Array(DAB_SIZE).fill().map(() => Array(DAB_SIZE + 1).fill(false)); // Vertical lines
let dabBoxes = Array(DAB_SIZE).fill().map(() => Array(DAB_SIZE).fill(0)); // 0: empty, 1: P1, 2: P2
let dabTurn = 1;
let dabScores = { 1: 0, 2: 0 };
let myPlayerDAB = null;

function renderDAB() {
  const board = document.getElementById('dab-board');
  board.innerHTML = '';
  
  for (let r = 0; r <= DAB_SIZE; r++) {
    // Dot + HLine row
    const rowDiv = document.createElement('div');
    rowDiv.className = 'dab-row';
    for (let c = 0; c <= DAB_SIZE; c++) {
      rowDiv.innerHTML += `<div class="dab-dot"></div>`;
      if (c < DAB_SIZE) {
        const hline = document.createElement('div');
        hline.className = 'dab-hline' + (dabH[r][c] ? ' filled' : '');
        hline.onclick = () => makeMoveDAB('h', r, c);
        rowDiv.appendChild(hline);
      }
    }
    board.appendChild(rowDiv);
    
    // VLine + Box row
    if (r < DAB_SIZE) {
      const vrowDiv = document.createElement('div');
      vrowDiv.className = 'dab-vline-row';
      for (let c = 0; c <= DAB_SIZE; c++) {
        const vline = document.createElement('div');
        vline.className = 'dab-vline' + (dabV[r][c] ? ' filled' : '');
        vline.onclick = () => makeMoveDAB('v', r, c);
        vrowDiv.appendChild(vline);
        
        if (c < DAB_SIZE) {
          const box = document.createElement('div');
          let boxClass = '';
          let boxText = '';
          if (dabBoxes[r][c] === 1) { boxClass = ' p1'; boxText = 'P1'; }
          if (dabBoxes[r][c] === 2) { boxClass = ' p2'; boxText = 'P2'; }
          box.className = 'dab-box' + boxClass;
          box.textContent = boxText;
          vrowDiv.appendChild(box);
        }
      }
      board.appendChild(vrowDiv);
    }
  }
  
  document.getElementById('dab-p1').textContent = dabScores[1];
  document.getElementById('dab-p2').textContent = dabScores[2];
  
  const totalBoxes = DAB_SIZE * DAB_SIZE;
  if (dabScores[1] + dabScores[2] === totalBoxes) {
    document.getElementById('dab-status').textContent = dabScores[1] > dabScores[2] ? 'Player 1 Wins!' : (dabScores[2] > dabScores[1] ? 'Player 2 Wins!' : 'Draw!');
  } else {
    document.getElementById('dab-status').textContent = `Turn: Player ${dabTurn}`;
  }
}

function makeMoveDAB(type, r, c) {
  if (type === 'h' && dabH[r][c]) return;
  if (type === 'v' && dabV[r][c]) return;
  if (document.getElementById('dab-status').textContent.includes('Wins')) return;
  
  if (!myPlayerDAB) myPlayerDAB = dabTurn; // Assign player
  if (dabTurn !== myPlayerDAB) return; // Not my turn
  
  applyMoveDAB(type, r, c, myPlayerDAB);
  socket.emit('dab-move', { roomCode, type, r, c, player: myPlayerDAB });
}

function applyMoveDAB(type, r, c, player) {
  if (type === 'h') dabH[r][c] = true;
  if (type === 'v') dabV[r][c] = true;
  
  let scored = false;
  // Check newly formed boxes
  for (let br = 0; br < DAB_SIZE; br++) {
    for (let bc = 0; bc < DAB_SIZE; bc++) {
      if (dabBoxes[br][bc] === 0 && dabH[br][bc] && dabH[br+1][bc] && dabV[br][bc] && dabV[br][bc+1]) {
        dabBoxes[br][bc] = player;
        dabScores[player]++;
        scored = true;
      }
    }
  }
  
  if (!scored) {
    dabTurn = dabTurn === 1 ? 2 : 1;
  }
  
  renderDAB();
}

socket.on('dab-move', ({ type, r, c, player }) => {
  if (!myPlayerDAB) myPlayerDAB = player === 1 ? 2 : 1;
  applyMoveDAB(type, r, c, player);
});

function requestResetDAB() {
  resetDABLocally();
  socket.emit('dab-reset', { roomCode });
}

function resetDABLocally() {
  dabH = Array(DAB_SIZE + 1).fill().map(() => Array(DAB_SIZE).fill(false));
  dabV = Array(DAB_SIZE).fill().map(() => Array(DAB_SIZE + 1).fill(false));
  dabBoxes = Array(DAB_SIZE).fill().map(() => Array(DAB_SIZE).fill(0));
  dabTurn = 1;
  dabScores = { 1: 0, 2: 0 };
  myPlayerDAB = null;
  renderDAB();
}

socket.on('dab-reset', () => resetDABLocally());



// ── SUDOKU RACE (MULTIPLAYER) ─────────────────────────────────────────────
// Board generation via backtracking, max 2 active players, rest are spectators.

let sudokuSolution = [];   // 9x9 complete solved grid
let sudokuPuzzle = [];     // 9x9 puzzle (0 = blank)
let sudokuUserGrid = [];   // local player's answers
let sudokuOppGrid = [];    // opponent's visible answers
let sudokuSelected = null; // {r, c}
let sudokuMyRole = null;   // 'p1' | 'p2' | 'spectator'
let sudokuMyMistakes = 0;
let sudokuOppMistakes = 0;
let sudokuTimerEl = document.getElementById('sudoku-timer');
let sudokuTimerInterval = null;
let sudokuStartTime = null;
let sudokuGameActive = false;

// ── Board Generator (backtracking) ───────────────────────────────────────
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function _isValid(board, r, c, num) {
  for (let i = 0; i < 9; i++) {
    if (board[r][i] === num || board[i][c] === num) return false;
  }
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++)
      if (board[br + dr][bc + dc] === num) return false;
  return true;
}

function _solve(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        const nums = _shuffle([1,2,3,4,5,6,7,8,9]);
        for (const num of nums) {
          if (_isValid(board, r, c, num)) {
            board[r][c] = num;
            if (_solve(board)) return true;
            board[r][c] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

function _generateBoard() {
  const board = Array.from({length: 9}, () => Array(9).fill(0));
  _solve(board);
  return board;
}

function _makePuzzle(solution, blanks = 45) {
  const puzzle = solution.map(r => [...r]);
  let removed = 0;
  while (removed < blanks) {
    const r = Math.floor(Math.random() * 9);
    const c = Math.floor(Math.random() * 9);
    if (puzzle[r][c] !== 0) { puzzle[r][c] = 0; removed++; }
  }
  return puzzle;
}

// ── Serialise board for socket transport ─────────────────────────────────
function _flatBoard(grid) { return grid.map(r => r.join(',')).join('|'); }
function _parseBoard(str) { return str.split('|').map(r => r.split(',').map(Number)); }

// ── Request a new race (host generates & broadcasts board) ────────────────
function requestSudokuRace() {
  document.getElementById('sudoku-overlay').classList.add('hidden');
  const solution = _generateBoard();
  const puzzle = _makePuzzle(solution, 46);
  socket.emit('sudoku-start', {
    roomCode,
    solution: _flatBoard(solution),
    puzzle: _flatBoard(puzzle)
  });
}

// ── Render the board ─────────────────────────────────────────────────────
function renderSudokuBoard() {
  const board = document.getElementById('sudoku-board');
  board.innerHTML = '';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = 'sudoku-cell';
      if (c === 2 || c === 5) cell.classList.add('box-right');
      if (r === 2 || r === 5) cell.classList.add('box-bottom');

      const isFixed = sudokuPuzzle[r][c] !== 0;
      if (isFixed) {
        cell.classList.add('fixed');
        cell.textContent = sudokuPuzzle[r][c];
      } else if (sudokuOppGrid[r] && sudokuOppGrid[r][c]) {
        cell.classList.add('opponent-filled');
        cell.textContent = sudokuOppGrid[r][c];
      } else if (sudokuUserGrid[r] && sudokuUserGrid[r][c]) {
        const val = sudokuUserGrid[r][c];
        cell.textContent = val;
        const correct = sudokuSolution[r][c] === val;
        cell.classList.add(correct ? 'user-filled' : 'err');
      }

      if (!isFixed) {
        cell.addEventListener('click', () => {
          document.querySelectorAll('.sudoku-cell').forEach(c => c.style.outline = '');
          cell.style.outline = '2px solid var(--accent)';
          sudokuSelected = { r, c };
        });
      }
      board.appendChild(cell);
    }
  }
}

// ── Numpad input ─────────────────────────────────────────────────────────
function sudokuNumInput(num) {
  if (!sudokuSelected || !sudokuGameActive) return;
  if (sudokuMyRole === 'spectator') return;
  const { r, c } = sudokuSelected;
  if (sudokuPuzzle[r][c] !== 0) return; // fixed cell

  const prev = sudokuUserGrid[r][c];
  sudokuUserGrid[r][c] = num;

  if (num !== 0) {
    const correct = sudokuSolution[r][c] === num;
    if (!correct && prev !== num) {
      sudokuMyMistakes++;
      document.getElementById('sudoku-my-mistakes').textContent = `❌ ${sudokuMyMistakes}`;
    }
  }

  renderSudokuBoard();
  _updateMyProgress();

  socket.emit('sudoku-cell', { roomCode, r, c, val: num });

  // Check if completed
  if (_isComplete(sudokuUserGrid, sudokuPuzzle, sudokuSolution)) {
    socket.emit('sudoku-complete', { roomCode });
  }
}

function _countFilled(grid, puzzle) {
  let filled = 0, total = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (puzzle[r][c] === 0) {
        total++;
        if (grid[r][c] && grid[r][c] !== 0) filled++;
      }
  return { filled, total };
}

function _isComplete(userGrid, puzzle, solution) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (puzzle[r][c] === 0 && userGrid[r][c] !== solution[r][c]) return false;
  return true;
}

function _updateMyProgress() {
  const { filled, total } = _countFilled(sudokuUserGrid, sudokuPuzzle);
  const pct = total ? Math.round((filled / total) * 100) : 0;
  document.getElementById('sudoku-my-progress-text').textContent = pct + '%';
  document.getElementById('sudoku-my-fill').style.width = pct + '%';
}

function _updateOppProgress() {
  const { filled, total } = _countFilled(sudokuOppGrid, sudokuPuzzle);
  const pct = total ? Math.round((filled / total) * 100) : 0;
  document.getElementById('sudoku-opp-progress-text').textContent = pct + '%';
  document.getElementById('sudoku-opp-fill').style.width = pct + '%';
}

// ── Timer ─────────────────────────────────────────────────────────────────
function _startTimer() {
  clearInterval(sudokuTimerInterval);
  sudokuStartTime = Date.now();
  sudokuTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - sudokuStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    sudokuTimerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function _stopTimer() { clearInterval(sudokuTimerInterval); }

// ── Show win/lose overlay ─────────────────────────────────────────────────
function _showSudokuOverlay(won) {
  _stopTimer();
  sudokuGameActive = false;
  const overlay = document.getElementById('sudoku-overlay');
  document.getElementById('overlay-emoji').textContent = won ? '🏆' : '😔';
  document.getElementById('overlay-title').textContent = won ? 'You Win!' : 'Opponent Wins!';
  document.getElementById('overlay-subtitle').textContent = won
    ? `You solved it first in ${sudokuTimerEl.textContent}!`
    : 'Better luck next time!';
  overlay.classList.remove('hidden');
}

// ── Socket Events ─────────────────────────────────────────────────────────
socket.on('sudoku-start', ({ solution, puzzle, role }) => {
  sudokuSolution = _parseBoard(solution);
  sudokuPuzzle = _parseBoard(puzzle);
  sudokuUserGrid = Array.from({length:9}, () => Array(9).fill(0));
  sudokuOppGrid  = Array.from({length:9}, () => Array(9).fill(0));
  sudokuMyMistakes = 0; sudokuOppMistakes = 0;
  sudokuMyRole = role;
  sudokuSelected = null;
  sudokuGameActive = true;

  document.getElementById('sudoku-my-role').textContent = role === 'spectator' ? '👁 Spectator' : role === 'p1' ? 'Player 1' : 'Player 2';
  document.getElementById('sudoku-my-role').className = 'sudoku-role-badge ' + (role === 'spectator' ? 'spectator' : 'player');
  document.getElementById('sudoku-my-mistakes').textContent = '❌ 0';
  document.getElementById('sudoku-opp-mistakes').textContent = '❌ 0';
  document.getElementById('sudoku-my-fill').style.width = '0%';
  document.getElementById('sudoku-opp-fill').style.width = '0%';
  document.getElementById('sudoku-my-progress-text').textContent = '0%';
  document.getElementById('sudoku-opp-progress-text').textContent = '0%';
  document.getElementById('sudoku-overlay').classList.add('hidden');
  document.getElementById('sudoku-status').textContent = role === 'spectator'
    ? '👁 Watching — solve to compete next round'
    : '⚡ Race started! First to finish wins!';

  renderSudokuBoard();
  _startTimer();
});

socket.on('sudoku-cell', ({ r, c, val }) => {
  // This is the opponent's move
  if (!sudokuOppGrid[r]) return;
  sudokuOppGrid[r][c] = val;
  if (val !== 0 && sudokuSolution[r] && sudokuSolution[r][c] !== val) {
    sudokuOppMistakes++;
    document.getElementById('sudoku-opp-mistakes').textContent = `❌ ${sudokuOppMistakes}`;
  }
  _updateOppProgress();
  renderSudokuBoard();
});

socket.on('sudoku-winner', ({ winner }) => {
  const iWon = winner === sudokuMyRole;
  _showSudokuOverlay(iWon);
});

socket.on('sudoku-role', ({ role }) => {
  sudokuMyRole = role;
  document.getElementById('sudoku-opp-role').textContent = role === 'p1' ? 'Player 2' : role === 'p2' ? 'Player 1' : 'Spectating';
  document.getElementById('sudoku-my-role').textContent = role === 'spectator' ? '👁 Spectator' : role === 'p1' ? 'Player 1' : 'Player 2';
});

// ── Initialize ──────────────────────────────────────────────────────────
renderDAB();
function joinSudokuSlot() {
  socket.emit('sudoku-join', { roomCode });
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.game === 'sudoku') joinSudokuSlot();
  });
});
joinSudokuSlot();



// ── ROCK PAPER SCISSORS ────────────────────────────────────────────────
let rpsMyMove = null;
let rpsOpponentMove = null;
let rpsMyPlayer = null; // 'p1' or 'p2'

function makeMoveRPS(move) {
  if (rpsMyMove) return;
  if (!rpsMyPlayer) rpsMyPlayer = 'p1';
  rpsMyMove = move;
  document.getElementById('rps-status').textContent = 'Waiting for opponent…';
  document.getElementById('rps-my-display').textContent = getEmoji(move);
  document.querySelectorAll('.rps-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('rps-btn-' + move)?.classList.add('selected');
  socket.emit('rps-move', { roomCode, move, player: rpsMyPlayer });
  checkRPSResult();
}

socket.on('rps-move', ({ move, player }) => {
  if (!rpsMyPlayer) rpsMyPlayer = player === 'p1' ? 'p2' : 'p1';
  if (player !== rpsMyPlayer) {
    rpsOpponentMove = move;
    document.getElementById('rps-opp-display').textContent = getEmoji(move);
  }
  checkRPSResult();
});

function checkRPSResult() {
  if (rpsMyMove && rpsOpponentMove) {
    let result = '';
    if (rpsMyMove === rpsOpponentMove) result = "It's a Tie!";
    else if (
      (rpsMyMove === 'rock' && rpsOpponentMove === 'scissors') ||
      (rpsMyMove === 'paper' && rpsOpponentMove === 'rock') ||
      (rpsMyMove === 'scissors' && rpsOpponentMove === 'paper')
    ) {
      result = "<span style='color:var(--success)'>You Win!</span>";
    } else {
      result = "<span style='color:var(--danger)'>Opponent Wins!</span>";
    }
    
    document.getElementById('rps-status').textContent = 'Game Over';
    document.getElementById('rps-scores').textContent = '';
    document.getElementById('rps-my-display').textContent = getEmoji(rpsMyMove);
    document.getElementById('rps-opp-display').textContent = getEmoji(rpsOpponentMove);
    document.getElementById('rps-result').innerHTML = result;
    document.getElementById('rps-reset-btn').classList.remove('hidden');
    document.getElementById('rps-choices').classList.add('hidden');
  } else if (rpsOpponentMove) {
    document.getElementById('rps-status').textContent = "Opponent has chosen. Your turn!";
  }
}

function getEmoji(move) {
  if (move === 'rock') return '✊';
  if (move === 'paper') return '✋';
  if (move === 'scissors') return '✌️';
  return '';
}

function requestResetRPS() {
  resetRPSLocally();
  socket.emit('rps-reset', { roomCode });
}

function resetRPSLocally() {
  rpsMyMove = null;
  rpsOpponentMove = null;
  rpsMyPlayer = null;
  document.getElementById('rps-status').textContent = 'Rock Paper Scissors';
  document.getElementById('rps-scores').textContent = 'Choose your move';
  document.getElementById('rps-my-display').textContent = '?';
  document.getElementById('rps-opp-display').textContent = '?';
  document.getElementById('rps-result').innerHTML = '';
  document.getElementById('rps-reset-btn').classList.add('hidden');
  document.getElementById('rps-choices').classList.remove('hidden');
  document.querySelectorAll('.rps-btn').forEach(btn => btn.classList.remove('selected'));
}

socket.on('rps-reset', () => resetRPSLocally());
