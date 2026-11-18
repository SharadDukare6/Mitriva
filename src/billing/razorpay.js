'use strict';
const express = require('express');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { getPool } = require('../db');
const { requireMitrivaAuth } = require('../mitrivaAuth');

const router = express.Router();
const PLANS = Object.freeze({
  monthly: { amount: 19900, interval: 1, period: 'monthly', total: 120, env: 'MITRIVA_RZP_MONTHLY_PLAN_ID' },
  quarterly: { amount: 49900, interval: 3, period: 'monthly', total: 40, env: 'MITRIVA_RZP_QUARTERLY_PLAN_ID' },
  annual: { amount: 149900, interval: 1, period: 'yearly', total: 10, env: 'MITRIVA_RZP_ANNUAL_PLAN_ID' },
});
const failure = (message, status = 400, code = 'BILLING_ERROR') =>
  Object.assign(new Error(message), { status, code });
const hash = (secret, input) => crypto.createHmac('sha256', secret).update(input).digest('hex');
function compare(actual, expected) {
  return /^[0-9a-f]{64}$/i.test(String(actual || '')) &&
    crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function subscriptionSignature(paymentId, subId, signature, secret) {
  return /^pay_[a-zA-Z0-9]+$/.test(String(paymentId)) &&
    /^sub_[a-zA-Z0-9]+$/.test(String(subId)) &&
    Boolean(secret) && compare(signature, hash(secret, paymentId + '|' + subId));
}
function webhookSignature(raw, signature, secret) {
  return Buffer.isBuffer(raw) && Boolean(secret) && compare(signature, hash(secret, raw));
}
function enabled() {
  return process.env.MITRIVA_RAZORPAY_ENABLED === 'true' &&
    process.env.MITRIVA_RAZORPAY_BUSINESS_APPROVED === 'true' &&
    process.env.MITRIVA_GOOGLE_PLAY_ALT_BILLING_APPROVED === 'true' &&
    /^rzp_(test|live)_/.test(process.env.RAZORPAY_KEY_ID || '') &&
    Boolean(process.env.RAZORPAY_KEY_SECRET && process.env.MITRIVA_RAZORPAY_WEBHOOK_SECRET) &&
    Object.values(PLANS).every(x => /^plan_[a-zA-Z0-9]+$/.test(process.env[x.env] || ''));
}
const gate = (_req, _res, next) => next(enabled() ? undefined : failure(
  'Mitriva billing is not yet enabled', 503, 'BILLING_DISABLED'));
async function callApi(method, path, data) {
  const url = new URL(path, 'https://api.razorpay.com');
  if (url.origin !== 'https://api.razorpay.com' || !url.pathname.startsWith('/v1/')) {
    throw failure('Invalid gateway resource', 500);
  }
  const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
  const resp = await fetch(url, { method,
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(18000) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw failure('Gateway request was unsuccessful', 502, 'RAZORPAY_FAILED');
  return json;
}
router.get('/plans', requireMitrivaAuth, (_req, res) => res.json({
  gateway: 'razorpay', enabled: enabled(),
  plans: Object.entries(PLANS).map(([code, x]) =>
    ({ code, priceInr: x.amount / 100, currency: 'INR', interval: x.interval, period: x.period })),
}));
router.post('/subscriptions', requireMitrivaAuth, gate, async (req, res, next) => {
  try {
    const code = String(req.body.planCode || '').toLowerCase();
    const plan = PLANS[code];
    if (!plan) throw failure('Unknown plan');
    if (req.body.recurringConsent !== true) throw failure('Recurring payment consent required');
    const userId = req.mitrivaUser.sub, pool = getPool();
    const [users] = await pool.execute('SELECT status,role,deleted_at FROM mtr_users WHERE id=?', [userId]);
    if (!users.length || users[0].status !== 'active' || users[0].role === 'demo' || users[0].deleted_at)
      throw failure('Ineligible account', 403);
    const [premium] = await pool.execute(
      "SELECT user_id FROM mtr_subscriptions WHERE user_id=? AND status='active' AND plan_code<>'free' AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(6))",
      [userId]);
    if (premium.length) throw failure('Manage your existing plan first', 409, 'ALREADY_PREMIUM');
    const [pending] = await pool.execute(
      "SELECT * FROM mtr_billing_subscriptions WHERE user_id=? AND status IN ('creating','pending') ORDER BY created_at DESC LIMIT 1",
      [userId]);
    if (pending.length) {
      if (pending[0].status === 'creating') throw failure('Previous request needs reconciliation', 409);
      return res.json({ gateway: 'razorpay', keyId: process.env.RAZORPAY_KEY_ID,
        subscriptionId: pending[0].razorpay_id, planCode: pending[0].plan_code });
    }
    const id = uuid();
    await pool.execute("INSERT INTO mtr_billing_subscriptions(id,user_id,plan_code,amount_paise,status) VALUES(?,?,?,?,'creating')",
      [id, userId, code, plan.amount]);
    let remote;
    try {
      remote = await callApi('POST', '/v1/subscriptions', {
        plan_id: process.env[plan.env], total_count: plan.total,
        quantity: 1, customer_notify: 0,
        notes: { app: 'mitriva', billing_id: id, plan_code: code, user_id: userId },
      });
    } catch (e) {
      // Do not retry an ambiguous gateway create automatically.
      await pool.execute("UPDATE mtr_billing_subscriptions SET status='needs_review' WHERE id=?", [id]);
      throw e;
    }
    if (!/^sub_[a-zA-Z0-9]+$/.test(remote.id || '')) throw failure('Provider subscription ID invalid', 502);
    await pool.execute("UPDATE mtr_billing_subscriptions SET razorpay_id=?,status='pending' WHERE id=?", [remote.id, id]);
    res.status(201).json({ gateway: 'razorpay', keyId: process.env.RAZORPAY_KEY_ID,
      subscriptionId: remote.id, planCode: code });
  } catch (e) { next(e); }
});

async function reconcile(remoteId, paymentId) {
  const pool = getPool();
  const [rows] = await pool.execute('SELECT * FROM mtr_billing_subscriptions WHERE razorpay_id=?', [remoteId]);
  if (!rows.length) return { found: false, active: false };
  const row = rows[0], plan = PLANS[row.plan_code];
  if (!plan) return { found: true, active: false };
  const [sub, pay] = await Promise.all([
    callApi('GET', '/v1/subscriptions/' + encodeURIComponent(remoteId)),
    callApi('GET', '/v1/payments/' + encodeURIComponent(paymentId)),
  ]);
  const expires = Number(sub.current_end);
  if (sub.id !== remoteId || sub.plan_id !== process.env[plan.env] ||
      pay.subscription_id !== remoteId || pay.status !== 'captured' ||
      pay.currency !== 'INR' || Number(pay.amount) !== Number(row.amount_paise) ||
      !Number.isFinite(expires) || expires <= Date.now() / 1000 ||
      !['active', 'cancelled', 'completed'].includes(sub.status)) return { found: true, active: false };
  const end = new Date(expires * 1000), renewing = sub.status === 'active' ? 1 : 0;
  await pool.execute(
    "UPDATE mtr_billing_subscriptions SET status='active',last_payment_id=?,ends_at=?,auto_renew=? WHERE id=?",
    [paymentId, end, renewing, row.id]);
  await pool.execute(
    `INSERT INTO mtr_subscriptions(user_id,plan_code,status,provider,provider_subscription_id,starts_at,ends_at,auto_renew)
     VALUES(?,?,'active','razorpay',?,UTC_TIMESTAMP(6),?,?)
     ON DUPLICATE KEY UPDATE plan_code=VALUES(plan_code),status='active',provider='razorpay',
     provider_subscription_id=VALUES(provider_subscription_id),ends_at=VALUES(ends_at),auto_renew=VALUES(auto_renew)`,
    [row.user_id, row.plan_code, remoteId, end, renewing]);
  return { found: true, active: true };
}
router.post('/subscriptions/verify', requireMitrivaAuth, gate, async (req, res, next) => {
  try {
    const subId = String(req.body.razorpay_subscription_id || '');
    const paymentId = String(req.body.razorpay_payment_id || '');
    const [rows] = await getPool().execute(
      'SELECT razorpay_id FROM mtr_billing_subscriptions WHERE razorpay_id=? AND user_id=?',
      [subId, req.mitrivaUser.sub]);
    if (!rows.length) throw failure('Subscription not found for this user', 404);
    if (!subscriptionSignature(paymentId, rows[0].razorpay_id, req.body.razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET)) throw failure('Invalid signature', 400, 'INVALID_SIGNATURE');
    const result = await reconcile(subId, paymentId);
    res.json({ verified: true, premiumActivated: result.active, status: result.active ? 'active' : 'pending' });
  } catch (e) { next(e); }
});
router.get('/subscriptions/current', requireMitrivaAuth, async (req, res, next) => {
  try {
    const [rows] = await getPool().execute(
      'SELECT plan_code,status,razorpay_id,ends_at,auto_renew FROM mtr_billing_subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 1',
      [req.mitrivaUser.sub]);
    res.json({ checkoutEnabled: enabled(), subscription: rows[0] || null });
  } catch (e) { next(e); }
});
router.post('/subscriptions/cancel', requireMitrivaAuth, gate, async (req, res, next) => {
  try {
    const userId = req.mitrivaUser.sub, pool = getPool();
    const [rows] = await pool.execute(
      "SELECT * FROM mtr_billing_subscriptions WHERE user_id=? AND status IN ('active','pending') ORDER BY created_at DESC LIMIT 1",
      [userId]);
    if (!rows.length) throw failure('Subscription not found', 404);
    const row = rows[0];
    await callApi('POST', '/v1/subscriptions/' + encodeURIComponent(row.razorpay_id) + '/cancel',
      { cancel_at_cycle_end: 1 });
    await pool.execute('UPDATE mtr_billing_subscriptions SET auto_renew=0 WHERE id=?', [row.id]);
    await pool.execute("UPDATE mtr_subscriptions SET auto_renew=0 WHERE user_id=? AND provider_subscription_id=?",
      [userId, row.razorpay_id]);
    res.json({ cancelledAtCycleEnd: true });
  } catch (e) { next(e); }
});
async function webhook(req, res, next) {
  try {
    if (!enabled()) return res.status(503).json({ error: 'BILLING_DISABLED' });
    if (!webhookSignature(req.body, req.get('x-razorpay-signature'),
      process.env.MITRIVA_RAZORPAY_WEBHOOK_SECRET)) return res.status(401).json({ error: 'INVALID_SIGNATURE' });
    const id = String(req.get('x-razorpay-event-id') || '');
    if (!/^[a-zA-Z0-9_-]{4,120}$/.test(id)) return res.status(400).json({ error: 'INVALID_EVENT_ID' });
    const event = JSON.parse(req.body.toString('utf8'));
    const payId = event.payload?.payment?.entity?.id;
    // A refund of the most recent paid charge must revoke its entitlement.
    if (event.event === 'payment.refunded' && payId) {
      const pool = getPool();
      const [rows] = await pool.execute(
        "SELECT * FROM mtr_billing_subscriptions WHERE last_payment_id=? AND status='active' LIMIT 1",
        [payId]);
      if (!rows.length) return res.json({ ignored: true });
      const payment = await callApi('GET', '/v1/payments/' + encodeURIComponent(payId));
      if (payment.status !== 'refunded' ||
          Number(payment.amount_refunded) < Number(rows[0].amount_paise)) {
        return res.json({ ignored: true });
      }
      const [prev] = await pool.execute('SELECT processed_at FROM mtr_billing_webhooks WHERE event_id=?', [id]);
      if (prev[0]?.processed_at) return res.json({ duplicate: true });
      await pool.execute(
        'INSERT IGNORE INTO mtr_billing_webhooks(event_id,razorpay_id,event_name) VALUES(?,?,?)',
        [id, rows[0].razorpay_id, 'payment.refunded']);
      await pool.execute(
        "UPDATE mtr_billing_subscriptions SET status='refunded',auto_renew=0 WHERE id=?",
        [rows[0].id]);
      await pool.execute(
        "UPDATE mtr_subscriptions SET status='free',plan_code='free',auto_renew=0,ends_at=UTC_TIMESTAMP(6) WHERE user_id=? AND provider_subscription_id=?",
        [rows[0].user_id, rows[0].razorpay_id]);
      await pool.execute('UPDATE mtr_billing_webhooks SET processed_at=UTC_TIMESTAMP(6) WHERE event_id=?', [id]);
      return res.json({ accepted: true, revoked: true });
    }
    const subId = event.payload?.subscription?.entity?.id;
    if (!String(event.event || '').startsWith('subscription.') || !subId)
      return res.json({ ignored: true });
    const pool = getPool();
    const [mine] = await pool.execute('SELECT id FROM mtr_billing_subscriptions WHERE razorpay_id=?', [subId]);
    if (!mine.length) return res.json({ ignored: true });
    const [duplicates] = await pool.execute('SELECT processed_at FROM mtr_billing_webhooks WHERE event_id=?', [id]);
    if (duplicates[0]?.processed_at) return res.json({ duplicate: true });
    await pool.execute('INSERT IGNORE INTO mtr_billing_webhooks(event_id,razorpay_id,event_name) VALUES(?,?,?)',
      [id, subId, event.event]);
    if (event.event === 'subscription.charged' && payId) {
      const result = await reconcile(subId, payId);
      // Keep this event pending for Razorpay retry until a captured payment
      // and its subscription period have both been confirmed by the API.
      if (!result.active) throw failure('Payment not yet captured; retry webhook', 503, 'RETRY_LATER');
    } else if (['subscription.cancelled','subscription.completed','subscription.halted'].includes(event.event)) {
      await pool.execute('UPDATE mtr_billing_subscriptions SET auto_renew=0 WHERE razorpay_id=?', [subId]);
      await pool.execute("UPDATE mtr_subscriptions SET auto_renew=0 WHERE provider='razorpay' AND provider_subscription_id=?", [subId]);
    }
    await pool.execute('UPDATE mtr_billing_webhooks SET processed_at=UTC_TIMESTAMP(6) WHERE event_id=?', [id]);
    res.json({ accepted: true });
  } catch (e) { next(e); }
}
module.exports = { router, webhook, enabled, PLANS, subscriptionSignature, webhookSignature };
