/*
 * Process entry point. The only file that reads the environment, opens a
 * socket, or installs signal handlers.
 */
const { loadConfig, ConfigError } = require('./config/env');
const { openDatabase } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { buildApp } = require('./app');

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\nConfiguration error:\n${err.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw err;
  }

  const db = openDatabase(config.databaseFile);
  migrate(db, { log: (m) => console.log(m) });

  const { app, outboxWorker, logger } = buildApp({ db, config });
  outboxWorker.start(config.outbox.pollMs);

  const server = app.listen(config.port, () => {
    logger.info('listening', { port: config.port, env: config.env });
  });

  // Finish in-flight requests before exiting, so a deploy does not fail the
  // checkout that happened to be in progress.
  const shutdown = (signal) => {
    logger.info('shutting down', { signal });
    outboxWorker.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) main();

module.exports = { main };
