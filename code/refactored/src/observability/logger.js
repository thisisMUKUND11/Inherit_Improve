/*
 * Structured logging.
 *
 * One line of JSON per event, with a request id, so a support ticket that says
 * "it broke at about half four" can be answered by a query instead of a guess.
 *
 * Redaction is a denylist applied on the way out, and it is applied here
 * rather than at each call site, because "remember not to log the card object"
 * is not a control. The legacy handler opened with
 * `console.log(JSON.stringify(req.body))` and shipped card numbers to the
 * hosting provider's log retention for four years.
 */

const REDACT = new Set([
  'password', 'pass', 'secret', 'token', 'authorization', 'cookie',
  'card', 'cardnumber', 'number', 'cvc', 'cvv', 'pan', 'apikey', 'api_key',
  'adminkey', 'admin_key', 'jwtsecret', 'secretkey',
]);

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function redact(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const normalised = key.toLowerCase().replace(/[^a-z_]/g, '');
    if (REDACT.has(normalised)) {
      out[key] = '[redacted]';
    } else if (normalised === 'email' && typeof v === 'string') {
      out[key] = maskEmail(v);
    } else {
      out[key] = redact(v, depth + 1);
    }
  }
  return out;
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '[redacted]';
  return `${local.slice(0, 2)}***@${domain}`;
}

function createLogger({ level = 'info', stream = process.stdout, now = () => new Date().toISOString() } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (lvl) => (message, fields = {}) => {
    if (LEVELS[lvl] < threshold) return;
    stream.write(`${JSON.stringify({ ts: now(), level: lvl, message, ...redact(fields) })}\n`);
  };

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child(bound) {
      const parent = this;
      const wrap = (lvl) => (message, fields = {}) => parent[lvl](message, { ...bound, ...fields });
      return {
        debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error'),
        child: (more) => parent.child({ ...bound, ...more }),
      };
    },
  };
}

module.exports = { createLogger, redact, maskEmail };
