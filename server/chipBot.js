// server/chipEngine.js

import { searchSong } from "./musicService.js";
import { getRoomState, updateRoomState } from "./roomState.js";

// ----------------------------
// 🧠 COMMAND PARSER
// ----------------------------
function parseCommand(raw) {
  if (!raw || !raw.startsWith("/")) return null;

  const [cmdToken, ...argTokens] = raw.slice(1).trim().split(" ");

  return {
    cmd: cmdToken.toLowerCase(),
    args: argTokens.join(" ").trim()
  };
}

// ----------------------------
// 💬 CHIP MESSAGE FORMAT
// ----------------------------
function chipMessage(text, subtype = "info") {
  return {
    id: Date.now(),
    sender: "Chip",
    avatar: "🤖",
    type: "bot",
    subtype,
    text,
    timestamp: Date.now()
  };
}

// ----------------------------
// 🚀 MAIN ENTRY
// ----------------------------
export async function handleChipCommand(raw, roomId,io) {
  const parsed = parseCommand(raw);

  if (!parsed) return;

  const { cmd, args } = parsed;

  try {
    switch (cmd) {

      case "play":
        return await handlePlay(args, roomId, io);

      case "pause":
        return handlePause(roomId, io);

      case "resume":
        return handleResume(roomId, io);

      case "stop":
        return handleStop(roomId, io);

      case "skip":
        return handleSkip(roomId, io);

      case "volume":
        return handleVolume(args, roomId, io);

      case "queue":
        return await handleQueue(args, roomId, io);

      case "np":
        return handleNowPlaying(roomId, io);

      case "shuffle":
        return handleShuffle(roomId, io);

      default:
        return io.to(roomId).emit("chip:message",
          chipMessage(`⚠️ Unknown command: /${cmd}`, "warning")
        );
    }
  } catch (err) {
    io.to(roomId).emit("chip:message",
      chipMessage("❌ Something went wrong", "error")
    );
  }
}

// ----------------------------
// 🎧 PLAY
// ----------------------------
async function handlePlay(query, roomId, io) {
  if (!query) {
    return io.to(roomId).emit("chip:message",
      chipMessage("❌ Provide a song name", "error")
    );
  }

  const song = await searchSong(query);

  if (!song) {
    return io.to(roomId).emit("chip:message",
      chipMessage(`❌ No results for "${query}"`, "error")
    );
  }

  const state = {
    currentSong: song,
    isPlaying: true,
    startedAt: Date.now(),
    seekOffset: 0,
    queue: [],
    volume: 100
  };

  updateRoomState(roomId, state);

  io.to(roomId).emit("chip:state", state);

  io.to(roomId).emit("chip:message",
    chipMessage(`🎧 Playing "${song.title}"`, "success")
  );
}

// ----------------------------
// ⏸️ PAUSE
// ----------------------------
function handlePause(roomId, io) {
  const state = getRoomState(roomId);

  if (!state?.isPlaying) return;

  const elapsed = (Date.now() - state.startedAt) / 1000;

  updateRoomState(roomId, {
    isPlaying: false,
    seekOffset: state.seekOffset + elapsed
  });

  io.to(roomId).emit("chip:state", getRoomState(roomId));

  io.to(roomId).emit("chip:message",
    chipMessage("⏸️ Paused")
  );
}

// ----------------------------
// ▶️ RESUME
// ----------------------------
function handleResume(roomId, io) {
  const state = getRoomState(roomId);

  if (!state) return;

  updateRoomState(roomId, {
    isPlaying: true,
    startedAt: Date.now()
  });

  io.to(roomId).emit("chip:state", getRoomState(roomId));

  io.to(roomId).emit("chip:message",
    chipMessage("▶️ Resumed")
  );
}

// ----------------------------
// 🛑 STOP
// ----------------------------
function handleStop(roomId, io) {
  updateRoomState(roomId, {
    currentSong: null,
    isPlaying: false,
    queue: []
  });

  io.to(roomId).emit("chip:state", getRoomState(roomId));

  io.to(roomId).emit("chip:message",
    chipMessage("🛑 Stopped playback")
  );
}

// ----------------------------
// ⏭️ SKIP
// ----------------------------
function handleSkip(roomId, io) {
  const state = getRoomState(roomId);

  if (!state?.queue?.length) {
    return io.to(roomId).emit("chip:message",
      chipMessage("⚠️ Queue is empty", "warning")
    );
  }

  const nextSong = state.queue.shift();

  updateRoomState(roomId, {
    currentSong: nextSong,
    isPlaying: true,
    startedAt: Date.now(),
    seekOffset: 0,
    queue: state.queue
  });

  io.to(roomId).emit("chip:state", getRoomState(roomId));

  io.to(roomId).emit("chip:message",
    chipMessage(`⏭️ Playing "${nextSong.title}"`)
  );
}

// ----------------------------
// 🔊 VOLUME
// ----------------------------
function handleVolume(val, roomId, io) {
  const volume = parseInt(val);

  if (isNaN(volume) || volume < 0 || volume > 100) {
    return io.to(roomId).emit("chip:message",
      chipMessage("⚠️ Volume must be 0–100", "warning")
    );
  }

  updateRoomState(roomId, { volume });

  io.to(roomId).emit("chip:state", getRoomState(roomId));

  io.to(roomId).emit("chip:message",
    chipMessage(`🔊 Volume set to ${volume}%`)
  );
}

// ----------------------------
// ➕ QUEUE
// ----------------------------
async function handleQueue(query, roomId, io) {
  if (!query) return;

  const song = await searchSong(query);

  if (!song) {
    return io.to(roomId).emit("chip:message",
      chipMessage(`❌ No results for "${query}"`, "error")
    );
  }

  const state = getRoomState(roomId);

  const queue = state?.queue || [];

  queue.push(song);

  updateRoomState(roomId, { queue });

  io.to(roomId).emit("chip:message",
    chipMessage(`➕ Added "${song.title}" to queue`)
  );
}

// ----------------------------
// 🎵 NOW PLAYING
// ----------------------------
function handleNowPlaying(roomId, io) {
  const state = getRoomState(roomId);

  if (!state?.currentSong) {
    return io.to(roomId).emit("chip:message",
      chipMessage("⚠️ Nothing is playing")
    );
  }

  io.to(roomId).emit("chip:message",
    chipMessage(`🎵 Now Playing: "${state.currentSong.title}"`)
  );
}

// ----------------------------
// 🔀 SHUFFLE
// ----------------------------
function handleShuffle(roomId, io) {
  const state = getRoomState(roomId);

  if (!state?.queue?.length) return;

  const shuffled = state.queue.sort(() => Math.random() - 0.5);

  updateRoomState(roomId, { queue: shuffled });

  io.to(roomId).emit("chip:message",
    chipMessage("🔀 Queue shuffled")
  );
}