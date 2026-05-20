import express from 'express';
import auth from '../middleware/auth.js';
import { Chat, ChatUser, Message } from '../models/chat.js';

const router = express.Router();

// ── Helper: get or create a ChatUser mirror from Supabase user ───────────
async function getOrCreateChatUser(supabaseUser) {
  return ChatUser.findOneAndUpdate(
    { supabaseId: supabaseUser.id },
    { name: supabaseUser.name, avatar_url: supabaseUser.avatar_url || null },
    { upsert: true, new: true }
  );
}

// ── GET /api/chat — list my chats ─────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const me = await getOrCreateChatUser(req.user);
    const chats = await Chat.find({ participants: me._id })
      .populate('participants', 'supabaseId name avatar_url')
      .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name supabaseId' } })
      .sort({ lastMessageAt: -1 });

    const result = chats.map(c => {
      const other = c.isGroup ? null : c.participants.find(p => p._id.toString() !== me._id.toString());
      return {
        _id: c._id,
        isGroup: c.isGroup,
        name: c.isGroup ? c.name : other?.name,
        avatar: c.avatar || null,
        participants: c.participants,
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        other_user: other ? { id: other.supabaseId, name: other.name, avatar_url: other.avatar_url } : null,
      };
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/chat/dm/:supabaseUserId — get or create DM ─────────────────
router.post('/dm/:supabaseUserId', auth, async (req, res) => {
  try {
    const me = await getOrCreateChatUser(req.user);
    if (req.params.supabaseUserId === req.user.id)
      return res.status(400).json({ error: 'Cannot DM yourself' });

    // Get or create the other user's ChatUser record
    const other = await ChatUser.findOne({ supabaseId: req.params.supabaseUserId });
    if (!other) return res.status(404).json({ error: 'User not found in chat system' });

    const sorted = [me._id, other._id].sort((a, b) => a.toString().localeCompare(b.toString()));

    const chat = await Chat.findOneAndUpdate(
      { participants: { $all: sorted }, isGroup: false },
      { $setOnInsert: { participants: sorted, isGroup: false } },
      { upsert: true, new: true }
    ).populate('participants', 'supabaseId name avatar_url');

    if (req.io) req.io.to(`user:${req.params.supabaseUserId}`).emit('chat-created', { chatId: chat._id });
    res.json({ _id: chat._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/chat/group — create group chat ──────────────────────────────
router.post('/group', auth, async (req, res) => {
  try {
    const { name, member_supabase_ids = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Group name required' });

    const me = await getOrCreateChatUser(req.user);
    const memberDocs = await Promise.all(
      member_supabase_ids.map(sid => ChatUser.findOne({ supabaseId: sid }))
    );
    const validMembers = memberDocs.filter(Boolean);
    const allIds = [...new Set([me._id.toString(), ...validMembers.map(m => m._id.toString())])];

    const chat = await Chat.create({ isGroup: true, name: name.trim(), participants: allIds, admins: [me._id] });

    if (req.io) {
      validMembers.forEach(m => req.io.to(`user:${m.supabaseId}`).emit('chat-created', { chatId: chat._id }));
    }
    res.json({ _id: chat._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/chat/:chatId/messages — paginated ────────────────────────────
router.get('/:chatId/messages', auth, async (req, res) => {
  try {
    const me = await getOrCreateChatUser(req.user);
    const chat = await Chat.findOne({ _id: req.params.chatId, participants: me._id });
    if (!chat) return res.status(403).json({ error: 'Not a participant' });

    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before ? new Date(req.query.before) : null;

    let query = Message.find({ chat: chat._id, ...(before ? { createdAt: { $lt: before } } : {}) })
      .populate('sender', 'supabaseId name avatar_url')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: 'name' } })
      .sort({ createdAt: -1 })
      .limit(limit);

    const messages = await query;
    res.json(messages.reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/chat/:chatId/react — toggle emoji reaction ──────────────────
router.post('/:chatId/react', auth, async (req, res) => {
  try {
    const { message_id, emoji } = req.body;
    const me = await getOrCreateChatUser(req.user);

    const msg = await Message.findById(message_id);
    if (!msg) return res.status(404).json({ error: 'Not found' });

    const existing = msg.reactions.find(r => r.emoji === emoji && r.userId.toString() === me._id.toString());
    if (existing) {
      msg.reactions = msg.reactions.filter(r => !(r.emoji === emoji && r.userId.toString() === me._id.toString()));
      await msg.save();
      if (req.io) req.io.to(`chat:${req.params.chatId}`).emit('reaction-removed', { message_id, user_id: req.user.id, emoji });
    } else {
      msg.reactions.push({ emoji, userId: me._id });
      await msg.save();
      if (req.io) req.io.to(`chat:${req.params.chatId}`).emit('reaction-added', { message_id, user_id: req.user.id, emoji, name: me.name });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/chat/:chatId/messages/:msgId — soft delete ───────────────
router.delete('/:chatId/messages/:msgId', auth, async (req, res) => {
  try {
    const me = await getOrCreateChatUser(req.user);
    const msg = await Message.findById(req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.sender.toString() !== me._id.toString()) return res.status(403).json({ error: 'Forbidden' });

    msg.isDeleted = true; msg.text = ''; await msg.save();
    if (req.io) req.io.to(`chat:${req.params.chatId}`).emit('message-deleted', { message_id: req.params.msgId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
