/*
 * Legacy data access.
 *
 * The original team started on Postgres and moved to SQLite to cut hosting
 * costs, so this wrapper keeps the old promise-based `pg` shape. The awaits are
 * therefore real await points: two requests interleave here exactly as they
 * would against a networked database. That is what makes the oversell race in
 * server.js reproducible rather than theoretical.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const config = require('./config.json');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const handle = new DatabaseSync(config.dbPath);

const defer = (fn) => new Promise((resolve, reject) => {
  setImmediate(() => {
    try {
      resolve(fn());
    } catch (err) {
      reject(err);
    }
  });
});

// No migration tooling. The schema is created at boot, so nobody can tell you
// what shape production is actually in without SSHing in and looking.
handle.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    cost_price REAL NOT NULL,
    supplier TEXT,
    stock INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    value REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    items TEXT,
    subtotal REAL,
    discount REAL,
    shipping REAL,
    tax REAL,
    total REAL,
    coupon TEXT,
    status TEXT,
    created_at TEXT
  );
`);

function seedIfEmpty() {
  const { c } = handle.prepare('SELECT COUNT(*) AS c FROM products').get();
  if (c > 0) return;

  const insert = handle.prepare(
    'INSERT INTO products (id, name, price, cost_price, supplier, stock) VALUES (?, ?, ?, ?, ?, ?)',
  );
  // price is stored as REAL. Money in floating point: see docs, issue COR-1.
  insert.run(1, 'Filter Coffee 250g', 5.35, 2.1, 'Sunrise Estates', 500);
  insert.run(2, 'Cold Brew Bottle', 19.99, 8.4, 'Glassworks Ltd', 6);
  insert.run(3, 'Ceramic Mug', 9.99, 3.15, 'Potter & Sons', 120);
  insert.run(4, 'Espresso Machine', 449.0, 240.0, 'Bertolini SRL', 3);

  const coupon = handle.prepare(
    'INSERT INTO coupons (code, kind, value, active) VALUES (?, ?, ?, ?)',
  );
  coupon.run('WELCOME10', 'percent', 10, 1);
  coupon.run('FLAT50', 'fixed', 50, 1);
  coupon.run('EXPIRED', 'percent', 25, 0);
}

seedIfEmpty();

module.exports = {
  raw: handle,
  all: (sql, params = []) => defer(() => handle.prepare(sql).all(...params)),
  get: (sql, params = []) => defer(() => handle.prepare(sql).get(...params)),
  run: (sql, params = []) => defer(() => handle.prepare(sql).run(...params)),
  exec: (sql) => defer(() => handle.exec(sql)),
};
