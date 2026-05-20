import mongoose, { Schema } from 'mongoose';

// ── Chat (DMs + Groups) — copied from GrouPMeet, adapted to JS ────────────
const ChatSchema = new Schema({
  participants: [{ type: Schema.Types.ObjectId, ref: 'ChatUser', required: true }],
  lastMessage:  { type: Schema.Types.ObjectId, ref: 'Message', default: null },
  lastMessageAt:{ type: Date, default: Date.now },
  isGroup:      { type: Boolean, default: false },
  name:         { type: String, trim: true },
  avatar:       { type: String },
  admins:       [{ type: Schema.Types.ObjectId, ref: 'ChatUser' }],
}, { timestamps: true });

// Normalize DM participant order so [A,B] and [B,A] are the same index entry
ChatSchema.pre('save', function () {
  if (!this.isGroup && this.isModified('participants')) {
    this.participants.sort((a, b) => a.toString().localeCompare(b.toString()));
  }
});

// Unique index only for DM chats
ChatSchema.index(
  { participants: 1 },
  { unique: true, partialFilterExpression: { isGroup: false } }
);

// ── ChatUser — lightweight user mirror (supabase uid → mongo ref) ─────────
// We DON'T duplicate all user data — just enough for display.
const ChatUserSchema = new Schema({
  supabaseId:  { type: String, required: true, unique: true, index: true },
  name:        { type: String, required: true },
  avatar_url:  { type: String, default: null },
}, { timestamps: true });

// ── Message — copied from GrouPMeet ──────────────────────────────────────
const MessageSchema = new Schema({
  chat:        { type: Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
  sender:      { type: Schema.Types.ObjectId, ref: 'ChatUser', required: true },
  text:        { type: String, default: '', trim: true },
  replyTo:     { type: Schema.Types.ObjectId, ref: 'Message', default: null },
  attachments: [{ type: String }],
  isDeleted:   { type: Boolean, default: false },
  reactions:   [{
    emoji:  { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'ChatUser' },
  }],
}, { timestamps: true });

MessageSchema.index({ chat: 1, createdAt: 1 });

export const Chat     = mongoose.model('Chat',     ChatSchema);
export const ChatUser = mongoose.model('ChatUser', ChatUserSchema);
export const Message  = mongoose.model('Message',  MessageSchema);
