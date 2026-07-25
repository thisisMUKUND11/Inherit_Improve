/*
 * Pricing is a pure function, so it can be tested exhaustively and in
 * milliseconds. There is no server here, no database, no fixture file and no
 * mock. This is the argument for pulling logic out of route handlers, made
 * concrete: none of these cases could be written against the inherited system
 * without starting a web server and a database first.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceOrder, discountFor } = require('../../refactored/src/domain/pricing');

const POLICY = { taxBasisPoints: 1800, shippingFeeMinor: 4900, freeShippingThresholdMinor: 40000 };
const line = (unitPriceMinor, qty) => ({ productId: 1, name: 'x', unitPriceMinor, qty });

test('pricing: worked examples', async (t) => {
  await t.test('single item over the free shipping threshold', () => {
    const r = priceOrder({ lines: [line(44900, 1)], policy: POLICY });
    assert.deepEqual(
      { s: r.subtotalMinor, d: r.discountMinor, sh: r.shippingMinor, tx: r.taxMinor, tt: r.totalMinor },
      { s: 44900, d: 0, sh: 0, tx: 8082, tt: 52982 },
    );
  });

  await t.test('small basket pays shipping, and shipping is taxed', () => {
    const r = priceOrder({ lines: [line(535, 3)], policy: POLICY });
    assert.equal(r.subtotalMinor, 1605);
    assert.equal(r.shippingMinor, 4900);
    assert.equal(r.taxMinor, 1171); // 18% of 6505 = 1170.9 -> 1171
    assert.equal(r.totalMinor, 7676);
  });

  await t.test('a percentage coupon reduces the taxable amount', () => {
    const r = priceOrder({
      lines: [line(44900, 1)],
      coupon: { kind: 'percent', percentBp: 1000 },
      policy: POLICY,
    });
    assert.equal(r.discountMinor, 4490);
    assert.equal(r.taxMinor, 7274); // 18% of 40410 = 7273.8 -> 7274
    assert.equal(r.totalMinor, 47684);
  });

  await t.test('a fixed coupon reduces the taxable amount', () => {
    const r = priceOrder({
      lines: [line(44900, 1)],
      coupon: { kind: 'fixed', amountMinor: 5000 },
      policy: POLICY,
    });
    assert.equal(r.discountMinor, 5000);
    assert.equal(r.totalMinor, 47082);
  });
});

test('pricing: the rounding case that the float implementation got wrong', () => {
  // 5.35 x 3 = 16.05.  10% = 1.605, which is 1.61 to the paise.
  // Math.round(16.05 * 0.1 * 100) / 100 answers 1.60.
  const r = priceOrder({
    lines: [line(535, 3)],
    coupon: { kind: 'percent', percentBp: 1000 },
    policy: POLICY,
  });
  assert.equal(r.discountMinor, 161);
});

test('pricing: a coupon cannot make an order negative', () => {
  const r = priceOrder({
    lines: [line(999, 1)],
    coupon: { kind: 'fixed', amountMinor: 5000 },
    policy: POLICY,
  });
  assert.equal(r.discountMinor, 999, 'capped at the subtotal');
  assert.equal(r.totalMinor, 5782, 'shipping and its tax still apply');
  assert.ok(r.totalMinor > 0);
});

test('pricing: free shipping boundary is inclusive', () => {
  const under = priceOrder({ lines: [line(39999, 1)], policy: POLICY });
  const exact = priceOrder({ lines: [line(40000, 1)], policy: POLICY });
  assert.equal(under.shippingMinor, 4900);
  assert.equal(exact.shippingMinor, 0);
});

test('pricing: free shipping is earned before the discount is applied', () => {
  // A coupon must not cost the customer their free shipping. Confirmed with
  // the business; both legacy code paths already agreed on this one.
  const r = priceOrder({
    lines: [line(40000, 1)],
    coupon: { kind: 'fixed', amountMinor: 5000 },
    policy: POLICY,
  });
  assert.equal(r.shippingMinor, 0);
});

test('pricing: invariants hold across the whole realistic input space', () => {
  let checked = 0;
  for (let priceMinor = 1; priceMinor <= 60000; priceMinor += 137) {
    for (let qty = 1; qty <= 5; qty += 1) {
      for (const coupon of [
        null,
        { kind: 'percent', percentBp: 1000 },
        { kind: 'percent', percentBp: 10000 },
        { kind: 'fixed', amountMinor: 5000 },
      ]) {
        const r = priceOrder({ lines: [line(priceMinor, qty)], coupon, policy: POLICY });
        checked += 1;

        assert.ok(Number.isSafeInteger(r.totalMinor), 'totals are always integers');
        assert.ok(r.totalMinor >= 0, 'a customer is never owed money by the pricer');
        assert.ok(r.discountMinor <= r.subtotalMinor, 'a discount never exceeds the goods');
        assert.equal(
          r.totalMinor,
          r.subtotalMinor - r.discountMinor + r.shippingMinor + r.taxMinor,
          'the breakdown always adds up to the total',
        );
        assert.equal(
          r.subtotalMinor,
          r.lines.reduce((sum, l) => sum + l.lineTotalMinor, 0),
          'the lines always add up to the subtotal',
        );
      }
    }
  }
  assert.ok(checked > 8000, `expected a wide sweep, checked ${checked}`);
});

test('pricing: rejects input the validation layer should have caught', () => {
  assert.throws(() => priceOrder({ lines: [], policy: POLICY }), TypeError);
  assert.throws(() => priceOrder({ lines: [line(100, 0)], policy: POLICY }), TypeError);
  assert.throws(() => priceOrder({ lines: [line(100, -1)], policy: POLICY }), TypeError);
  assert.throws(() => priceOrder({ lines: [line(10.5, 1)], policy: POLICY }), TypeError);
});

test('discountFor: no coupon means no discount', () => {
  assert.equal(discountFor(1000, null), 0);
});
