/*
 * Invoice totals.
 *
 * Rules:
 *  1. Each line amount = quantity x unit price, rounded to 2 decimals.
 *  2. Subtotal = sum of rounded line amounts.
 *  3. The invoice discount (percent or fixed) is applied BEFORE tax. It is
 *     spread across lines in proportion to their amount so each line's tax is
 *     charged on what the customer actually pays for that line. The last
 *     taxable line absorbs any rounding remainder so the pieces always add up
 *     to the discount exactly.
 *  4. Line tax = discounted line amount x tax %, rounded to 2 decimals.
 *  5. Shipping is added after tax and is not taxed.
 *  6. Total = subtotal - discount + tax + shipping.
 *
 * Rows with a blank description and no amount, or non-numeric/negative values,
 * are treated as zero rather than throwing, because the editor recalculates on
 * every keystroke while the user is still typing.
 */
(function (root) {
  'use strict';

  function round2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const sign = n < 0 ? -1 : 1;
    // EPSILON nudge fixes cases like 1.005 that are stored as 1.00499999...
    return (sign * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
  }

  function toNumber(value) {
    if (typeof value === 'string') value = value.replace(/,/g, '').trim();
    if (value === '' || value === null || value === undefined) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function nonNegative(value) {
    return Math.max(0, toNumber(value));
  }

  function lineAmount(item) {
    return round2(nonNegative(item && item.quantity) * nonNegative(item && item.unitPrice));
  }

  function discountAmount(subtotal, discount) {
    if (!discount) return 0;
    const value = nonNegative(discount.value);
    const raw = discount.type === 'percent' ? subtotal * (Math.min(value, 100) / 100) : value;
    return round2(Math.min(raw, subtotal));
  }

  function calculateTotals(invoice) {
    const items = Array.isArray(invoice && invoice.items) ? invoice.items : [];
    const lines = items.map(function (item) {
      return {
        amount: lineAmount(item),
        taxRate: Math.min(nonNegative(item && item.taxRate), 100),
        discount: 0,
        tax: 0
      };
    });

    const subtotal = round2(lines.reduce(function (sum, l) { return sum + l.amount; }, 0));
    const discount = discountAmount(subtotal, invoice && invoice.discount);

    if (discount > 0 && subtotal > 0) {
      let allocated = 0;
      let lastIndex = -1;
      lines.forEach(function (line, i) { if (line.amount > 0) lastIndex = i; });
      lines.forEach(function (line, i) {
        if (line.amount <= 0) return;
        line.discount = i === lastIndex
          ? round2(discount - allocated)
          : round2(discount * (line.amount / subtotal));
        allocated = round2(allocated + line.discount);
      });
    }

    lines.forEach(function (line) {
      line.tax = round2((line.amount - line.discount) * (line.taxRate / 100));
    });

    const tax = round2(lines.reduce(function (sum, l) { return sum + l.tax; }, 0));
    const shipping = round2(nonNegative(invoice && invoice.shipping));
    const total = round2(subtotal - discount + tax + shipping);

    return { lines: lines, subtotal: subtotal, discount: discount, tax: tax, shipping: shipping, total: total };
  }

  const api = { round2: round2, toNumber: toNumber, lineAmount: lineAmount, calculateTotals: calculateTotals };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvoiceMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
