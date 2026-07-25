/*
 * Migration runner.
 *
 * The legacy app created its schema at boot with CREATE TABLE IF NOT EXISTS,
 * which means nobody could answer "what shape is production in" without
 * connecting to it and looking. Here every change is a numbered file, applied
 * once, recorded in schema_migrations, and applied in the same order
 * everywhere -- laptop, CI, staging, production.
 *
 * Forward-only and additive by policy (see docs/02, expand/contract). A
 * migration that a running instance of the previous version cannot tolerate is
 * not allowed, because deploys overlap.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

function migrate(db, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.sync.all('SELECT name FROM schema_migrations').map((r) => r.name),
  );

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.sync.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [
        file,
        new Date().toISOString(),
      ]);
      db.exec('COMMIT');
      log(`applied ${file}`);
      count += 1;
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`, { cause: err });
    }
  }

  return count;
}

if (require.main === module) {
  const { loadConfig } = require('../config/env');
  const { openDatabase } = require('./connection');
  const config = loadConfig();
  const db = openDatabase(config.databaseFile);
  const n = migrate(db, { log: console.log });
  console.log(n === 0 ? 'schema up to date' : `${n} migration(s) applied`);
  db.close();
}

module.exports = { migrate, MIGRATIONS_DIR };
