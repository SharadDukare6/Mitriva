'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');

// These integration tests mock MySQL and MSG91. They never send a real text message.
process.env.NODE_ENV = 'production';
process.env.MSG91_AUTH_KEY = 'nonsecret-integration-test-placeholder';
process.env.MSG91_TEMPLATE_ID = 'fake-msg91-flow-id';
process.env.MSG91_OTP_VARIABLE = 'num';
process.env.MITRIVA_PLAY_REVIEW_ENABLED = 'false';
process.env.MITRIVA_TEST_OTP_ENABLED = 'false';

let counts, queries, smsResult;
db.getPool = () => ({
  async execute(sql, params) {
    queries.push({ sql, params });
    if (sql.includes('FROM mtr_users WHERE phone_e164')) return [[], []];
    if (sql.includes('COUNT(*) AS total FROM mtr_otp_request_logs')) {
      const n = sql.includes('60 SECOND') ? counts.minute
        : sql.includes('phone_e164') ? counts.hour : counts.ip;
      return [[{ total: n }], []];
    }
    return [{ affectedRows: 1 }, []];
  }
});
const route = require('../src/routes/mitriva').stack.find(
  layer => layer.route && layer.route.path === '/auth/otp/request'
).route.stack[0].handle;
const originalFetch = global.fetch;

async function invoke(phoneNumber = '+919876543210') {
  const output = { json: null, error: null };
  await route({
    body: { phoneNumber, shouldCreateUser: true, developerMode: true },
    ip: '127.0.0.1'
  }, {
    json: body => { output.json = body; }
  }, error => { output.error = error; });
  return output;
}
function reset() {
  counts = { minute: 0, hour: 0, ip: 0 };
  queries = [];
  smsResult = { ok: true, json: async () => ({ type: 'success', message: 'accepted' }) };
  global.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authkey, process.env.MSG91_AUTH_KEY);
    const body = JSON.parse(options.body);
    assert.equal(body.template_id, process.env.MSG91_TEMPLATE_ID);
    assert.equal(body.recipients[0].mobiles, '919876543210');
    assert.match(body.recipients[0].num, /^\d{6}$/);
    return smsResult;
  };
}
const challengeCount = () => queries.filter(q => q.sql.includes('INSERT INTO mtr_otp_codes')).length;
const logCount = () => queries.filter(q => q.sql.includes('INSERT INTO mtr_otp_request_logs')).length;

test('real Mitriva SMS delivery checks and security gates (provider mocked)', async () => {
  try {
    reset();
    let result = await invoke();
    assert.equal(result.error, null);
    assert.equal(result.json?.success, true);
    assert.equal(result.json?.debugOtp, undefined);
    assert.equal(challengeCount(), 1);
    assert.equal(logCount(), 1);

    reset();
    smsResult = { ok: true, json: async () => ({ type: 'error', message: 'Invalid template' }) };
    result = await invoke();
    assert.equal(result.json, null);
    assert.equal(result.error?.code, 'SMS_SEND_FAILED');
    assert.equal(challengeCount(), 0);
    assert.equal(logCount(), 1);

    reset();
    counts.minute = 1;
    result = await invoke();
    assert.equal(result.error?.status, 429);
    assert.equal(challengeCount(), 0);
    assert.equal(logCount(), 0);

    reset();
    result = await invoke('+12025550123');
    assert.equal(result.error?.code, 'INVALID_PHONE');
    assert.equal(challengeCount(), 0);

    reset();
    const previous = process.env.MSG91_TEMPLATE_ID;
    delete process.env.MSG91_TEMPLATE_ID;
    result = await invoke();
    assert.equal(result.error?.code, 'SMS_NOT_CONFIGURED');
    assert.equal(challengeCount(), 0);
    process.env.MSG91_TEMPLATE_ID = previous;
  } finally {
    global.fetch = originalFetch;
  }
});
