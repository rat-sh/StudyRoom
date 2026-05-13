import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import supabase from '../supabase.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'studyroom-secret';

// ── SIGNUP ──────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, password_hash: hash }])
      .select('id,name,email')
      .single();

    if (error) {
      const isDup = error.code === '23505';
      return res.status(isDup ? 409 : 500).json({
        error: isDup ? 'Email already exists' : error.message
      });
    }
    res.json({ success: true, message: 'Account created! Please log in.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LOGIN ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set httpOnly cookie
    res.cookie('sr_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // Return non-sensitive user info for client-side display
    res.json({
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('sr_token', { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true });
});

// ── VERIFY TOKEN (for client hydration) ───────────────────────────────────────
router.get('/me', async (req, res) => {
  const token = req.cookies?.sr_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ user: { id: payload.id, name: payload.name, email: payload.email } });
  } catch {
    res.clearCookie('sr_token');
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
