'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('./db');

function secret() {
  const value = process.env.MITRIVA_JWT_SECRET || process.env.JWT_SECRET;
  if (!value) {
    const error = new Error('JWT secret is not configured');
    error.code = 'JWT_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function issueAccessToken(user, sessionId) {
  return jwt.sign(
    { sub: user.id, sid: sessionId, type: 'mitriva_access', role: user.role || 'member' },
    secret(),
    { expiresIn: process.env.MITRIVA_ACCESS_EXPIRES_IN || '1h', issuer: 'iconais-mitriva' }
  );
}

function issueRefreshToken(user, sessionId) {
  return jwt.sign(
    { sub: user.id, sid: sessionId, type: 'mitriva_refresh' },
    secret(),
    { expiresIn: process.env.MITRIVA_REFRESH_EXPIRES_IN || '30d', issuer: 'iconais-mitriva' }
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, secret(), { issuer: 'iconais-mitriva' });
  if (payload.type !== 'mitriva_access') throw new Error('Invalid Mitriva access token');
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, secret(), { issuer: 'iconais-mitriva' });
  if (payload.type !== 'mitriva_refresh') throw new Error('Invalid Mitriva refresh token');
  return payload;
}

function requireMitrivaAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ success:false, error:'AUTH_REQUIRED', message:'Bearer token is required' });
    }
    req.mitrivaUser = verifyAccessToken(token);
    return next();
  } catch (_) {
    return res.status(401).json({ success:false, error:'INVALID_TOKEN', message:'Session is invalid or expired' });
  }
}

async function createSession(user, req) {
  const pool = getPool();
  const sessionId = uuidv4();
  const refreshToken = issueRefreshToken(user, sessionId);
  const deviceId = String(req?.get?.('X-Device-Id') || req?.body?.deviceId || '').trim() || null;
  const deviceName = String(req?.body?.deviceName || req?.get?.('User-Agent') || '').slice(0,160) || null;
  await pool.execute(
    `INSERT INTO mtr_auth_sessions
     (id,user_id,refresh_token_hash,device_id,device_name,expires_at,last_used_at)
     VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY),UTC_TIMESTAMP(6))`,
    [sessionId, user.id, sha256(refreshToken), deviceId, deviceName]
  );
  return {
    accessToken: issueAccessToken(user, sessionId),
    refreshToken,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresIn: 2592000
  };
}

async function refreshSession(refreshToken) {
  const pool = getPool();
  let payload;
  try { payload = verifyRefreshToken(refreshToken); }
  catch (_) {
    const error = new Error('Session is invalid or expired'); error.status = 401; error.code='INVALID_REFRESH_TOKEN'; throw error;
  }
  const [rows] = await pool.execute(
    `SELECT s.*,u.role,u.status,u.deleted_at FROM mtr_auth_sessions s
     JOIN mtr_users u ON u.id=s.user_id
     WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(6) LIMIT 1`,
    [payload.sid,payload.sub]
  );
  const s=rows[0];
  if (!s || s.refresh_token_hash !== sha256(refreshToken) || s.status !== 'active' || s.deleted_at) {
    const error=new Error('Session is invalid or expired'); error.status=401; error.code='INVALID_REFRESH_TOKEN'; throw error;
  }
  await pool.execute('UPDATE mtr_auth_sessions SET last_used_at=UTC_TIMESTAMP(6) WHERE id=?',[s.id]);
  return {
    accessToken: issueAccessToken({id:s.user_id,role:s.role},s.id),
    refreshToken,
    accessTokenExpiresIn:3600,
    refreshTokenExpiresIn:2592000
  };
}

module.exports = {
  sha256,
  requireMitrivaAuth,
  verifyAccessToken,
  createSession,
  refreshSession
};
