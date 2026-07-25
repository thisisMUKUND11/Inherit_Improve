-- 002_reference_data.sql
--
-- The same catalogue the legacy app seeds at boot, so the contract tests can
-- compare the two systems from an identical starting state. Prices are the
-- same amounts, expressed in paise.

INSERT OR IGNORE INTO products (id, name, price_minor, cost_minor, supplier, stock) VALUES
  (1, 'Filter Coffee 250g',  535,   210, 'Sunrise Estates', 500),
  (2, 'Cold Brew Bottle',   1999,   840, 'Glassworks Ltd',    6),
  (3, 'Ceramic Mug',         999,   315, 'Potter & Sons',   120),
  (4, 'Espresso Machine',  44900, 24000, 'Bertolini SRL',     3);

INSERT OR IGNORE INTO coupons (code, kind, percent_bp, amount_minor, active) VALUES
  ('WELCOME10', 'percent', 1000, NULL, 1),
  ('FLAT50',    'fixed',   NULL, 5000, 1),
  ('EXPIRED',   'percent', 2500, NULL, 0);
