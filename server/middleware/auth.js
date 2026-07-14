import { verifyToken } from '../lib/supabase.js';

/**
 * Middleware to verify Supabase JWT from Authorization header
 * Sets req.user = { id, email, ... }
 */
export async function requireAuth(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }
    const user = await verifyToken(token);
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: ' + err.message });
  }
}

/**
 * Optional auth middleware — attaches user if token present, continues if not
 */
export async function optionalAuth(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (token) {
      const user = await verifyToken(token);
      req.user = user;
    }
  } catch {
    // Continue without user
  }
  next();
}
