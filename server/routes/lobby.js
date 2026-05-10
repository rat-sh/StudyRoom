import express from 'express';
import supabase from '../supabase.js';

const router = express.Router();

router.get('/rooms', async (req, res) => {
  try {
    const { topic } = req.query;
    let query = supabase.from('rooms').select('id,name,code,topic,max_members,created_at')
      .eq('is_public', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
    if (topic && topic !== 'All') query = query.eq('topic', topic);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
