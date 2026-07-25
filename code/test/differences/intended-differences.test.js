/*
 * Intended differences.
 *
 * The contract suite proves what did NOT change. This one states what did, and
 * why, and proves both halves: that the inherited system really behaves the
 * way the assessment claims, and that the refactored one really does not.
 *
 * Every test here is a defect that the refactor fixes. Each is written as a
 * pair -- the legacy behaviour, then the new behaviour -- because "we fixed
 * it" is a claim and this is the evidence.
 *
 * A change in this file is a change customers or integrators can see. Each one
 * needs a decision from someone who is not an engineer, and a rollout plan.
 * See docs/02-migration-plan.md.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startTarget, asPaise, ROOT, wait } = require('../support/harness');

test('intended differences between the inherited and refactored systems', async (t) => {
  const legacy = await startTarget('legacy');
  const refactored = await startTarget('refactored');
  t.after(async () => { await legacy.stop(); await refactored.stop(); });

  // -------------------------------------------------------------------------
  await t.test('COR-3  the price quoted and the price charged now agree', async () => {
    const cart = { items: [{ productId: 4, qty: 1 }], coupon: 'FLAT50' };

    const legacyQuote = await legacy.quote(cart);
    const legacyOrder = await legacy.order({ email: 'a@example.com', ...cart });
    const overcharge = asPaise(legacyOrder.body.total) - asPaise(legacyQuote.body.total);

    assert.equal(asPaise(legacyQuote.body.total), 47082, 'legacy quotes 470.82');
    assert.equal(asPaise(legacyOrder.body.total), 47982, 'legacy charges 479.82');
    assert.equal(overcharge, 900, 'the customer pays Rs 9.00 more than they were shown');
    // 900 paise is exactly 18% of the Rs 50 discount: the legacy checkout taxes
    // the pre-discount amount, so the customer pays tax on money they saved.
    assert.equal(overcharge, asPaise(legacyQuote.body.discount) * 0.18);

    const newQuote = await refactored.quote(cart);
    const newOrder = await refactored.order({ email: 'a@example.com', ...cart });
    assert.equal(asPaise(newQuote.body.total), asPaise(newOrder.body.total));
    assert.equal(asPaise(newOrder.body.total), 47082, 'the quoted price is the one charged');
  });

  // -------------------------------------------------------------------------
  await t.test('COR-3  quote and checkout agree on every cart, not just this one', async () => {
    const carts = [];
    for (const productId of [1, 3]) {
      for (let qty = 1; qty <= 5; qty += 1) {
        for (const coupon of [undefined, 'WELCOME10', 'FLAT50']) {
          carts.push({ items: [{ productId, qty }], coupon });
        }
      }
    }

    const divergences = { legacy: 0, refactored: 0 };
    const legacyCouponCarts = { total: 0, diverged: 0 };

    for (const cart of carts) {
      for (const [name, app] of [['legacy', legacy], ['refactored', refactored]]) {
        const q = await app.quote(cart);
        const o = await app.order({ email: 'matrix@example.com', ...cart });
        const differs = asPaise(q.body.total) !== asPaise(o.body.total);
        if (differs) divergences[name] += 1;
        if (name === 'legacy' && cart.coupon) {
          legacyCouponCarts.total += 1;
          if (differs) legacyCouponCarts.diverged += 1;
        }
      }
    }

    assert.equal(divergences.refactored, 0, 'refactored: quote always equals charge');
    assert.equal(
      legacyCouponCarts.diverged, legacyCouponCarts.total,
      `legacy: every one of the ${legacyCouponCarts.total} coupon carts was charged a different price than quoted`,
    );
    assert.equal(divergences.legacy, legacyCouponCarts.total, 'legacy: only coupon carts diverge, which is why nobody noticed');
  });

  // -------------------------------------------------------------------------
  await t.test('COR-1  money is no longer computed in floating point', async () => {
    const cart = { items: [{ productId: 1, qty: 3 }], coupon: 'WELCOME10' };

    // 5.35 x 3 = 16.05. Ten percent of that is 1.605, which rounds to 1.61.
    // Math.round(16.05 * 0.1 * 100) / 100 gives 1.60, because the float sits
    // fractionally below the boundary.
    const legacyQuote = await legacy.quote(cart);
    assert.equal(asPaise(legacyQuote.body.discount), 160, 'legacy discounts 1.60');

    const newQuote = await refactored.quote(cart);
    assert.equal(asPaise(newQuote.body.discount), 161, 'exact arithmetic discounts 1.61');
  });

  await t.test('COR-1  the API no longer serialises float noise', async () => {
    const { body: legacyBody } = await legacy.quote({ items: [{ productId: 1, qty: 3 }] });
    assert.equal(legacyBody.subtotal, 16.049999999999997, 'the cart page renders this to customers');

    const { body: newBody } = await refactored.quote({ items: [{ productId: 1, qty: 3 }] });
    assert.equal(newBody.subtotal, 16.05);
    assert.equal(newBody.subtotalMinor, 1605, 'and an exact integer is available for new clients');
  });

  // -------------------------------------------------------------------------
  await t.test('COR-2  concurrent checkouts can no longer oversell', async () => {
    // Six bottles in stock. Two customers order four each, at the same moment.
    const buy = (app) => app.order({ email: 'race@example.com', items: [{ productId: 2, qty: 4 }] });

    const legacyResults = await Promise.all([buy(legacy), buy(legacy)]);
    const legacyStock = (await legacy.productById(2)).stock;
    assert.equal(legacyResults.filter((r) => r.status === 200).length, 2, 'legacy accepted both');
    assert.equal(legacyStock, -2, 'legacy sold two bottles it does not have');

    const newResults = await Promise.all([buy(refactored), buy(refactored)]);
    const newStock = (await refactored.productById(2)).stock;
    assert.equal(newResults.filter((r) => r.status === 200).length, 1, 'exactly one succeeds');
    assert.equal(newResults.filter((r) => r.status === 400).length, 1, 'the other is told it is out of stock');
    assert.equal(newStock, 2, 'stock is never negative');
  });

  // -------------------------------------------------------------------------
  await t.test('ARC-2  a negative quantity is rejected instead of paying the customer', async () => {
    const cart = { email: 'refund@example.com', items: [{ productId: 3, qty: -5 }] };

    const stockBefore = (await legacy.productById(3)).stock;
    const legacyResult = await legacy.order(cart);
    const stockAfter = (await legacy.productById(3)).stock;
    assert.equal(legacyResult.status, 200, 'legacy accepted it');
    assert.ok(legacyResult.body.total < 0, `legacy produced a total of ${legacyResult.body.total}`);
    assert.equal(stockAfter, stockBefore + 5, 'and put five mugs back on the shelf');

    const newResult = await refactored.order(cart);
    assert.equal(newResult.status, 400);
    assert.equal(newResult.body.code, 'validation_error');
    assert.equal(newResult.body.details[0].field, 'items[0].qty');
  });

  // -------------------------------------------------------------------------
  await t.test('SEC-3  the coupon field is no longer a SQL console', async () => {
    // Closes the string, adds a condition that matches a real coupon, comments
    // out the rest. No valid code, Rs 50 off.
    const injection = "X' OR kind='fixed' --";

    const legacyResult = await legacy.quote({ items: [{ productId: 4, qty: 1 }], coupon: injection });
    assert.equal(asPaise(legacyResult.body.discount), 5000, 'legacy handed out Rs 50 for a made-up code');

    const newResult = await refactored.quote({ items: [{ productId: 4, qty: 1 }], coupon: injection });
    assert.equal(newResult.status, 400);
    assert.equal(newResult.body.code, 'validation_error');
  });

  // -------------------------------------------------------------------------
  await t.test('SEC-2  the browser can no longer execute SQL', async () => {
    const legacyResult = await legacy.post('/db/sql', { sql: 'SELECT code FROM coupons' });
    assert.equal(legacyResult.status, 200);
    assert.ok(Array.isArray(legacyResult.body) && legacyResult.body.length >= 3,
      'legacy ran arbitrary SQL sent from a browser');

    const newResult = await refactored.post('/db/sql', { sql: 'SELECT code FROM coupons' });
    assert.equal(newResult.status, 404, 'the endpoint does not exist');
  });

  await t.test('SEC-2  cost price and supplier are no longer published to customers', async () => {
    const [legacyProduct] = await legacy.products();
    assert.ok('cost_price' in legacyProduct, 'legacy publishes the margin on every product');
    assert.ok('supplier' in legacyProduct);

    const [newProduct] = await refactored.products();
    assert.ok(!('cost_price' in newProduct) && !('costMinor' in newProduct));
    assert.ok(!('supplier' in newProduct));
    assert.deepEqual(Object.keys(newProduct).sort(), ['id', 'name', 'price', 'priceMinor', 'stock']);
  });

  // -------------------------------------------------------------------------
  await t.test("SEC-5  one customer can no longer read another customer's order", async () => {
    await legacy.order({ email: 'private@example.com', items: [{ productId: 1, qty: 1 }] });
    const leaked = await legacy.get('/api/orders/1');
    assert.equal(leaked.status, 200);
    assert.ok(leaked.body.email, `legacy handed over ${leaked.body.email} to an anonymous caller`);

    const placed = await refactored.order({ email: 'private@example.com', items: [{ productId: 1, qty: 1 }] });
    const guessed = await refactored.get('/api/orders/1');
    assert.equal(guessed.status, 404, 'sequential ids are not addressable');

    const withToken = await refactored.get(`/api/orders/${placed.body.publicId}`);
    assert.equal(withToken.status, 200, 'the customer with the link still gets their order');
    assert.equal(withToken.body.email, 'private@example.com');
  });

  // -------------------------------------------------------------------------
  await t.test('REL-1  a mail provider outage no longer fails the checkout', async () => {
    const cart = { email: 'customer@blackhole.test', items: [{ productId: 1, qty: 1 }] };

    const legacyResult = await legacy.order(cart);
    assert.equal(legacyResult.status, 500, 'legacy returned an error to the customer');
    assert.ok(legacyResult.body.stack, 'with a stack trace in the response body');
    const legacyOrders = await legacy.adminOrders();
    assert.ok(
      legacyOrders.body.some((o) => o.email === 'customer@blackhole.test'),
      'and the order was taken anyway, so the customer who retries is charged twice',
    );

    const newResult = await refactored.order(cart);
    assert.equal(newResult.status, 200, 'the customer is told the order succeeded, because it did');
    assert.ok(newResult.body.publicId);
    assert.equal(newResult.body.stack, undefined);

    // The confirmation email is a committed intent, retried by a worker.
    let outbox = [];
    for (let i = 0; i < 40 && !outbox.some((m) => m.attempts > 0); i += 1) {
      await wait(100);
      outbox = (await refactored.adminOutbox()).body;
    }
    const message = outbox.find((m) => m.topic === 'order.confirmation_email' && m.attempts > 0);
    assert.ok(message, 'the email attempt is recorded and retried');
    assert.match(message.last_error, /SMTP 421/);

    const stored = await refactored.get(`/api/orders/${newResult.body.publicId}`);
    assert.equal(stored.status, 200, 'and the order is intact regardless');
  });

  // -------------------------------------------------------------------------
  await t.test('OBS-1  a server error no longer leaks internals to the customer', async () => {
    const legacyResult = await legacy.order({
      email: 'customer@blackhole.test', items: [{ productId: 1, qty: 1 }],
    });
    assert.ok(legacyResult.body.stack.includes('sendConfirmationEmail'),
      'legacy returns file paths and function names');

    // The refactored system has no equivalent failure to trigger, which is the
    // point; the shape of its 500 is asserted in the unit tests for the error
    // handler. What is asserted here is that no response carries a stack.
    const responses = await Promise.all([
      refactored.order({ email: 'not-an-email', items: [{ productId: 1, qty: 1 }] }),
      refactored.get('/api/orders/does-not-exist'),
      refactored.get('/nope'),
      refactored.get('/admin/orders'),
    ]);
    for (const r of responses) {
      assert.equal(r.body.stack, undefined);
      assert.ok(r.body.code, 'every error carries a machine-readable code instead');
    }
  });

  // -------------------------------------------------------------------------
  await t.test('SEC-6  the admin key is no longer accepted in the query string', async () => {
    const legacyResult = await legacy.get(`/admin/orders?key=${legacy.adminKey}`);
    assert.equal(legacyResult.status, 200, 'legacy authenticates from the URL, which is logged everywhere');

    const viaQuery = await refactored.get(`/admin/orders?key=${refactored.adminKey}`);
    assert.equal(viaQuery.status, 401);

    const viaHeader = await refactored.get('/admin/orders', { 'x-admin-key': refactored.adminKey });
    assert.equal(viaHeader.status, 200);
  });
});

// ---------------------------------------------------------------------------
test('SEC-1  secrets', async (t) => {
  await t.test('the inherited repository contains its production credentials', () => {
    const committed = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'code', 'legacy', 'config.json'), 'utf8'),
    );
    assert.ok(committed.adminKey);
    assert.ok(committed.smtp.pass);
    assert.match(committed.payments.secretKey, /^sk_live_/);
  });

  await t.test('the refactored service has no committed secrets and refuses to boot without them', async () => {
    const files = fs.readdirSync(path.join(ROOT, 'code', 'refactored'));
    assert.ok(!files.includes('.env'), 'no .env in the repository');
    assert.ok(files.includes('.env.example'), 'only the template is committed');

    const child = spawn(
      process.execPath,
      ['--experimental-sqlite', path.join(ROOT, 'code', 'refactored', 'src', 'main.js')],
      { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const code = await new Promise((resolve) => child.on('exit', resolve));

    assert.equal(code, 78, 'exits EX_CONFIG rather than starting half-configured');
    assert.match(stderr, /Missing required environment variables/);
    assert.match(stderr, /DATABASE_FILE/);
    assert.match(stderr, /ADMIN_API_KEY/);
  });
});
