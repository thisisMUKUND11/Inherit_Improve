/*
 * Configuration.
 *
 * Read once, validated once, at boot. Nothing else in the codebase touches
 * process.env, so there is exactly one place to look to answer "what does this
 * service need to run", and a missing secret is a startup crash with a useful
 * message rather than `undefined` reaching the payment provider.
 *
 * No default is provided for anything secret. A default for a secret is how
 * `jwtSecret: "changeme"` ends up in production for four years. allowlist-secret
 */

class ConfigError extends Error {}

function loadConfig(env = process.env) {
  const missing = [];

  const required = (key) => {
    const value = env[key];
    if (value === undefined || value === '') {
      missing.push(key);
      return undefined;
    }
    return value;
  };

  const int = (key, fallback) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isSafeInteger(n)) throw new ConfigError(`${key} must be an integer, got "${raw}"`);
    return n;
  };

  const config = {
    env: env.NODE_ENV ?? 'development',
    port: int('PORT', 3002),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseFile: required('DATABASE_FILE'),
    adminApiKey: required('ADMIN_API_KEY'),
    pricingPolicy: {
      taxBasisPoints: int('TAX_BASIS_POINTS', 1800),
      shippingFeeMinor: int('SHIPPING_FEE_MINOR', 4900),
      freeShippingThresholdMinor: int('FREE_SHIPPING_THRESHOLD_MINOR', 40000),
    },
    outbox: {
      pollMs: int('OUTBOX_POLL_MS', 1000),
      maxAttempts: int('OUTBOX_MAX_ATTEMPTS', 5),
    },
  };

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(', ')}.\n` +
      'Copy code/refactored/.env.example to .env and fill it in.',
    );
  }

  if (config.env === 'production' && config.adminApiKey.length < 32) {
    throw new ConfigError('ADMIN_API_KEY must be at least 32 characters in production');
  }

  return Object.freeze(config);
}

module.exports = { loadConfig, ConfigError };
