/*
 * Money.
 *
 * One rule: amounts are integers in the currency's minor unit (paise). No
 * float ever touches an amount. Conversion to a decimal happens once, at the
 * edge, on the way out.
 *
 * The legacy system stored prices as REAL and rounded with
 * Math.round(x * 100) / 100. That expression is wrong for any value whose
 * float representation sits just below a half-paise boundary:
 *
 *   Math.round(1.005 * 100) / 100  ->  1     (1.005 is stored as 1.00499...)
 *
 * It is wrong rarely enough to survive four years in production and often
 * enough to make the books not balance.
 */

/** Round a rational to the nearest integer, halves away from zero. */
function divideRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new TypeError('divideRoundHalfUp expects integers');
  }
  if (denominator === 0) throw new RangeError('division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator) || 1;
  const q = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * q + d) / (2 * d));
}

/** basis points of an amount, e.g. applyBasisPoints(44900, 1800) -> 8082 */
function applyBasisPoints(amountMinor, basisPoints) {
  assertMinor(amountMinor);
  return divideRoundHalfUp(amountMinor * basisPoints, 10000);
}

function assertMinor(value) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`amount must be an integer in minor units, got ${value}`);
  }
}

/** 1605 -> "16.05". Presentation only. */
function formatMinor(amountMinor) {
  assertMinor(amountMinor);
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * 1605 -> 16.05, for the JSON body only.
 *
 * The wire format is a decimal number because that is the contract the
 * storefront and three integrations already depend on. Responses also carry
 * the exact `*_minor` integers so new clients can stop parsing floats; the
 * decimal fields are deprecated, not removed. See docs/02, "expand/contract".
 */
function minorToDecimalNumber(amountMinor) {
  return Number(formatMinor(amountMinor));
}

module.exports = {
  divideRoundHalfUp,
  applyBasisPoints,
  assertMinor,
  formatMinor,
  minorToDecimalNumber,
};
