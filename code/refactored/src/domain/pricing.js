/*
 * Pricing. The single source of truth for what an order costs.
 *
 * This module is pure: no database, no express, no clock, no configuration
 * lookup. Everything it needs arrives as an argument, so it can be tested
 * exhaustively in microseconds and reused by anything that needs a price --
 * the quote endpoint, checkout, the admin refund tool, the CSV importer.
 *
 * That is the whole point of the refactor. In the legacy system these rules
 * were written twice, in two route handlers, and the two copies disagreed.
 *
 * ---------------------------------------------------------------------------
 * THE RULES (confirmed with finance on 12 Mar -- see ADR-0003)
 * ---------------------------------------------------------------------------
 *   1. line total       = unit price x quantity                    (exact)
 *   2. subtotal         = sum of line totals
 *   3. discount         = percent of subtotal, or a fixed amount,
 *                         capped at the subtotal (never negative money)
 *   4. shipping         = free once the PRE-discount subtotal clears the
 *                         threshold, otherwise a flat fee
 *   5. tax              = rate x (subtotal - discount + shipping)
 *   6. total            = subtotal - discount + shipping + tax
 *
 * Rule 5 is the one the legacy code got wrong at checkout: it taxed the
 * pre-discount amount, so every coupon order collected an extra 18% of the
 * discount from the customer. The quote endpoint had it right. When two code
 * paths disagree you cannot "preserve existing behaviour" -- someone has to
 * decide which one was correct, and that someone is not the engineer.
 */

const { applyBasisPoints, assertMinor } = require('./money');

/**
 * @param {object} input
 * @param {Array<{productId:number,name:string,unitPriceMinor:number,qty:number}>} input.lines
 * @param {{kind:'percent'|'fixed',percentBp?:number,amountMinor?:number}|null} input.coupon
 * @param {{taxBasisPoints:number,shippingFeeMinor:number,freeShippingThresholdMinor:number}} input.policy
 */
function priceOrder({ lines, coupon = null, policy }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new TypeError('priceOrder requires at least one line');
  }

  const pricedLines = lines.map((line) => {
    assertMinor(line.unitPriceMinor);
    if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
      throw new TypeError(`quantity must be a positive integer, got ${line.qty}`);
    }
    return { ...line, lineTotalMinor: line.unitPriceMinor * line.qty };
  });

  const subtotalMinor = pricedLines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  const discountMinor = discountFor(subtotalMinor, coupon);
  const shippingMinor = subtotalMinor >= policy.freeShippingThresholdMinor
    ? 0
    : policy.shippingFeeMinor;

  const taxableMinor = subtotalMinor - discountMinor + shippingMinor;
  const taxMinor = applyBasisPoints(taxableMinor, policy.taxBasisPoints);
  const totalMinor = taxableMinor + taxMinor;

  return {
    lines: pricedLines,
    subtotalMinor,
    discountMinor,
    shippingMinor,
    taxMinor,
    totalMinor,
  };
}

function discountFor(subtotalMinor, coupon) {
  if (!coupon) return 0;
  const raw = coupon.kind === 'percent'
    ? applyBasisPoints(subtotalMinor, coupon.percentBp)
    : coupon.amountMinor;
  // A coupon can take the order to zero. It cannot take it below zero, which
  // is what the legacy code did when FLAT50 met a Rs 39.98 cart.
  return Math.min(raw, subtotalMinor);
}

module.exports = { priceOrder, discountFor };
