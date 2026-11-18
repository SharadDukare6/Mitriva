'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const billing = require('../src/billing/razorpay');

test('Razorpay checkout subscription signature uses payment ID + stored subscription ID', () => {
  const secret = 'development-only-not-a-credential';
  const payment = 'pay_Example1234', subscription = 'sub_Example1234';
  const sig = crypto.createHmac('sha256', secret).update(payment + '|' + subscription).digest('hex');
  assert.equal(billing.subscriptionSignature(payment, subscription, sig, secret), true);
  assert.equal(billing.subscriptionSignature(payment, subscription + 'X', sig, secret), false);
  assert.equal(billing.subscriptionSignature(payment, subscription, '0'.repeat(64), secret), false);
  assert.equal(billing.subscriptionSignature(payment, subscription, sig, 'wrong'), false);
});
test('raw webhook body must match signed bytes, not parsed JSON', () => {
  const secret = 'different-local-secret';
  const raw = Buffer.from('{"event":"subscription.charged","data":{"x":1}}', 'utf8');
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(billing.webhookSignature(raw, signature, secret), true);
  assert.equal(billing.webhookSignature(Buffer.from('{}'), signature, secret), false);
  assert.equal(billing.webhookSignature(JSON.parse(raw), signature, secret), false);
  assert.equal(billing.webhookSignature(raw, 'broken', secret), false);
});
test('Mitriva billing defaults to disabled and plans remain server-priced', () => {
  assert.equal(billing.enabled(), false);
  assert.deepEqual(Object.keys(billing.PLANS).sort(), ['annual', 'monthly', 'quarterly']);
  assert.equal(billing.PLANS.monthly.amount, 19900);
  assert.equal(billing.PLANS.quarterly.amount, 49900);
  assert.equal(billing.PLANS.annual.amount, 149900);
});
test('webhook raw parser precedes JSON parser in server', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  assert.ok(app.indexOf("express.raw({ type: 'application/json'") < app.indexOf('app.use(express.json('));
  assert.ok(app.indexOf("app.use(base + '/billing'") < app.indexOf('app.use(base, requireReady, mitrivaRouter)'));
});
test('billing schema uses unique event ids and scoped subscriptions', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../src/migrations/mitriva.js'), 'utf8');
  assert.match(code, /mtr_billing_subscriptions/);
  assert.match(code, /mtr_billing_webhooks/);
  assert.match(code, /PRIMARY KEY\(event_id\)/);
  assert.match(code, /UNIQUE KEY uq_mtr_billing_remote/);
});
