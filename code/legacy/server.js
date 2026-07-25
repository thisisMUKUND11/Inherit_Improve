/*
 * OrderDesk API  --  the inherited codebase.
 *
 * This is the "working but poorly built" system described in the task. It runs,
 * it takes real orders, and it has been in production for four years. Nothing
 * here is exaggerated for effect: fat handlers, string-concatenated SQL,
 * committed credentials, money in floats, side effects inside the request path,
 * and one convenience endpoint that lets the browser run arbitrary SQL.
 *
 * Every defect is catalogued in docs/01-assessment.md with an ID (SEC-1, COR-2,
 * ...). The comments below point at those IDs.
 */
const express = require('express');
const path = require('node:path');

const config = require('./config.json'); // SEC-1: live credentials, committed
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TAX_RATE = 0.18;
const SHIPPING_FEE = 49;
const FREE_SHIPPING_OVER = 400;

// ---------------------------------------------------------------------------
// "Temporary" endpoint added in 2021 so the storefront could show stock levels
// without waiting for an API change. Still here. The browser sends SQL.
// SEC-2.
// ---------------------------------------------------------------------------
app.post('/db/sql', async (req, res) => {
  const { sql } = req.body;
  try {
    const rows = await db.all(sql);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// OBS-2: returns whatever columns the table happens to have, so cost_price and
// supplier go out to every storefront visitor.
app.get('/api/products', async (req, res) => {
  const rows = await db.all('SELECT * FROM products ORDER BY id');
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Price preview for the cart page.
// The pricing rules live here. They also live in POST /api/orders below, where
// somebody fixed a bug in 2022 and did not fix it here. COR-3.
// ---------------------------------------------------------------------------
app.post('/api/quote', async (req, res) => {
  const { items, coupon } = req.body;

  let subtotal = 0;
  for (const item of items) {
    const p = await db.get('SELECT * FROM products WHERE id = ' + item.productId);
    subtotal += p.price * item.qty;
  }

  let discount = 0;
  if (coupon) {
    // SEC-3: coupon code is interpolated straight into SQL.
    const c = await db.get("SELECT * FROM coupons WHERE code = '" + coupon + "' AND active = 1");
    if (c) {
      if (c.kind === 'percent') {
        discount = Math.round(subtotal * (c.value / 100) * 100) / 100; // COR-1
      } else {
        discount = c.value;
      }
    }
  }

  const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;

  // The discount comes off BEFORE tax here, so the customer is quoted tax on
  // what they actually pay. This is the correct behaviour. It is not what
  // checkout does. COR-3.
  const taxable = subtotal - discount + shipping;
  const tax = Math.round(taxable * TAX_RATE * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;

  // COR-1: subtotal is never rounded on this path, so the cart page renders
  // things like 16.049999999999997.
  res.json({ subtotal, discount, shipping, tax, total });
});

// ---------------------------------------------------------------------------
// Checkout. 120 lines of validation, pricing, stock, persistence, email and
// audit in one function. This is the handler the refactor in docs/03 takes on.
// ---------------------------------------------------------------------------
app.post('/api/orders', async (req, res) => {
 try {
  // SEC-4: the whole body is logged, including the card object the storefront
  // sends. These lines end up in the hosting provider's log retention.
  console.log('[order] incoming', JSON.stringify(req.body));

  const { email, items, coupon, card } = req.body;

  // ARC-2: no validation worth the name. qty is never checked, so a negative
  // quantity produces a negative total and puts stock back.
  if (!items) {
    return res.status(400).json({ error: 'no items' });
  }

  let subtotal = 0;
  const lines = [];
  for (const item of items) {
    const p = await db.get('SELECT * FROM products WHERE id = ' + item.productId);
    if (!p) {
      return res.status(400).json({ error: 'bad product' });
    }
    // COR-2: read-then-write with an await in between. Two concurrent orders
    // both see the old stock and both pass this check.
    if (p.stock < item.qty) {
      return res.status(400).json({ error: 'out of stock: ' + p.name });
    }
    subtotal += p.price * item.qty;
    lines.push({ productId: p.id, name: p.name, qty: item.qty, price: p.price });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;

  // COR-3: tax is charged on the FULL amount here, and the coupon is taken off
  // afterwards. /api/quote takes the coupon off first. The two handlers were
  // written six months apart and nobody noticed they disagree, because the
  // difference is exactly 18% of the discount -- pennies on a small coupon, and
  // invisible unless you compare the quote to the receipt.
  const preTax = subtotal + shipping;
  const tax = Math.round(preTax * TAX_RATE * 100) / 100;

  let discount = 0;
  if (coupon) {
    const c = await db.get("SELECT * FROM coupons WHERE code = '" + coupon + "' AND active = 1");
    if (c) {
      if (c.kind === 'percent') {
        discount = Math.round(subtotal * (c.value / 100) * 100) / 100;
      } else {
        discount = c.value;
      }
    }
  }

  const total = Math.round((preTax + tax - discount) * 100) / 100;

  // COR-2: no transaction. The insert and the four stock updates below are five
  // independent writes. A crash between them leaves the order half-applied.
  const result = await db.run(
    'INSERT INTO orders (email, items, subtotal, discount, shipping, tax, total, coupon, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      email,
      JSON.stringify(lines),
      subtotal,
      discount,
      shipping,
      tax,
      total,
      coupon || null,
      'paid',
      new Date().toISOString(),
    ],
  );

  for (const item of items) {
    await db.run(
      'UPDATE products SET stock = stock - ' + item.qty + ' WHERE id = ' + item.productId,
    );
  }

  if (card) {
    // The payment call is a stub in this exercise, but note the shape: it runs
    // after the order row is already committed, with no idempotency key.
    console.log('[order] charging card ending', String(card.number).slice(-4), 'via', config.payments.secretKey);
  }

  // REL-1: the confirmation email is awaited inside the request. If the mail
  // provider is having a bad afternoon the customer gets a 500 for an order
  // that has already been taken, already decremented stock, and already been
  // charged -- so they place it again.
  await sendConfirmationEmail(email, result.lastInsertRowid, total);

  res.json({
    id: result.lastInsertRowid,
    subtotal,
    discount,
    shipping,
    tax,
    total,
    status: 'paid',
  });
 } catch (e) {
  // Added after the March incident so the process would stop crashing. It
  // stops the crash and leaks the stack trace to the customer instead, and the
  // order rows written above this line stay exactly where they are. OBS-1.
  console.error(e);
  res.status(500).json({ error: e.message, stack: e.stack });
 }
});

// SEC-5: sequential integer ids and no authorisation. /api/orders/41 is
// somebody else's order and it will happily hand it over.
app.get('/api/orders/:id', async (req, res) => {
  const row = await db.get('SELECT * FROM orders WHERE id = ' + req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// SEC-6: shared admin key, passed in the query string, so it is in the browser
// history, the proxy logs and the access logs.
app.get('/admin/orders', async (req, res) => {
  if (req.query.key !== config.adminKey) return res.status(403).json({ error: 'nope' });
  const rows = await db.all('SELECT * FROM orders ORDER BY id DESC LIMIT 100');
  res.json(rows);
});

async function sendConfirmationEmail(to, orderId, total) {
  // Stubbed provider. The blackhole.test domain simulates the provider outage
  // we had in March; everything else "sends" successfully.
  if (String(to).endsWith('@blackhole.test')) {
    throw new Error('SMTP 421: service temporarily unavailable');
  }
  return { queued: true, to, orderId, total };
}

// OBS-1: no error handler, so an unhandled rejection returns Express's default
// HTML stack trace to the customer and nothing is recorded anywhere.

if (require.main === module) {
  const port = process.env.PORT || config.port;
  app.listen(port, () => console.log('legacy orderdesk listening on ' + port));
}

module.exports = app;
