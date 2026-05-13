import express from 'express';
import supabase from '../supabase.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// ── GET USER PROFILE + BADGES ─────────────────────────────────────────────────
router.get('/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, name, created_at')
      .eq('id', id)
      .single();

    if (userErr || !user) return res.status(404).json({ error: 'User not found' });

    const { data: sessions } = await supabase
      .from('study_sessions')
      .select('duration_seconds, ended_at, room_code')
      .eq('user_id', id);

    const { data: rooms } = await supabase
      .from('rooms')
      .select('id')
      .eq('created_by', id);

    const allSessions = sessions || [];
    const totalSessions = allSessions.length;
    const totalSeconds = allSessions.reduce((s, r) => s + (r.duration_seconds || 0), 0);
    const totalHours = Math.round(totalSeconds / 3600);

    const createdRooms = rooms?.length || 0;

    // ── BADGE COMPUTATION ────────────────────────────────────────────────
    const badges = [];

    const earlyBird = allSessions.filter(s => new Date(s.ended_at).getHours() < 8).length;
    if (earlyBird >= 5) badges.push({ name: 'Early Bird', icon: '🌅' });

    const nightOwl = allSessions.filter(s => new Date(s.ended_at).getHours() >= 22).length;
    if (nightOwl >= 5) badges.push({ name: 'Night Owl', icon: '🦉' });

    if (createdRooms >= 3) badges.push({ name: 'Host', icon: '🎙️' });
    if (totalSessions >= 10) badges.push({ name: 'Dedicated', icon: '🎯' });

    const marathon = allSessions.some(s => s.duration_seconds >= 7200);
    if (marathon) badges.push({ name: 'Marathoner', icon: '🏃' });

    const uniqueRooms = new Set(allSessions.map(s => s.room_code)).size;
    if (uniqueRooms >= 5) badges.push({ name: 'Socialite', icon: '🤝' });

    res.json({
      name: user.name,
      joinDate: user.created_at,
      stats: { totalSessions, totalHours, createdRooms },
      badges
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
