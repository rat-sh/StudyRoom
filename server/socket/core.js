import whiteboardHandler from './features/whiteboard.js';
import timerHandler from './features/timer.js';
import reactionsHandler from './features/reactions.js';
import musicHandler from './features/music.js';
import { logActivity } from '../routes/activity.js';

const rooms = new Map();
// Track join time per socket so we can compute session duration on disconnect
const joinTime = new Map();

export function setupCoreHandlers(io) {
  whiteboardHandler(io, rooms);
  timerHandler(io, rooms);
  reactionsHandler(io, rooms);
  musicHandler(io, rooms);

  io.on('connection', (socket) => {

    socket.on('join-room', ({ roomCode, user }) => {
      socket.join(roomCode);
      if (!rooms.has(roomCode)) rooms.set(roomCode, { users: new Map() });
      rooms.get(roomCode).users.set(socket.id, { name: user.name, id: user.id || null, guest: user.guest || false });
      socket.data = { roomCode, user };
      joinTime.set(socket.id, Date.now());

      socket.to(roomCode).emit('user-joined', { socketId: socket.id, user });

      const peers = [];
      rooms.get(roomCode).users.forEach((u, sid) => {
        if (sid !== socket.id) peers.push({ socketId: sid, user: u });
      });
      socket.emit('room-peers', peers);
      io.to(roomCode).emit('room-count', rooms.get(roomCode).users.size);
    });

    socket.on('offer', ({ to, offer, renegotiate }) =>
      io.to(to).emit('offer', { from: socket.id, offer, renegotiate }));
    socket.on('answer', ({ to, answer }) =>
      io.to(to).emit('answer', { from: socket.id, answer }));
    socket.on('ice-candidate', ({ to, candidate }) =>
      io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

    socket.on('cursor-move', ({ roomCode, x, y }) => {
      socket.to(roomCode).emit('cursor-move', { socketId: socket.id, name: socket.data?.user?.name, x, y });
    });

    socket.on('chat-message', ({ roomCode, message }) => {
      io.to(roomCode).emit('chat-message', {
        socketId: socket.id,
        name: socket.data?.user?.name,
        message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    });

    socket.on('media-state', ({ roomCode, video, audio }) => {
      socket.to(roomCode).emit('peer-media-state', { socketId: socket.id, video, audio });
    });

    // ── Screen Share Spotlight ─────────────────────────────────────
    // When a peer starts screen sharing, notify all others so they can
    // auto-pin that peer's tile as the "spotlight".
    socket.on('screen-share-started', ({ roomCode }) => {
      socket.to(roomCode).emit('peer-screen-share-started', { socketId: socket.id });
    });
    socket.on('screen-share-stopped', ({ roomCode }) => {
      socket.to(roomCode).emit('peer-screen-share-stopped', { socketId: socket.id });
    });

    socket.on('disconnect', async () => {
      const { roomCode, user } = socket.data || {};
      if (!roomCode || !rooms.has(roomCode)) return;

      // Log activity duration for authenticated users
      const started = joinTime.get(socket.id);
      if (started && user?.id) {
        const durationMinutes = Math.floor((Date.now() - started) / 60000);
        await logActivity(user.id, durationMinutes, roomCode);
      }
      joinTime.delete(socket.id);

      rooms.get(roomCode).users.delete(socket.id);
      socket.to(roomCode).emit('user-left', { socketId: socket.id });
      const count = rooms.get(roomCode).users.size;
      io.to(roomCode).emit('room-count', count);
      if (count === 0) rooms.delete(roomCode);
    });
  });
}