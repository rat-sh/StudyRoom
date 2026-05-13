import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// ── LOG SESSION (called when user leaves a room) ─────────────────────────────
router.post('/session', auth, async (req, res) => {
  try {
    const { room_code, room_name, duration_seconds } = req.body;
    if (!duration_seconds || duration_seconds < 10) {
      return res.json({ success: true, skipped: true });
    }
    const { error } = await supabase.from('study_sessions').insert([{
      user_id: req.user.id,
      room_code,
      room_name,
      duration_seconds: Math.floor(duration_seconds)
    }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET MY STATS ──────────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('study_sessions')
      .select('duration_seconds, ended_at')
      .eq('user_id', req.user.id)
      .order('ended_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const sessions = data || [];
    const totalSessions = sessions.length;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekSessions = sessions.filter(s => new Date(s.ended_at) > weekAgo);
    const weekSeconds = weekSessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
    const weekHours = (weekSeconds / 3600).toFixed(1);

    const longest = sessions.reduce((max, s) => Math.max(max, s.duration_seconds || 0), 0);
    const longestMin = Math.floor(longest / 60);
    const longestHours = Math.floor(longestMin / 60);
    const longestDisplay = longestHours > 0
      ? `${longestHours}h ${longestMin % 60}m`
      : `${longestMin}m`;

    res.json({
      totalSessions,
      weekHours: parseFloat(weekHours),
      longestSession: longestDisplay
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
