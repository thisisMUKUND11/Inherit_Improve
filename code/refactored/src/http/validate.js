/*
 * Request validation at the edge.
 *
 * Everything past this point can assume its inputs are the right type and in
 * range, which is why the service and domain layers contain no defensive
 * `if (!items)` clutter. Validate once, at the boundary, and trust the data
 * afterwards.
 *
 * The legacy handler validated nothing, so `qty: -5` produced a negative total
 * and put stock back on the shelf.
 */
const { ValidationError } = require('../domain/errors');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUPON = /^[A-Za-z0-9_-]{1,32}$/;

const MAX_LINES = 50;
const MAX_QTY = 99;

/*
 * Each field gets its own function that returns either a value or a list of
 * problems. They compose, they read top to bottom, and none of them is
 * branchy enough to need a second look.
 *
 * The first version of this was one 40-line function with a complexity score
 * of 19; the linter said so, and it was right. In a service with more than
 * three shapes to validate this whole file becomes a schema library -- but
 * three shapes is not enough to justify the dependency yet.
 */

const ok = (value) => ({ value, errors: [] });
const bad = (field, message) => ({ value: undefined, errors: [{ field, message }] });

function parseEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email)) {
    return bad('email', 'must be a valid email address');
  }
  return ok(email.toLowerCase());
}

function parseItem(item, index) {
  const errors = [];
  const productId = item?.productId;
  const qty = item?.qty;

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    errors.push({ field: `items[${index}].productId`, message: 'must be a positive integer' });
  }
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QTY) {
    errors.push({ field: `items[${index}].qty`, message: `must be an integer between 1 and ${MAX_QTY}` });
  }
  return errors.length > 0 ? { value: undefined, errors } : ok({ productId, qty });
}

function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    // Legacy clients match on this exact string. It is preserved here and
    // carried as `legacyMessage`; the `code` field is what new clients use.
    throw new ValidationError([{ field: 'items', message: 'must be a non-empty array' }], 'no items');
  }
  if (raw.length > MAX_LINES) {
    return bad('items', `must contain at most ${MAX_LINES} lines`);
  }
  const parsed = raw.map(parseItem);
  const errors = parsed.flatMap((p) => p.errors);
  return errors.length > 0 ? { value: undefined, errors } : ok(parsed.map((p) => p.value));
}

function parseCoupon(raw) {
  if (raw === undefined || raw === null || raw === '') return ok(undefined);
  if (typeof raw !== 'string' || !COUPON.test(raw)) {
    return bad('coupon', 'must be 1-32 letters, digits, hyphen or underscore');
  }
  return ok(raw.toUpperCase());
}

function parseCart(body, { requireEmail }) {
  const email = requireEmail ? parseEmail(body?.email) : ok(undefined);
  const items = parseItems(body?.items);
  const coupon = parseCoupon(body?.coupon);

  // Every field is checked before anything is reported, so a customer with two
  // mistakes is told about both instead of discovering them one round trip at
  // a time.
  const errors = [...email.errors, ...items.errors, ...coupon.errors];
  if (errors.length > 0) throw new ValidationError(errors);

  return {
    ...(email.value !== undefined ? { email: email.value } : {}),
    ...(coupon.value !== undefined ? { couponCode: coupon.value } : {}),
    items: items.value,
  };
}

module.exports = { parseCart, MAX_LINES, MAX_QTY };
