import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';
import { getRoomUserCount } from '../socket/core.js';

const router = express.Router();

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 6}, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ── Helper: get accepted friend ids for a user ─────────────────
async function getFriendIds(userId) {
  const { data } = await supabase
    .from('friends')
    .select('user_id_1, user_id_2')
    .eq('status', 'accepted')
    .or(`user_id_1.eq.${userId},user_id_2.eq.${userId}`);
  if (!data) return new Set();
  return new Set(data.map(f => f.user_id_1 === userId ? f.user_id_2 : f.user_id_1));
}

// ── CREATE ─────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { name, visibility, topic, max_members } = req.body;
    // Support legacy is_public field
    const vis = visibility || (req.body.is_public ? 'public' : 'private');
    if (!['public', 'protected', 'private'].includes(vis)) {
      return res.status(400).json({ error: 'Invalid visibility. Use public, protected, or private.' });
    }

    const code = genCode();
    const pin  = genPin();
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase.from('rooms')
      .insert([{
        name:        name || 'Study Room',
        code, pin,
        is_public:   vis === 'public',
        visibility:  vis,
        topic:       topic || 'General',
        max_members: max_members || 10,
        created_by:  req.user.id,
        owner_id:    req.user.id,
        expires_at
      }])
      .select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VALIDATE (PIN-based join) ──────────────────────────────────
router.post('/validate', async (req, res) => {
  try {
    const { code, pin } = req.body;
    const { data, error } = await supabase.from('rooms').select('*').eq('code', code.toUpperCase()).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Room expired' });
    if (data.pin !== pin) return res.status(401).json({ error: 'Wrong PIN' });
    res.json({ code: data.code, name: data.name, topic: data.topic, visibility: data.visibility });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── JOIN PUBLIC (no PIN) ───────────────────────────────────────
router.post('/join-public', async (req, res) => {
  try {
    const { code } = req.body;
    const { data, error } = await supabase.from('rooms').select('*').eq('code', code.toUpperCase()).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (data.visibility !== 'public') return res.status(403).json({ error: 'This room is not public' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Room expired' });
    res.json({ code: data.code, name: data.name, topic: data.topic, visibility: data.visibility });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUBLIC ACTIVE ROOMS ───────────────────────────────────────
router.get('/public-active', async (req, res) => {
  try {
    const { data, error } = await supabase.from('rooms')
      .select('code, name, topic, max_members, created_at')
      .eq('visibility', 'public')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) return res.status(500).json({ error: error.message });
    const augmentedData = (data || []).map(r => ({
      ...r,
      userCount: getRoomUserCount(r.code)
    }));
    res.json(augmentedData);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MY ROOMS ───────────────────────────────────────────────────
router.get('/mine', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('rooms').select('*')
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FRIENDS' VISIBLE ROOMS ─────────────────────────────────────
// Returns rooms created by friends that are public OR protected
router.get('/friends-activity', auth, async (req, res) => {
  try {
    const friendIds = await getFriendIds(req.user.id);
    if (!friendIds.size) return res.json([]);

    const { data, error } = await supabase.from('rooms')
      .select('*')
      .in('created_by', [...friendIds])
      .in('visibility', ['public', 'protected'])
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ROOM INFO ─────────────────────────────────────────────────
// Privacy-enforced: private rooms return minimal info to non-owners
router.get('/info/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { data, error } = await supabase.from('rooms').select('*').eq('code', code).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Room expired' });

    // Decode caller identity
    let callerId = null;
    let isCreator = false;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const jwt = (await import('jsonwebtoken')).default;
        const JWT_SECRET = process.env.JWT_SECRET || 'studyroom-secret';
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        callerId = decoded.id;
        isCreator = callerId === data.created_by;
      } catch { /* unauthenticated */ }
    }

    // Private rooms: return almost nothing to non-creators
    if (data.visibility === 'private' && !isCreator) {
      return res.json({
        code: data.code,
        visibility: 'private',
        name: null,   // hidden
        topic: null,
        is_public: false,
        expires_at: null,
        created_by: null,
        pin: null,
      });
    }

    // Protected rooms: check friendship for the PIN hint
    let friendAccess = false;
    if (callerId && data.visibility === 'protected') {
      const friendIds = await getFriendIds(callerId);
      friendAccess = friendIds.has(data.created_by);
    }

    res.json({
      code: data.code,
      name: data.name,
      topic: data.topic,
      is_public: data.is_public,
      visibility: data.visibility || (data.is_public ? 'public' : 'private'),
      expires_at: data.expires_at,
      created_by: data.created_by,
      friend_access: friendAccess,
      pin: isCreator ? data.pin : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PROTECTED: SUBMIT JOIN REQUEST ────────────────────────────
router.post('/request-join', auth, async (req, res) => {
  try {
    const { code, message } = req.body;
    const { data: room, error: rErr } = await supabase
      .from('rooms').select('*').eq('code', code.toUpperCase()).single();
    if (rErr || !room) return res.status(404).json({ error: 'Room not found' });
    if (room.visibility !== 'protected') return res.status(400).json({ error: 'Only protected rooms use join requests' });

    // Must be a friend of the room owner
    const friendIds = await getFriendIds(req.user.id);
    if (!friendIds.has(room.created_by)) {
      return res.status(403).json({ error: 'You must be friends with the room owner to request access' });
    }

    // Upsert the request
    const { data, error } = await supabase
      .from('room_access_requests')
      .upsert({
        room_id:      room.id,
        room_code:    room.code,
        requester_id: req.user.id,
        owner_id:     room.created_by,
        status:       'pending',
        message:      message || null,
      }, { onConflict: 'room_code,requester_id' })
      .select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PROTECTED: RESPOND TO REQUEST ─────────────────────────────
router.post('/respond-request', auth, async (req, res) => {
  try {
    const { requestId, decision } = req.body; // decision: 'accepted' | 'rejected'
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be accepted or rejected' });
    }

    const { data: reqRow, error } = await supabase
      .from('room_access_requests')
      .select('*').eq('id', requestId).single();
    if (error || !reqRow) return res.status(404).json({ error: 'Request not found' });
    if (reqRow.owner_id !== req.user.id) return res.status(403).json({ error: 'Not the room owner' });

    const { data: room } = await supabase
      .from('rooms').select('pin').eq('code', reqRow.room_code).single();

    await supabase.from('room_access_requests')
      .update({ status: decision }).eq('id', requestId);

    res.json({
      decision,
      requester_id: reqRow.requester_id,
      room_code: reqRow.room_code,
      pin: decision === 'accepted' ? room?.pin : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PENDING REQUESTS FOR ME (as owner) ────────────────────────
router.get('/pending-requests', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('room_access_requests')
      .select('*, room:room_code(name,visibility)')
      .eq('owner_id', req.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEARCH USERS (email / username) ───────────────────────────
router.get('/users/search', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, avatar_url')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .neq('id', req.user.id)
      .limit(10);

    if (error) return res.status(500).json({ error: error.message });

    // Augment with friendship status
    const friendIds = await getFriendIds(req.user.id);
    const result = (data || []).map(u => ({
      ...u,
      is_friend: friendIds.has(u.id),
    }));

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE (creator only) ──────────────────────────────────────
router.delete('/:code', auth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { data, error } = await supabase.from('rooms').select('id, created_by').eq('code', code).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    if (data.created_by !== req.user.id) return res.status(403).json({ error: 'Only the creator can delete this room' });

    const { error: delError } = await supabase.from('rooms').delete().eq('code', code);
    if (delError) return res.status(500).json({ error: delError.message });

    if (req.io) {
      req.io.to(code).emit('room-deleted', { code, message: 'This room has been deleted by the owner.' });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
