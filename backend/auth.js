const crypto = require('crypto');

const SESSIONS = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const VALID_SUBJECTS = new Set(['CN', 'DS', 'DMS', 'ECON', 'UHV', 'COA']);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(user) {
  const token = generateToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const sessionData = {
    token,
    user,
    expiresAt
  };
  SESSIONS.set(token, sessionData);
  return sessionData;
}

function getSession(token) {
  if (!token) return null;
  const session = SESSIONS.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    SESSIONS.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  if (!token) return false;
  return SESSIONS.delete(token);
}

function authenticateRequest(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1].trim();
  const session = getSession(token);
  return session ? session.user : null;
}

function isValidSubject(subject) {
  if (!subject) return false;
  return VALID_SUBJECTS.has(subject.toUpperCase());
}

module.exports = {
  createSession,
  getSession,
  destroySession,
  authenticateRequest,
  isValidSubject,
  VALID_SUBJECTS
};
