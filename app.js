'use strict';
require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { corsOptions } = require('./src/config');
const { applyMitrivaMigration } = require('./src/migrations/mitriva');
const mitrivaRouter = require('./src/routes/mitriva');
const { configureMitrivaSocket } = require('./src/realtime/mitrivaSocket');

const state = { state: 'starting', error: null };
const base = '/api/v1/mitriva';
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '12mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));

function healthPayload() {
  return {
    success: state.state === 'ready',
    service: 'Mitriva API',
    module: 'mitriva',
    state: state.state,
    error: state.error?.message || null,
    timestamp: new Date().toISOString(),
  };
}

function requireReady(_req, res, next) {
  if (state.state === 'ready') return next();
  return res.status(503).json({
    success: false,
    error: state.error?.code || 'MITRIVA_BOOTSTRAP_IN_PROGRESS',
    message: state.error?.message || 'Mitriva database bootstrap is still running.',
  });
}

app.get('/', (_req, res) => res.json({ ...healthPayload(), base, version: '1.0.4' }));
app.get('/health', (_req, res) => res.status(state.state === 'failed' ? 503 : 200).json(healthPayload()));
app.get(base + '/system/bootstrap-status', (_req, res) => res.status(state.state === 'ready' ? 200 : 503).json(healthPayload()));
app.use(base, requireReady, mitrivaRouter);

app.use((req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Route not found: ' + req.method + ' ' + req.originalUrl }));
app.use((err, _req, res, _next) => {
  const status = Number(err.status || err.statusCode || 500);
  const safe = status >= 400 && status <= 599 ? status : 500;
  if (safe >= 500) console.error('[Mitriva]', err);
  res.status(safe).json({ success: false, error: err.code || 'INTERNAL_SERVER_ERROR', message: err.message || 'Internal server error' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-App-Key'],
    credentials: false,
  },
});
app.set('io', io);
configureMitrivaSocket(io);

async function bootstrap() {
  state.state = 'migrating';
  try {
    await applyMitrivaMigration();
    state.state = 'ready';
    state.error = null;
    console.log('[Mitriva] standalone database bootstrap ready.');
  } catch (error) {
    state.state = 'failed';
    state.error = error;
    console.error('[Mitriva] bootstrap failed:', error);
  }
}

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log('Mitriva standalone API listening on ' + port);
  bootstrap();
});

function shutdown(signal) {
  console.log(signal + ' received; shutting down.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, io, state };
