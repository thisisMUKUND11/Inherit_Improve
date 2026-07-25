/*
 * Admin authentication.
 *
 * A shared key is still a shared key -- the real answer is per-user accounts
 * with an audit trail, and that is scheduled for quarter 1. What changes today
 * is the cheap part: the key comes from the environment instead of a committed
 * JSON file, it travels in a header instead of the query string (query strings
 * land in browser history, proxy logs and access logs), and the comparison is
 * constant time.
 */
const crypto = require('node:crypto');
const { UnauthorizedError } = require('../../domain/errors');

function timingSafeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against itself so the work done is independent of the input,
    // then fail. Length is still observable; the key's length is not a secret.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function adminAuth(expectedKey) {
  return function adminAuthMiddleware(req, res, next) {
    const provided = req.get('x-admin-key');
    if (!provided || !timingSafeEquals(provided, expectedKey)) {
      return next(new UnauthorizedError());
    }
    return next();
  };
}

module.exports = { adminAuth, timingSafeEquals };
