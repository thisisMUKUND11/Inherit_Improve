const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, redact, maskEmail } = require('../../refactored/src/observability/logger');
const { errorHandler } = require('../../refactored/src/http/middleware/error-handler');
const { OutOfStockError, ValidationError } = require('../../refactored/src/domain/errors');
const { timingSafeEquals } = require('../../refactored/src/http/middleware/admin-auth');

test('redaction: the fields that ended up in four years of log retention', () => {
  const out = redact({
    email: 'jane.doe@example.com',
    card: { number: '4242424242424242', cvc: '123' },
    password: 'hunter2', // allowlist-secret: test fixture, not a credential
    adminKey: 'orderdesk-admin-2019', // allowlist-secret: test fixture, already rotated
    items: [{ productId: 1, qty: 2 }],
  });

  assert.equal(out.card, '[redacted]');
  assert.equal(out.password, '[redacted]');
  assert.equal(out.adminKey, '[redacted]');
  assert.equal(out.email, 'ja***@example.com', 'enough to correlate, not enough to be a leak');
  assert.deepEqual(out.items, [{ productId: 1, qty: 2 }], 'ordinary fields survive');
});

test('redaction: reaches into nested structures and arrays', () => {
  const out = redact({ a: { b: [{ secret: 'x', keep: 1 }] } });
  assert.equal(out.a.b[0].secret, '[redacted]');
  assert.equal(out.a.b[0].keep, 1);
});

test('redaction: matches keys regardless of casing or separators', () => {
  const out = redact({ CVV: '1', 'api-key': '2', Api_Key: '3', cardNumber: '4' });
  assert.deepEqual(Object.values(out), ['[redacted]', '[redacted]', '[redacted]', '[redacted]']);
});

test('maskEmail: never returns the local part', () => {
  assert.equal(maskEmail('a@b.co'), 'a***@b.co');
  assert.equal(maskEmail('not-an-email'), '[redacted]');
});

test('logger: one line of json per event, with the bound context', () => {
  const lines = [];
  const logger = createLogger({
    level: 'info',
    now: () => '2026-03-12T10:00:00.000Z',
    stream: { write: (s) => lines.push(s) },
  });

  logger.child({ requestId: 'req-1' }).info('order placed', { totalMinor: 1000, card: { number: '1' } });

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(entry, {
    ts: '2026-03-12T10:00:00.000Z',
    level: 'info',
    message: 'order placed',
    requestId: 'req-1',
    totalMinor: 1000,
    card: '[redacted]',
  });
});

test('logger: respects the level threshold', () => {
  const lines = [];
  const logger = createLogger({ level: 'warn', stream: { write: (s) => lines.push(s) } });
  logger.info('quiet');
  logger.warn('loud');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /loud/);
});

function invoke(err) {
  const res = {
    statusCode: null, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
  const logged = [];
  const log = { warn: (m, f) => logged.push(['warn', m, f]), error: (m, f) => logged.push(['error', m, f]) };
  errorHandler(log)(err, { id: 'req-9', log }, res, () => {});
  return { res, logged };
}

test('error handler: an expected error is precise and is not an alert', () => {
  const { res, logged } = invoke(new OutOfStockError('Cold Brew Bottle', 4, 2));
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'out of stock: Cold Brew Bottle', 'legacy string preserved');
  assert.equal(res.payload.code, 'out_of_stock');
  assert.deepEqual(res.payload.details, { productName: 'Cold Brew Bottle', requested: 4, available: 2 });
  assert.equal(res.payload.requestId, 'req-9');
  assert.equal(logged[0][0], 'warn', 'a customer mistake is not logged as a system error');
});

test('error handler: a validation error carries the field list', () => {
  const { res } = invoke(new ValidationError([{ field: 'items[0].qty', message: 'must be positive' }]));
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.details[0].field, 'items[0].qty');
});

test('error handler: an unexpected error tells the customer nothing and the log everything', () => {
  const boom = new Error('ECONNREFUSED 10.0.3.14:5432 while opening pool');
  const { res, logged } = invoke(boom);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.stack, undefined);
  assert.ok(!JSON.stringify(res.payload).includes('10.0.3.14'), 'no internals in the response');
  assert.equal(res.payload.requestId, 'req-9', 'the customer gets something support can search for');
  assert.equal(logged[0][0], 'error');
  assert.ok(logged[0][2].err.stack.includes('Error'), 'and the stack is in the log where it belongs');
});

test('admin key comparison is constant time and length-safe', () => {
  assert.equal(timingSafeEquals('abc', 'abc'), true);
  assert.equal(timingSafeEquals('abc', 'abd'), false);
  assert.equal(timingSafeEquals('abc', 'abcd'), false, 'differing lengths must not throw');
  assert.equal(timingSafeEquals('', ''), true);
});
