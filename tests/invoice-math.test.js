'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { round2, lineAmount, calculateTotals } = require('../invoice-math.js');

test('round2 rounds half away from zero and survives float noise', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(NaN), 0);
});

test('line amount is quantity x price rounded to 2 decimals', () => {
  assert.equal(lineAmount({ quantity: 3, unitPrice: 19.99 }), 59.97);
  assert.equal(lineAmount({ quantity: 1.5, unitPrice: 33.333 }), 50);
  assert.equal(lineAmount({ quantity: '2', unitPrice: '1,250.50' }), 2501);
});

test('subtotal sums rounded lines, not raw products', () => {
  // 3 x 0.335 = 1.005 -> 1.01 each; summing raw would give 2.01.
  const t = calculateTotals({ items: [
    { quantity: 3, unitPrice: 0.335 },
    { quantity: 3, unitPrice: 0.335 }
  ] });
  assert.equal(t.subtotal, 2.02);
  assert.equal(t.total, 2.02);
});

test('per-line tax is applied to each line separately', () => {
  const t = calculateTotals({ items: [
    { quantity: 2, unitPrice: 100, taxRate: 20 },
    { quantity: 1, unitPrice: 50, taxRate: 0 },
    { quantity: 1, unitPrice: 10.05, taxRate: 5 }
  ] });
  assert.equal(t.subtotal, 260.05);
  assert.deepEqual(t.lines.map((l) => l.tax), [40, 0, 0.5]);
  assert.equal(t.tax, 40.5);
  assert.equal(t.total, 300.55);
});

test('percent discount is applied before tax', () => {
  const t = calculateTotals({
    items: [{ quantity: 1, unitPrice: 200, taxRate: 10 }],
    discount: { type: 'percent', value: 10 }
  });
  assert.equal(t.discount, 20);
  assert.equal(t.tax, 18);
  assert.equal(t.total, 198);
});

test('fixed discount is spread across lines in proportion and adds up exactly', () => {
  const t = calculateTotals({
    items: [
      { quantity: 1, unitPrice: 100, taxRate: 20 },
      { quantity: 1, unitPrice: 100, taxRate: 0 },
      { quantity: 1, unitPrice: 100, taxRate: 0 }
    ],
    discount: { type: 'fixed', value: 10 }
  });
  assert.equal(t.discount, 10);
  assert.deepEqual(t.lines.map((l) => l.discount), [3.33, 3.33, 3.34]);
  assert.equal(t.tax, 19.33);
  assert.equal(t.total, 309.33);
});

test('discount is capped at the subtotal and percent at 100', () => {
  const fixed = calculateTotals({ items: [{ quantity: 1, unitPrice: 40 }], discount: { type: 'fixed', value: 99 } });
  assert.equal(fixed.discount, 40);
  assert.equal(fixed.total, 0);
  const pct = calculateTotals({ items: [{ quantity: 1, unitPrice: 40 }], discount: { type: 'percent', value: 150 } });
  assert.equal(pct.discount, 40);
});

test('shipping is added after tax and is not taxed', () => {
  const t = calculateTotals({
    items: [{ quantity: 1, unitPrice: 100, taxRate: 20 }],
    shipping: 15.5
  });
  assert.equal(t.tax, 20);
  assert.equal(t.shipping, 15.5);
  assert.equal(t.total, 135.5);
});

test('empty and invalid rows count as zero', () => {
  const t = calculateTotals({
    items: [
      {},
      { quantity: 'abc', unitPrice: 10 },
      { quantity: -2, unitPrice: 10, taxRate: 20 },
      { quantity: 1, unitPrice: '', taxRate: 'x' },
      null,
      { quantity: 2, unitPrice: 5, taxRate: -10 }
    ],
    discount: { type: 'percent', value: 'nope' },
    shipping: -5
  });
  assert.equal(t.subtotal, 10);
  assert.equal(t.discount, 0);
  assert.equal(t.tax, 0);
  assert.equal(t.shipping, 0);
  assert.equal(t.total, 10);
});

test('missing invoice or items yields all zeros', () => {
  for (const input of [undefined, {}, { items: 'nope' }]) {
    const t = calculateTotals(input);
    assert.deepEqual([t.subtotal, t.discount, t.tax, t.shipping, t.total], [0, 0, 0, 0, 0]);
  }
});
