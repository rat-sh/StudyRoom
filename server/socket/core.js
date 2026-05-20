import whiteboardHandler from './features/whiteboard.js';
import timerHandler from './features/timer.js';
import reactionsHandler from './features/reactions.js';
import musicHandler from './features/music.js';
import gamesHandler from './features/games.js';
import chatSocketHandler from './features/chat.js';
import chessHandler from './features/chess.js';
import { logActivity } from '../routes/activity.js';

const rooms = new Map();
// Track join time per socket so we can compute session duration on disconnect
const joinTime = new Map();

export function setupCoreHandlers(io) {
  whiteboardHandler(io, rooms);
  timerHandler(io, rooms);
  reactionsHandler(io, rooms);
  musicHandler(io, rooms);
  gamesHandler(io, rooms);
  chatSocketHandler(io);
  chessHandler(io);

  io.on('connection', (socket) => {

    socket.on('join-room', ({ roomCode, user }) => {
      // Check if banned
      if (rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        if (room.banned && (room.banned.has(user?.id) || room.banned.has(socket.handshake.address))) {
          socket.emit('you-were-kicked', { reason: 'banned' });
          return;
        }
      }

      socket.join(roomCode);
      // ── Personal room so server can target this user directly ──
      if (user?.id) socket.join(`user:${user.id}`);

      if (!rooms.has(roomCode)) rooms.set(roomCode, { users: new Map(), ownerSocketId: socket.id });
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

    // ── Dashboard personal room join (users not in a room) ────────
    socket.on('join-user-room', ({ userId }) => {
      if (userId) socket.join(`user:${userId}`);
    });

    // ── Todo room subscription (for live progress updates) ────────
    socket.on('todo-subscribe', ({ todoId }) => {
      socket.join(`todo:${todoId}`);
    });
    socket.on('todo-unsubscribe', ({ todoId }) => {
      socket.leave(`todo:${todoId}`);
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

    // ── Moderation (owner only) ────────────────────────────────────
    socket.on('mod-kick', ({ roomCode, targetSocketId }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      if (room.ownerSocketId && room.ownerSocketId !== socket.id) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket) return;
      targetSocket.emit('you-were-kicked');
      targetSocket.leave(roomCode);
      room.users.delete(targetSocketId);
      io.to(roomCode).emit('user-left', { socketId: targetSocketId });
      io.to(roomCode).emit('room-count', room.users.size);
    });

    socket.on('mod-timeout', ({ roomCode, targetSocketId }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      if (room.ownerSocketId && room.ownerSocketId !== socket.id) return;
      
      // Add to banned set
      if (!room.banned) room.banned = new Set();
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        if (targetSocket.data?.user?.id) room.banned.add(targetSocket.data.user.id);
        room.banned.add(targetSocket.handshake.address); // IP fallback
        targetSocket.emit('you-were-kicked', { reason: 'timeout' });
        targetSocket.leave(roomCode);
      }
      room.users.delete(targetSocketId);
      io.to(roomCode).emit('user-left', { socketId: targetSocketId });
      io.to(roomCode).emit('room-count', room.users.size);
    });

    socket.on('mod-mute', ({ roomCode, targetSocketId }) => {
      const room = rooms.get(roomCode);
      if (!room || (room.ownerSocketId && room.ownerSocketId !== socket.id)) return;
      io.sockets.sockets.get(targetSocketId)?.emit('you-were-muted');
    });

    socket.on('mod-stop-share', ({ roomCode, targetSocketId }) => {
      const room = rooms.get(roomCode);
      if (!room || (room.ownerSocketId && room.ownerSocketId !== socket.id)) return;
      io.sockets.sockets.get(targetSocketId)?.emit('you-were-unshared');
    });

    // ── Protected Room: request to join ────────────────────────────────────
    socket.on('room-join-request', ({ roomCode, requesterName, requesterId, message }) => {
      // Forward to the room owner's personal socket room
      // The owner's socket joins `user:<ownerId>` on dashboard load
      // We broadcast to the full room so the owner (who is in the room) sees it
      socket.to(roomCode).emit('room-join-request-incoming', {
        roomCode,
        requesterId,
        requesterName,
        message: message || '',
        requestedAt: new Date().toISOString(),
      });
      // Also notify via personal user room if owner is on dashboard
      if (socket.data?.roomOwnerUserId) {
        socket.to(`user:${socket.data.roomOwnerUserId}`).emit('room-join-request-incoming', {
          roomCode, requesterId, requesterName, message: message || '',
          requestedAt: new Date().toISOString(),
        });
      }
    });

    // ── Protected Room: owner responds ─────────────────────────────────────
    socket.on('room-request-respond', ({ requesterId, roomCode, decision, pin }) => {
      // decision: 'accepted' | 'rejected'
      socket.to(`user:${requesterId}`).emit('room-request-decision', {
        roomCode,
        decision,
        pin: decision === 'accepted' ? pin : null,
      });
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