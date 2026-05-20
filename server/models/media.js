import mongoose, { Schema } from 'mongoose';

const MediaSchema = new Schema({
  uploader: { type: Schema.Types.ObjectId, ref: 'ChatUser', required: true },
  fileName: { type: String, required: true },
  fileType: { type: String, required: true }, // 'image', 'video', 'audio', 'pdf', 'code', 'link', 'other'
  mimeType: { type: String },
  fileSize: { type: Number, default: 0 },     // in bytes
  data:     { type: String, required: true }, // base64 string or URL
  source:   { type: String, enum: ['chat', 'room', 'direct'], default: 'direct' },
  chatId:   { type: Schema.Types.ObjectId, ref: 'Chat', default: null },
  roomCode: { type: String, default: null },
  starredBy:[{ type: Schema.Types.ObjectId, ref: 'ChatUser' }],
}, { timestamps: true });

MediaSchema.index({ uploader: 1 });
MediaSchema.index({ source: 1 });
MediaSchema.index({ fileType: 1 });
MediaSchema.index({ createdAt: -1 });

export const Media = mongoose.model('Media', MediaSchema);
