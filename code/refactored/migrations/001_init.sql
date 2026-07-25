-- 001_init.sql
--
-- Money is stored in integer minor units (paise). There is no REAL column in
-- this schema and there never will be one.
--
-- In the real migration this file is the end state of the expand/contract
-- sequence described in docs/02-migration-plan.md, week 3: add price_minor,
-- dual-write, backfill, reconcile against price, cut reads over, drop price.

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  price_minor   INTEGER NOT NULL CHECK (price_minor >= 0),
  cost_minor    INTEGER NOT NULL CHECK (cost_minor >= 0),
  supplier      TEXT,
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
);

-- The legacy table had one `value` column meaning "percent" or "paise"
-- depending on `kind`, which is how you end up applying 50% off instead of
-- Rs 50 off. The constraint below makes that state unrepresentable.
CREATE TABLE IF NOT EXISTS coupons (
  code         TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  percent_bp   INTEGER CHECK (percent_bp BETWEEN 0 AND 10000),
  amount_minor INTEGER CHECK (amount_minor >= 0),
  active       INTEGER NOT NULL DEFAULT 1,
  CHECK (
    (kind = 'percent' AND percent_bp   IS NOT NULL AND amount_minor IS NULL) OR
    (kind = 'fixed'   AND amount_minor IS NOT NULL AND percent_bp   IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id      TEXT    NOT NULL UNIQUE,
  email          TEXT    NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL,
  shipping_minor INTEGER NOT NULL,
  tax_minor      INTEGER NOT NULL,
  total_minor    INTEGER NOT NULL,
  coupon_code    TEXT,
  status         TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS order_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  name_at_purchase TEXT    NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  line_total_minor INTEGER NOT NULL
);

-- Side effects that must happen after the order commits, not during it.
CREATE TABLE IF NOT EXISTS outbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic        TEXT    NOT NULL,
  payload      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  available_at TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order  ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_email       ON orders(email);
CREATE INDEX IF NOT EXISTS idx_outbox_dispatchable ON outbox(status, available_at);
