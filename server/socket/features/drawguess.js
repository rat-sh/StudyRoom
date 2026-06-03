const WORDS = [
  'apple','house','tree','sun','cat','dog','car','computer',
  'phone','mountain','river','book','pizza','bird','flower',
  'airplane','train','clock','key','shoes','glasses','camera',
  'guitar','cloud','star','moon','fish','snake','turtle','elephant',
  'penguin','robot','alien','ghost','dragon','castle','sword','shield',
  'rainbow','balloon','bicycle','telescope','telescope','umbrella','volcano',
  'kangaroo','submarine','lighthouse','dinosaur','tornado','pyramid','cactus',
  'parachute','microscope','skateboard','basketball','headphones','popcorn'
];

const games = {};

function initGame(roomCode) {
  if (!games[roomCode]) {
    games[roomCode] = {
      state: 'waiting',
      drawer: null,
      word: '',
      timeLeft: 0,
      timer: null,
      scores: {},   // id -> { name, score }
      guessed: [],
      players: new Set()
    };
  }
  return games[roomCode];
}

function broadcastState(io, roomCode) {
  const game = games[roomCode];
  if (!game) return;

  const safeState = {
    state:      game.state,
    drawer:     game.drawer,
    wordLength: game.word.length,
    timeLeft:   game.timeLeft,
    scores:     game.scores,
    guessed:    game.guessed
  };

  io.to(roomCode).emit('dg-state', safeState);

  if (game.drawer) {
    io.to(game.drawer).emit('dg-word', game.word);
  }
}

export default function(io, rooms) {
  io.on('connection', (socket) => {

    socket.on('dg-join', ({ roomCode, name }) => {
      socket.join(roomCode);
      const game = initGame(roomCode);
      game.players.add(socket.id);

      if (!game.scores[socket.id]) {
        game.scores[socket.id] = { name: name || 'Player', score: 0 };
      } else {
        game.scores[socket.id].name = name || game.scores[socket.id].name;
      }

      // Tell others a new player joined
      socket.to(roomCode).emit('dg-player-joined', {
        name: name || 'Player',
        scores: game.scores
      });

      broadcastState(io, roomCode);
    });

    socket.on('dg-start', ({ roomCode, name }) => {
      const game = games[roomCode];
      if (!game || game.players.size < 1) return;

      if (game.timer) clearInterval(game.timer);

      const playersArr   = Array.from(game.players);
      let possibleDrawers = playersArr.filter(id => id !== game.drawer);
      if (possibleDrawers.length === 0) possibleDrawers = playersArr;

      game.drawer  = possibleDrawers[Math.floor(Math.random() * possibleDrawers.length)];
      game.word    = WORDS[Math.floor(Math.random() * WORDS.length)];
      game.state   = 'playing';
      game.timeLeft = 60;
      game.guessed = [];

      const drawerName = game.scores[game.drawer]?.name || 'Someone';
      io.to(roomCode).emit('dg-system-msg', `🎨 Round started! ${drawerName} is drawing.`);
      io.to(roomCode).emit('dg-clear');

      broadcastState(io, roomCode);

      game.timer = setInterval(() => {
        game.timeLeft--;
        if (game.timeLeft <= 0) {
          clearInterval(game.timer);
          game.state = 'waiting';
          io.to(roomCode).emit('dg-system-msg', `⏰ Time's up! The word was "${game.word.toUpperCase()}"`);
          broadcastState(io, roomCode);
        } else {
          io.to(roomCode).emit('dg-time', game.timeLeft);
        }
      }, 1000);
    });

    socket.on('dg-guess', ({ roomCode, text, name }) => {
      const game = games[roomCode];
      if (!game || game.state !== 'playing') return;
      if (socket.id === game.drawer) return;
      if (game.guessed.includes(socket.id)) return;

      const cleanGuess = text.trim().toLowerCase();

      if (cleanGuess === game.word) {
        game.guessed.push(socket.id);

        const points = Math.max(10, game.timeLeft);
        game.scores[socket.id].score  = (game.scores[socket.id]?.score || 0) + points;
        game.scores[game.drawer].score = (game.scores[game.drawer]?.score || 0) + 5;

        const gName = game.scores[socket.id]?.name || name || 'Someone';
        io.to(roomCode).emit('dg-system-msg', `✅ ${gName} guessed the word! (+${points} pts)`);

        const expectedGuessers = game.players.size - 1;
        if (expectedGuessers > 0 && game.guessed.length >= expectedGuessers) {
          clearInterval(game.timer);
          game.state = 'waiting';
          io.to(roomCode).emit('dg-system-msg', `🎉 Everyone guessed it! The word was "${game.word.toUpperCase()}"`);
          broadcastState(io, roomCode);
        } else {
          broadcastState(io, roomCode);
        }
      } else {
        // Normal chat — broadcast to everyone
        io.to(roomCode).emit('dg-chat', {
          name: game.scores[socket.id]?.name || name || 'Someone',
          text
        });
      }
    });

    socket.on('dg-draw', ({ roomCode, data }) => {
      const game = games[roomCode];
      if (game && game.drawer === socket.id) {
        socket.to(roomCode).emit('dg-draw', { data });
      }
    });

    socket.on('dg-clear', ({ roomCode }) => {
      const game = games[roomCode];
      if (game && game.drawer === socket.id) {
        socket.to(roomCode).emit('dg-clear');
      }
    });

    socket.on('disconnect', () => {
      for (const roomCode in games) {
        const game = games[roomCode];
        if (game.players.has(socket.id)) {
          const leftId = socket.id;
          game.players.delete(socket.id);
          delete game.scores[socket.id];

          io.to(roomCode).emit('dg-player-left', { id: leftId });

          if (game.players.size === 0) {
            if (game.timer) clearInterval(game.timer);
            delete games[roomCode];
          } else if (game.drawer === socket.id && game.state === 'playing') {
            clearInterval(game.timer);
            game.state = 'waiting';
            io.to(roomCode).emit('dg-system-msg', `The drawer left! The word was "${game.word.toUpperCase()}"`);
            broadcastState(io, roomCode);
          }
        }
      }
    });
  });
}
