const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCart, MAX_QTY, MAX_LINES } = require('../../refactored/src/http/validate');
const { ValidationError } = require('../../refactored/src/domain/errors');

const good = { email: 'Buyer@Example.COM ', items: [{ productId: 2, qty: 3 }], coupon: 'welcome10' };

test('parseCart: normalises what it accepts', () => {
  const result = parseCart(good, { requireEmail: true });
  assert.equal(result.email, 'buyer@example.com', 'email is trimmed and lowercased');
  assert.equal(result.couponCode, 'WELCOME10', 'coupon is uppercased for the lookup');
  assert.deepEqual(result.items, [{ productId: 2, qty: 3 }]);
});

test('parseCart: missing items keeps the legacy error string', () => {
  try {
    parseCart({ email: 'a@b.co' }, { requireEmail: true });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.legacyMessage, 'no items', 'existing clients match on this string');
    assert.equal(err.code, 'validation_error', 'new clients match on this code');
  }
});

test('parseCart: quantities must be whole, positive and sane', () => {
  for (const qty of [0, -5, 1.5, MAX_QTY + 1, '3', null, NaN]) {
    assert.throws(
      () => parseCart({ email: 'a@b.co', items: [{ productId: 1, qty }] }, { requireEmail: true }),
      ValidationError,
      `qty ${qty} should be rejected`,
    );
  }
});

test('parseCart: product ids must be positive integers', () => {
  for (const productId of [0, -1, 1.5, 'abc', undefined]) {
    assert.throws(
      () => parseCart({ email: 'a@b.co', items: [{ productId, qty: 1 }] }, { requireEmail: true }),
      ValidationError,
    );
  }
});

test('parseCart: rejects an implausible basket', () => {
  const items = Array.from({ length: MAX_LINES + 1 }, () => ({ productId: 1, qty: 1 }));
  assert.throws(() => parseCart({ email: 'a@b.co', items }, { requireEmail: true }), ValidationError);
});

test('parseCart: rejects coupon codes that are not coupon codes', () => {
  for (const coupon of ["X' OR 1=1 --", 'a'.repeat(33), 'has space', '<script>', 42]) {
    assert.throws(
      () => parseCart({ email: 'a@b.co', items: [{ productId: 1, qty: 1 }], coupon }, { requireEmail: true }),
      ValidationError,
      `coupon ${coupon} should be rejected`,
    );
  }
});

test('parseCart: an absent coupon is not an error', () => {
  for (const coupon of [undefined, null, '']) {
    const r = parseCart({ email: 'a@b.co', items: [{ productId: 1, qty: 1 }], coupon }, { requireEmail: true });
    assert.equal(r.couponCode, undefined);
  }
});

test('parseCart: email is required for an order and not for a quote', () => {
  assert.throws(
    () => parseCart({ items: [{ productId: 1, qty: 1 }] }, { requireEmail: true }),
    ValidationError,
  );
  assert.doesNotThrow(
    () => parseCart({ items: [{ productId: 1, qty: 1 }] }, { requireEmail: false }),
  );
});

test('parseCart: rejects malformed email addresses', () => {
  for (const email of ['nope', 'a@b', '@b.co', 'a b@c.co', '']) {
    assert.throws(
      () => parseCart({ email, items: [{ productId: 1, qty: 1 }] }, { requireEmail: true }),
      ValidationError,
      `${email} should be rejected`,
    );
  }
});
