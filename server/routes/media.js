import express from 'express';
import { Media } from '../models/media.js';
import { ChatUser } from '../models/chat.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Helper to ensure mongo user exists (like in chat)
async function getMongoUser(supabaseId, req) {
  let user = await ChatUser.findOne({ supabaseId });
  if (!user && req.user) {
    user = await ChatUser.create({
      supabaseId,
      name: req.user.name || 'User',
      avatar_url: req.user.avatar_url || null
    });
  }
  return user;
}

// Upload Media
router.post('/upload', auth, async (req, res) => {
  try {
    const { fileName, fileType, mimeType, fileSize, data, source, roomCode, chatId } = req.body;
    
    // We expect payload limit to be increased in express if base64 is large
    // The server/index.js should have express.json({limit: '50mb'})
    
    const user = await getMongoUser(req.user.id, req);
    if (!user) return res.status(401).json({ error: 'User sync failed' });

    const media = new Media({
      uploader: user._id,
      fileName,
      fileType,
      mimeType,
      fileSize,
      data,
      source: source || 'direct',
      roomCode: roomCode || null,
      chatId: chatId || null
    });
    
    await media.save();
    
    const populated = await media.populate('uploader', 'name avatar_url');
    req.io.emit('FILE_UPLOADED', populated);
    if (source === 'chat') req.io.emit('MEDIA_SHARED', populated);
    
    res.status(201).json(populated);
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// Search & Filter Media
router.get('/', auth, async (req, res) => {
  try {
    const { tab, search, room, uploader, date } = req.query;
    const user = await getMongoUser(req.user.id, req);
    if (!user) return res.status(401).json({ error: 'User sync failed' });

    let query = {};

    if (tab && tab !== 'all') {
      if (tab === 'starred') {
        query.starredBy = user._id;
      } else if (tab === 'images') {
        query.fileType = 'image';
      } else if (tab === 'videos') {
        query.fileType = 'video';
      } else if (tab === 'audio') {
        query.fileType = 'audio';
      } else if (tab === 'files') {
        query.fileType = { $in: ['pdf', 'doc', 'code', 'other'] };
      } else if (tab === 'links') {
        query.fileType = 'link';
      } else if (tab === 'chat') {
        query.source = 'chat';
      } else if (tab === 'room') {
        query.source = 'room';
      } else if (tab === 'recent') {
        query.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }; // Last 7 days
      }
    }

    if (date) {
      const now = new Date();
      const startOfDay = new Date(now.setHours(0,0,0,0));
      
      if (date === 'today') {
        query.createdAt = { $gte: startOfDay };
      } else if (date === 'yesterday') {
        const startOfYesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
        query.createdAt = { $gte: startOfYesterday, $lt: startOfDay };
      } else if (date === 'week') {
        query.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
      } else if (date === 'month') {
        query.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
      }
    }

    if (search) {
      query.fileName = { $regex: search, $options: 'i' };
    }

    if (room) {
      query.roomCode = room;
    }
    
    if (uploader) {
      const uploaderUser = await ChatUser.findOne({ name: { $regex: uploader, $options: 'i' } });
      if (uploaderUser) {
        query.uploader = uploaderUser._id;
      }
    }

    let sortQ = { createdAt: -1 };
    if (tab === 'largest') {
      sortQ = { fileSize: -1 };
    }

    const items = await Media.find(query)
      .populate('uploader', 'name avatar_url')
      .sort(sortQ)
      .limit(100);

    // Calculate total storage for the user across all their files
    const stats = await Media.aggregate([
      { $match: { uploader: user._id } },
      { $group: { _id: null, totalBytes: { $sum: '$fileSize' } } }
    ]);
    const storageUsed = stats.length > 0 ? stats[0].totalBytes : 0;

    res.json({ items, storageUsed });
  } catch (error) {
    console.error('Fetch Media Error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// Toggle Star
router.post('/:id/star', auth, async (req, res) => {
  try {
    const user = await getMongoUser(req.user.id, req);
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });

    const isStarred = media.starredBy.includes(user._id);
    if (isStarred) {
      media.starredBy.pull(user._id);
    } else {
      media.starredBy.push(user._id);
    }
    await media.save();
    res.json({ starred: !isStarred });
  } catch (error) {
    res.status(500).json({ error: 'Failed to star media' });
  }
});

// Rename Media
router.post('/:id/rename', auth, async (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName || !newName.trim()) return res.status(400).json({ error: 'Name is required' });

    const user = await getMongoUser(req.user.id, req);
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });

    if (media.uploader.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to rename this media' });
    }

    media.fileName = newName.trim();
    await media.save();
    
    // Broadcast edit so clients refresh
    req.io.emit('FILE_EDITED', { id: req.params.id, fileName: media.fileName });
    res.json({ success: true, fileName: media.fileName });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename media' });
  }
});

// Delete Media
router.delete('/:id', auth, async (req, res) => {
  try {
    const user = await getMongoUser(req.user.id, req);
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });

    if (media.uploader.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to delete this media' });
    }

    await Media.findByIdAndDelete(req.params.id);
    req.io.emit('FILE_DELETED', { id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

export default router;
