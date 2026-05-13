import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import lobbyRoutes, { setRoomsRef } from './routes/lobby.js';
import statsRoutes from './routes/stats.js';
import usersRoutes from './routes/users.js';
import fileRoutes from './routes/features/files.js';
import timerRoutes from './routes/features/timer.js';
import whiteboardRoutes from './routes/features/whiteboard.js';
import { setupCoreHandlers } from './socket/core.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── RATE LIMITERS ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts, please try again later' }
});
const pinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: 'Too many PIN attempts' }
});
const musicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Slow down on music requests' }
});

// ── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rooms/validate', pinLimiter);
app.use('/api/rooms', roomRoutes);
app.use('/api/lobby', lobbyRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/features/files', fileRoutes);
app.use('/api/features/timer', timerRoutes);
app.use('/api/features/whiteboard', whiteboardRoutes);
app.use('/api/music', musicLimiter);

// ── PAGE ROUTES ───────────────────────────────────────────────────────────────
const pages = path.join(__dirname, '../public/core/pages');
app.get('/', (req, res) => res.sendFile(path.join(pages, 'splash.html')));
app.get('/login', (req, res) => res.sendFile(path.join(pages, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(pages, 'signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(pages, 'dashboard.html')));
app.get('/lobby', (req, res) => res.sendFile(path.join(pages, 'lobby.html')));
app.get('/join', (req, res) => res.sendFile(path.join(pages, 'join.html')));
app.get('/join/:code', (req, res) => res.sendFile(path.join(pages, 'join.html')));
app.get('/room/:code', (req, res) => res.sendFile(path.join(pages, 'room.html')));
app.get('/room-not-found', (req, res) => res.sendFile(path.join(pages, 'room-not-found.html')));

// ── SOCKET SETUP ─────────────────────────────────────────────────────────────
setupCoreHandlers(io);

// Inject rooms ref into lobby route (after socket init to avoid circular import)
import('./socket/core.js').then(({ rooms }) => setRoomsRef(rooms));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`StudyRoom → http://localhost:${PORT}`));
