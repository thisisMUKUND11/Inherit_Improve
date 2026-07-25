/*
 * The contract.
 *
 * This suite is the safety net. It is the behaviour real customers depend on,
 * written down and executed against BOTH the inherited system and the
 * refactored one, from an identical starting state.
 *
 * It was written before a line of the refactor, against the legacy system, by
 * observing what it does -- not what anyone thinks it should do. Two of these
 * assertions encode behaviour that is arguably wrong (a 400 where 409 belongs,
 * a 200 where 201 belongs). They are here anyway, because the job of this file
 * is to detect change, not to have opinions. Opinions go in the differences
 * suite next door, where each intended change is stated, justified and tested.
 *
 * If every test here passes on both targets, the refactor is safe to ship
 * behind a flag. That sentence is the whole migration strategy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTarget, TARGETS, asPaise } = require('../support/harness');

const CATALOGUE = [
  { id: 1, name: 'Filter Coffee 250g', price: 5.35, stock: 500 },
  { id: 2, name: 'Cold Brew Bottle', price: 19.99, stock: 6 },
  { id: 3, name: 'Ceramic Mug', price: 9.99, stock: 120 },
  { id: 4, name: 'Espresso Machine', price: 449, stock: 3 },
];

/** Assert two price breakdowns are equal to the paise. */
function assertMoneyEqual(actual, expected, label) {
  for (const field of ['subtotal', 'discount', 'shipping', 'tax', 'total']) {
    assert.equal(
      asPaise(actual[field]), asPaise(expected[field]),
      `${label}: ${field} was ${actual[field]}, expected ${expected[field]}`,
    );
  }
}

for (const target of TARGETS) {
  test(`contract [${target}]`, async (t) => {
    const app = await startTarget(target);
    t.after(() => app.stop());

    await t.test('the catalogue is what the storefront expects', async () => {
      const products = await app.products();
      assert.equal(products.length, 4);
      for (const expected of CATALOGUE) {
        const actual = products.find((p) => p.id === expected.id);
        assert.ok(actual, `product ${expected.id} missing`);
        assert.equal(actual.name, expected.name);
        assert.equal(asPaise(actual.price), asPaise(expected.price));
        assert.equal(actual.stock, expected.stock);
      }
    });

    await t.test('quote: single high-value item, free shipping, no coupon', async () => {
      const { status, body } = await app.quote({ items: [{ productId: 4, qty: 1 }] });
      assert.equal(status, 200);
      assertMoneyEqual(body, {
        subtotal: 449, discount: 0, shipping: 0, tax: 80.82, total: 529.82,
      }, 'quote');
    });

    await t.test('quote: small basket, shipping charged, no coupon', async () => {
      const { status, body } = await app.quote({ items: [{ productId: 1, qty: 3 }] });
      assert.equal(status, 200);
      assertMoneyEqual(body, {
        subtotal: 16.05, discount: 0, shipping: 49, tax: 11.71, total: 76.76,
      }, 'quote');
    });

    await t.test('quote: multiple lines', async () => {
      const { body } = await app.quote({ items: [{ productId: 2, qty: 2 }, { productId: 3, qty: 1 }] });
      assertMoneyEqual(body, {
        subtotal: 49.97, discount: 0, shipping: 49, tax: 17.81, total: 116.78,
      }, 'quote');
    });

    await t.test('checkout: charges the quoted price and returns an order id', async () => {
      const cart = { email: 'buyer@example.com', items: [{ productId: 4, qty: 1 }] };
      const quoted = await app.quote({ items: cart.items });
      const { status, body } = await app.order(cart);

      assert.equal(status, 200);
      assert.equal(body.status, 'paid');
      assert.ok(Number.isInteger(body.id) && body.id > 0, 'order id should be a positive integer');
      assertMoneyEqual(body, quoted.body, 'checkout vs quote');
    });

    await t.test('checkout: decrements stock by the quantity ordered', async () => {
      const before = await app.productById(3);
      await app.order({ email: 'buyer@example.com', items: [{ productId: 3, qty: 4 }] });
      const after = await app.productById(3);
      assert.equal(after.stock, before.stock - 4);
    });

    await t.test('checkout: rejects a basket larger than available stock', async () => {
      const { status, body } = await app.order({
        email: 'buyer@example.com',
        items: [{ productId: 2, qty: 99 }],
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'out of stock: Cold Brew Bottle');
    });

    await t.test('checkout: rejects an unknown product', async () => {
      const { status, body } = await app.order({
        email: 'buyer@example.com',
        items: [{ productId: 9999, qty: 1 }],
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'bad product');
    });

    await t.test('checkout: rejects a request with no items', async () => {
      const { status, body } = await app.order({ email: 'buyer@example.com' });
      assert.equal(status, 400);
      assert.equal(body.error, 'no items');
    });

    await t.test('an unknown coupon code is ignored, not an error', async () => {
      const { status, body } = await app.quote({
        items: [{ productId: 4, qty: 1 }],
        coupon: 'NOTACOUPON',
      });
      assert.equal(status, 200);
      assert.equal(asPaise(body.discount), 0);
    });

    await t.test('an inactive coupon gives no discount', async () => {
      const { body } = await app.quote({ items: [{ productId: 4, qty: 1 }], coupon: 'EXPIRED' });
      assert.equal(asPaise(body.discount), 0);
    });
  });
}
