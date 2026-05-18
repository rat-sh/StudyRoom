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
import whiteboardRoutes from './routes/features/whiteboard.js';
import musicRoutes from './routes/music.js';
import userRoutes from './routes/users.js';
import friendRoutes from './routes/friends.js';
import todoRoutes from './routes/todos.js';
import activityRoutes from './routes/activity.js';
import { setupCoreHandlers } from './socket/core.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/lobby', lobbyRoutes);
app.use('/api/features/files', fileRoutes);
app.use('/api/features/timer', timerRoutes);
app.use('/api/features/whiteboard', whiteboardRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/todos', todoRoutes);
app.use('/api/activity', activityRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/dashboard.html')));
app.get('/lobby', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/lobby.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/join.html')));
app.get('/join/:code', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/join.html')));
app.get('/room/:code', (req, res) => res.sendFile(path.join(__dirname, '../public/core/pages/room.html')));

setupCoreHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`StudyRoom → http://localhost:${PORT}`));
 

