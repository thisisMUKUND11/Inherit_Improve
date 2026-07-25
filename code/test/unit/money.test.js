const test = require('node:test');
const assert = require('node:assert/strict');
const {
  divideRoundHalfUp, applyBasisPoints, assertMinor, formatMinor, minorToDecimalNumber,
} = require('../../refactored/src/domain/money');

test('divideRoundHalfUp: halves go away from zero', () => {
  assert.equal(divideRoundHalfUp(3, 2), 2);
  assert.equal(divideRoundHalfUp(5, 2), 3);
  assert.equal(divideRoundHalfUp(-3, 2), -2);
  assert.equal(divideRoundHalfUp(1, 2), 1);
  assert.equal(divideRoundHalfUp(0, 2), 0);
});

test('divideRoundHalfUp: exact division is untouched', () => {
  assert.equal(divideRoundHalfUp(1000, 10), 100);
  assert.equal(divideRoundHalfUp(-1000, 10), -100);
});

test('divideRoundHalfUp: refuses non-integers and division by zero', () => {
  assert.throws(() => divideRoundHalfUp(1.5, 2), TypeError);
  assert.throws(() => divideRoundHalfUp(1, 0), RangeError);
});

test('applyBasisPoints: the case the float version fails', () => {
  // 1605 paise at 10% is 160.5, which is 161 to the paise.
  assert.equal(applyBasisPoints(1605, 1000), 161);
  // For comparison, the inherited expression, on the value the inherited code
  // actually holds -- 5.35 * 3, not the literal 16.05:
  assert.equal(Math.round(5.35 * 3 * 0.1 * 100) / 100, 1.6);
});

test('applyBasisPoints: tax examples', () => {
  assert.equal(applyBasisPoints(44900, 1800), 8082);
  assert.equal(applyBasisPoints(6505, 1800), 1171);
  assert.equal(applyBasisPoints(0, 1800), 0);
});

test('formatMinor: pads the minor unit', () => {
  assert.equal(formatMinor(1605), '16.05');
  assert.equal(formatMinor(5), '0.05');
  assert.equal(formatMinor(0), '0.00');
  assert.equal(formatMinor(100), '1.00');
  assert.equal(formatMinor(-1605), '-16.05');
});

test('minorToDecimalNumber: exact at the boundary the old code missed', () => {
  assert.equal(minorToDecimalNumber(1005), 10.05);
  assert.equal(minorToDecimalNumber(1605), 16.05);
});

test('assertMinor: a float amount is a bug, not a value to round', () => {
  assert.throws(() => assertMinor(10.5), TypeError);
  assert.throws(() => assertMinor(NaN), TypeError);
  assert.doesNotThrow(() => assertMinor(0));
  assert.doesNotThrow(() => assertMinor(-100));
});
