import express from 'express';
import supabase from '../supabase.js';

const router = express.Router();

// rooms Map is injected here to avoid circular imports
let roomsRef = null;
export function setRoomsRef(r) { roomsRef = r; }

// GET /api/lobby — public rooms with live member count
router.get('/', async (req, res) => {
  try {
    const { topic } = req.query;
    let query = supabase
      .from('rooms')
      .select('id,name,code,topic,max_members,created_at,access_mode')
      .eq('is_public', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(30);
    if (topic && topic !== 'All') query = query.eq('topic', topic);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const enriched = (data || []).map(r => ({
      ...r,
      member_count: roomsRef?.has(r.code) ? roomsRef.get(r.code).users.size : 0
    }));

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
