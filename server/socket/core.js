import jwt from 'jsonwebtoken';
import whiteboardHandler from './features/whiteboard.js';
import timerHandler from './features/timer.js';
import reactionsHandler from './features/reactions.js';
import musicHandler from './features/music.js';

const JWT_SECRET = process.env.JWT_SECRET || 'studyroom-secret';
const log = process.env.NODE_ENV !== 'production' ? console.log : () => {};

// ── ICE CONFIG ────────────────────────────────────────────────────────────
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: process.env.TURN_URL || 'turn:openrelay.metered.ca:80',
      username: process.env.TURN_USERNAME || 'openrelayproject',
      credential: process.env.TURN_CREDENTIAL || 'openrelayproject'
    },
    {
      urls: process.env.TURN_URL_TCP || 'turn:openrelay.metered.ca:443',
      username: process.env.TURN_USERNAME || 'openrelayproject',
      credential: process.env.TURN_CREDENTIAL || 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

// ── SHARED STATE ──────────────────────────────────────────────────────────
export const rooms = new Map();
export const musicState = new Map();
export const timers = new Map();
export const handQueues = new Map();
const notesState = new Map();

// ── GLOBAL STALE-STATE CLEANUP ────────────────────────────────────────────
setInterval(() => {
  for (const [code] of musicState) { if (!rooms.has(code)) musicState.delete(code); }
  for (const [code, t] of timers) {
    if (!rooms.has(code)) { clearInterval(t.interval); timers.delete(code); }
  }
  for (const [code] of handQueues) { if (!rooms.has(code)) handQueues.delete(code); }
  for (const [code] of notesState) { if (!rooms.has(code)) notesState.delete(code); }
}, 30 * 60 * 1000);

function cleanupRoom(roomCode) {
  rooms.delete(roomCode);
  musicState.delete(roomCode);
  notesState.delete(roomCode);
  if (timers.has(roomCode)) { clearInterval(timers.get(roomCode).interval); timers.delete(roomCode); }
  handQueues.delete(roomCode);
  log('[room] cleaned up', roomCode);
}

// ── SETUP ─────────────────────────────────────────────────────────────────
export function setupCoreHandlers(io) {
  // Feature handlers
  whiteboardHandler(io, rooms);
  timerHandler(io, rooms, timers);
  reactionsHandler(io, rooms, handQueues);
  musicHandler(io, rooms, musicState);

  // Auth middleware
  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers?.cookie || '';
    const cookieToken = cookieHeader.split(';').find(c => c.trim().startsWith('sr_token='))?.split('=')[1];
    const token = socket.handshake.auth?.token || cookieToken;
    if (token) {
      try { socket.data.jwtUser = jwt.verify(token, JWT_SECRET); } catch (_) {}
    }
    socket.data.isAuthenticated = !!socket.data.jwtUser;
    next();
  });

  io.on('connection', (socket) => {
    log('[socket] connected:', socket.id);

    // ── LOBBY WATCHERS ─────────────────────────────────────────────
    socket.on('join-lobby', () => socket.join('lobby-watchers'));

    // ── JOIN ROOM ──────────────────────────────────────────────────
    socket.on('join-room', ({ roomCode, user }) => {
      if (!roomCode) return;
      const code = roomCode.toUpperCase();
      socket.join(code);
      if (!rooms.has(code)) rooms.set(code, { users: new Map() });
      rooms.get(code).users.set(socket.id, {
        name: user?.name || 'Guest', id: user?.id || null, guest: user?.guest || false
      });
      socket.data = { ...socket.data, roomCode: code, user };
      socket.to(code).emit('user-joined', { socketId: socket.id, user });
      const peers = [];
      rooms.get(code).users.forEach((u, sid) => { if (sid !== socket.id) peers.push({ socketId: sid, user: u }); });
      socket.emit('room-peers', peers);
      socket.emit('ice-config', ICE_CONFIG);
      io.to(code).emit('room-count', rooms.get(code).users.size);
      io.to('lobby-watchers').emit('lobby-update');
    });

    // ── JOIN REQUEST (authorized rooms) ────────────────────────────
    socket.on('join-request', ({ roomCode, user }) => {
      if (!roomCode) return;
      socket.to(roomCode.toUpperCase()).emit('join-request', { socketId: socket.id, user });
    });
    socket.on('join-approve', ({ targetSocketId }) => io.to(targetSocketId).emit('join-approved'));
    socket.on('join-deny', ({ targetSocketId }) => io.to(targetSocketId).emit('join-denied'));

    // ── WebRTC ─────────────────────────────────────────────────────
    socket.on('offer', ({ to, offer }) => io.to(to).emit('offer', { from: socket.id, offer }));
    socket.on('answer', ({ to, answer }) => io.to(to).emit('answer', { from: socket.id, answer }));
    socket.on('ice-candidate', ({ to, candidate }) => io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

    // ── CURSOR ─────────────────────────────────────────────────────
    socket.on('cursor-move', ({ roomCode, x, y }) => {
      if (!roomCode) return;
      socket.to(roomCode).emit('cursor-move', { socketId: socket.id, name: socket.data?.user?.name, x, y });
    });

    // ── CHAT ───────────────────────────────────────────────────────
    socket.on('chat-message', ({ roomCode, message }) => {
      if (!roomCode || !message || typeof message !== 'string') return;
      io.to(roomCode).emit('chat-message', {
        socketId: socket.id,
        name: socket.data?.user?.name || 'Guest',
        message: message.slice(0, 500),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    });

    // ── MEDIA STATE ────────────────────────────────────────────────
    socket.on('media-state', ({ roomCode, video, audio }) => {
      if (!roomCode) return;
      socket.to(roomCode).emit('peer-media-state', { socketId: socket.id, video, audio });
    });

    // ── NOTES ──────────────────────────────────────────────────────
    socket.on('notes-update', ({ roomCode, content }) => {
      if (!roomCode || typeof content !== 'string') return;
      notesState.set(roomCode, content);
      socket.to(roomCode).emit('notes-sync', { content });
    });
    socket.on('notes-request', ({ roomCode }) => {
      if (!roomCode) return;
      socket.emit('notes-sync', { content: notesState.get(roomCode) || '' });
    });
    socket.on('notes-clear', ({ roomCode }) => {
      if (!roomCode) return;
      notesState.set(roomCode, '');
      io.to(roomCode).emit('notes-sync', { content: '' });
    });

    // ── ROOM DELETED BROADCAST ─────────────────────────────────────
    socket.on('room-deleted-broadcast', ({ roomCode }) => {
      if (!roomCode) return;
      io.to(roomCode).emit('room-deleted');
    });

    // ── DISCONNECT ─────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const { roomCode } = socket.data || {};
      if (!roomCode || !rooms.has(roomCode)) return;
      rooms.get(roomCode).users.delete(socket.id);
      socket.to(roomCode).emit('user-left', { socketId: socket.id });
      const count = rooms.get(roomCode).users.size;
      io.to(roomCode).emit('room-count', count);
      if (count === 0) cleanupRoom(roomCode);
      io.to('lobby-watchers').emit('lobby-update');
    });
  });
}
