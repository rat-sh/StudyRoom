/**
 * Chat + Presence Socket Handler — MongoDB version
 * Adapted directly from GrouPMeet's socket.ts
 * Presence: Map<userId(supabase), Set<socketId>> — multi-device safe
 */
import { Chat, ChatUser, Message } from '../../models/chat.js';

export const onlineUsers = new Map();   // supabaseUserId → Set<socketId>
const socketUserMap      = new Map();   // socketId → supabaseUserId

export function isOnline(userId) { return onlineUsers.has(userId); }
export function getOnlineUserIds() { return [...onlineUsers.keys()]; }

export default function chatSocketHandler(io) {
  io.on('connection', async (socket) => {
    // userId sent from client on connect via auth handshake
    const userId = socket.handshake.auth?.userId;
    if (!userId) return;

    // Personal room (same as GrouPMeet's user:${userId} pattern)
    socket.join(`user:${userId}`);
    socket.emit('online-users', { userIds: [...onlineUsers.keys()] });

    const isFirst = !onlineUsers.has(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socketUserMap.set(socket.id, userId);

    if (isFirst) socket.broadcast.emit('user-online', { userId });

    // ── Join a chat room ─────────────────────────────────────────────────
    socket.on('join-chat', async ({ chatId }) => {
      try {
        const me = await ChatUser.findOne({ supabaseId: userId });
        if (!me) return socket.emit('socket-error', { message: 'User not registered in chat' });

        const chat = await Chat.findOne({ _id: chatId, participants: me._id });
        if (!chat) return socket.emit('socket-error', { message: 'Not authorized for this chat' });

        socket.join(`chat:${chatId}`);
      } catch { socket.emit('socket-error', { message: 'Failed to join chat' }); }
    });

    socket.on('leave-chat', ({ chatId }) => socket.leave(`chat:${chatId}`));

    // ── Send message (GrouPMeet pattern — DB verify, then broadcast) ─────
    socket.on('send-message', async ({ chatId, text, replyToId, attachments = [] }) => {
      try {
        const trimmed = (text || '').trim();
        if (!trimmed && !attachments.length) return;
        if (trimmed.length > 4000) return socket.emit('socket-error', { message: 'Message too long' });

        const me = await ChatUser.findOne({ supabaseId: userId });
        if (!me) return;

        const chat = await Chat.findOne({ _id: chatId, participants: me._id });
        if (!chat) return socket.emit('socket-error', { message: 'Not in this chat' });

        const msg = await Message.create({
          chat: chatId, sender: me._id,
          text: trimmed, replyTo: replyToId || null, attachments,
        });
        await msg.populate('sender', 'supabaseId name avatar_url');
        await msg.populate({ path: 'replyTo', populate: { path: 'sender', select: 'name' } });

        // Cross-System Integration: Sync chat attachments to Media Hub
        if (attachments && attachments.length > 0) {
          const { Media } = await import('../../models/media.js');
          for (const att of attachments) {
            // Check if it's a base64 payload we can index
            if (att.url && att.url.startsWith('data:')) {
              let t = 'other';
              if (att.url.startsWith('data:image')) t = 'image';
              else if (att.url.startsWith('data:video')) t = 'video';
              else if (att.url.startsWith('data:audio')) t = 'audio';
              else if (att.url.includes('pdf')) t = 'pdf';

              const m = await Media.create({
                uploader: me._id,
                fileName: att.name || `Chat_${Date.now()}`,
                fileType: t,
                mimeType: att.url.split(';')[0].split(':')[1] || 'application/octet-stream',
                fileSize: Math.round((att.url.length) * 0.75),
                data: att.url,
                source: 'chat',
                chatId: chatId
              });
              
              const populatedMedia = await m.populate('uploader', 'name avatar_url');
              io.emit('FILE_UPLOADED', populatedMedia);
              io.emit('MEDIA_SHARED', populatedMedia);
            }
          }
        }

        chat.lastMessage = msg._id;
        chat.lastMessageAt = msg.createdAt;
        await chat.save();

        const payload = { ...msg.toObject(), reactions: [] };

        // Broadcast to everyone in chat room
        io.to(`chat:${chatId}`).emit('new-message', payload);

        // Deliver to participants NOT currently in chat room (GrouPMeet pattern)
        const chatRoomSockets = io.sockets.adapter.rooms.get(`chat:${chatId}`) || new Set();
        for (const pid of chat.participants) {
          const pUser = await ChatUser.findById(pid);
          if (!pUser || pUser.supabaseId === userId) continue;
          const theirSockets = onlineUsers.get(pUser.supabaseId);
          if (!theirSockets) continue;
          const alreadyIn = [...theirSockets].some(sid => chatRoomSockets.has(sid));
          if (!alreadyIn) io.to(`user:${pUser.supabaseId}`).emit('new-message', { ...payload, chatId });
        }
      } catch { socket.emit('socket-error', { message: 'Failed to send message' }); }
    });

    // ── Typing (GrouPMeet pattern) ───────────────────────────────────────
    socket.on('typing', async ({ chatId, isTyping }) => {
      const payload = { userId, chatId, isTyping };
      socket.to(`chat:${chatId}`).emit('typing', payload);
      try {
        const me = await ChatUser.findOne({ supabaseId: userId });
        const chat = await Chat.findOne({ _id: chatId, participants: me?._id });
        if (chat) {
          for (const pid of chat.participants) {
            const p = await ChatUser.findById(pid);
            if (p && p.supabaseId !== userId) socket.to(`user:${p.supabaseId}`).emit('typing', payload);
          }
        }
      } catch { /* non-critical */ }
    });

    // ── Status update — PRIVACY ENFORCED ────────────────────────────────
    socket.on('update-status', ({ status, context, visibility }) => {
      if (visibility === 'private') {
        // Private room → never expose room details; appear as "Busy"
        socket.broadcast.emit('user-status', { userId, status: 'busy', context: null });
        return;
      }
      const safeContext = (visibility === 'protected' && context)
        ? { ...context, visibility: 'protected' }
        : (context || null);
      socket.broadcast.emit('user-status', { userId, status, context: safeContext });
    });

    // ── Disconnect (multi-device safe — GrouPMeet pattern) ───────────────
    socket.on('disconnect', () => {
      const resolvedId = socketUserMap.get(socket.id) || userId;
      socketUserMap.delete(socket.id);
      const sockets = onlineUsers.get(resolvedId);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(resolvedId);
        socket.broadcast.emit('user-offline', { userId: resolvedId });
      }
    });
  });
}
