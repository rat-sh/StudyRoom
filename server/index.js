import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import lobbyRoutes from './routes/lobby.js';
import fileRoutes from './routes/features/files.js';
import timerRoutes from './routes/features/timer.js';
// whiteboard replaced by drawguess
import musicRoutes from './routes/music.js';
import userRoutes from './routes/users.js';
import friendRoutes from './routes/friends.js';
import todoRoutes from './routes/todos.js';
import activityRoutes from './routes/activity.js';
import chatRoutes from './routes/chat.js';
import mediaRoutes from './routes/media.js';
import chessRoutes from './routes/chess.js';
import { setupCoreHandlers } from './socket/core.js';
import { connectMongo } from './mongo.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', authRoutes);
// Inject socket.io into every request so routes can emit realtime events
app.use((req, _res, next) => { req.io = io; next(); });
app.use('/api/rooms', roomRoutes);
app.use('/api/lobby', lobbyRoutes);
app.use('/api/features/files', fileRoutes);
app.use('/api/features/timer', timerRoutes);
// whiteboard replaced by drawguess
app.use('/api/music', musicRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/todos', todoRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/chess', chessRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/dashboard.html')));
app.get('/lobby', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/lobby.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/join.html')));
app.get('/join/:code', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/join.html')));
app.get('/room/:code', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/room.html')));
app.get('/chess', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/chess.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/chat.html')));
app.get('/chat/:chatId', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/chat.html')));
app.get('/presenter/:code', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/presenter.html')));

// ── Health check endpoint (for UptimeRobot / Render keep-alive) ──
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

setupCoreHandlers(io);
connectMongo();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`StudyRoom → http://localhost:${PORT}`);

  // ── Self-ping keep-alive (prevents Render free-tier 15-min sleep) ──
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL; // Render sets this automatically
  if (RENDER_URL) {
    setInterval(() => {
      fetch(`${RENDER_URL}/health`).catch(() => {});
    }, 13 * 60 * 1000); // every 13 minutes
    console.log(`Keep-alive ping → ${RENDER_URL}/health every 13m`);
  }
});
