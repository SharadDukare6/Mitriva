'use strict';

const { verifyAccessToken } = require('../mitrivaAuth');
const { getPool } = require('../db');

function configureMitrivaSocket(io) {
  const nsp = io.of('/mitriva');

  nsp.use((socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token || '').trim();
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch (_) {
      next(new Error('Unauthorized'));
    }
  });

  nsp.on('connection', async (socket) => {
    const userId = socket.data.userId;
    socket.join(`user:${userId}`);
    try {
      await getPool().execute('UPDATE mtr_users SET last_active_at=UTC_TIMESTAMP(6) WHERE id=?',[userId]);
    } catch (_) {}

    socket.on('join_match', async (body={}) => {
      try {
        const [rows] = await getPool().execute(
          `SELECT id FROM mtr_matches WHERE id=? AND status='active' AND (user_one_id=? OR user_two_id=?) LIMIT 1`,
          [body.matchId,userId,userId]
        );
        if (rows[0]) socket.join(`match:${body.matchId}`);
      } catch (_) {}
    });

    socket.on('leave_match', (body={}) => {
      if (body.matchId) socket.leave(`match:${body.matchId}`);
    });

    socket.on('typing', (body={}) => {
      if (!body.matchId) return;
      socket.to(`match:${body.matchId}`).emit('typing',{matchId:body.matchId,userId,typing:Boolean(body.typing)});
    });

    socket.on('message_changed', (body={}) => {
      if (!body.matchId) return;
      socket.to(`match:${body.matchId}`).emit('message_changed',{matchId:body.matchId});
    });
  });

  return nsp;
}

module.exports = { configureMitrivaSocket };
