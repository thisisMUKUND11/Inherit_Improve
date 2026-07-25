/*
 * Database connection and unit of work.
 *
 * Two things matter here.
 *
 * 1. Every statement is prepared with bound parameters. There is no code path
 *    in this application that concatenates a value into SQL, and the
 *    architecture test in code/test/unit/architecture.test.js fails the build
 *    if one appears.
 *
 * 2. `transaction(fn)` runs fn to completion with no await inside it. That is
 *    deliberate and it is a rule, not an accident of the driver: an open
 *    transaction holds locks, and awaiting a mail provider or a payment API
 *    while holding them is how a slow third party becomes a database outage.
 *    Side effects go in the outbox and happen after the commit.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(databaseFile) {
  if (databaseFile !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databaseFile)), { recursive: true });
  }
  const handle = new DatabaseSync(databaseFile);
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA journal_mode = WAL');

  const scope = {
    all: (sql, params = []) => handle.prepare(sql).all(...params),
    get: (sql, params = []) => handle.prepare(sql).get(...params),
    run: (sql, params = []) => handle.prepare(sql).run(...params),
  };

  const defer = (fn) => new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    });
  });

  return {
    // Async read path, so the shape matches a networked driver and the
    // comparison with the legacy system is like for like.
    all: (sql, params = []) => defer(() => scope.all(sql, params)),
    get: (sql, params = []) => defer(() => scope.get(sql, params)),
    run: (sql, params = []) => defer(() => scope.run(sql, params)),

    /** BEGIN IMMEDIATE ... COMMIT, or ROLLBACK on any throw. */
    transaction(fn) {
      return defer(() => {
        handle.exec('BEGIN IMMEDIATE');
        try {
          const result = fn(scope);
          if (result && typeof result.then === 'function') {
            handle.exec('ROLLBACK');
            throw new TypeError('transaction(fn) must be synchronous: no I/O inside a transaction');
          }
          handle.exec('COMMIT');
          return result;
        } catch (err) {
          try { handle.exec('ROLLBACK'); } catch { /* already rolled back */ }
          throw err;
        }
      });
    },

    exec: (sql) => handle.exec(sql),
    close: () => handle.close(),

    // Synchronous scope. Used by the migration runner and by tests that need
    // to assert on state without racing the app. Application code uses the
    // async methods above or `transaction`.
    sync: scope,
  };
}

module.exports = { openDatabase };
