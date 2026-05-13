import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'studyroom-secret';

export default function authMiddleware(req, res, next) {
  // Check httpOnly cookie first, then Authorization header (backward compat)
  const cookieToken = req.cookies?.sr_token;
  const headerToken = req.headers.authorization?.split(' ')[1];
  const token = cookieToken || headerToken;

  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
