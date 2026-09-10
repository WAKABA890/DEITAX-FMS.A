import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { TAX_RATE_MAP, type TaxCode } from '../src/constants/tax.ts';
import { computeDocumentTotals, extractTaxFromGross } from '../src/utils/documentTotals.ts';

test('E tax rate is positive 8% and never negative', () => {
  assert.equal(TAX_RATE_MAP.E, 0.08);
  assert.ok(extractTaxFromGross(5000, 'E') > 0);
  assert.ok(extractTaxFromGross(1000, 'E') >= 0);
});

test('tax extraction matches the gross-to-net VAT formula', () => {
  const tax = extractTaxFromGross(5000, 'E');
  assert.ok(Math.abs(tax - 370.3703703703704) < 0.0001);
  assert.ok(Math.abs((5000 - tax) + tax - 5000) < 0.01);
});

test('document totals aggregate net, tax and gross consistently', () => {
  const totals = computeDocumentTotals([
    { quantity: 25, unitPrice: 200, taxCode: 'E' },
    { quantity: 3, unitPrice: 150, taxCode: 'A' },
    { quantity: 3, unitPrice: 150, taxCode: 'A' },
  ]);

  assert.ok(Math.abs(totals.totalAmount - 5900) < 0.01);
  assert.ok(Math.abs(totals.taxAmount - 370.37) < 0.01);
  assert.ok(Math.abs(totals.subtotal - 5529.63) < 0.01);
  assert.ok(Math.abs(totals.subtotal - (totals.totalAmount - totals.taxAmount)) < 0.01);
  assert.ok(Math.abs(totals.subtotal + totals.taxAmount - totals.totalAmount) < 0.01);
  assert.equal(totals.taxSummary.E.gross, 5000);
  assert.ok(Math.abs(totals.taxSummary.E.tax - 370.37) < 0.01);
  assert.ok(Math.abs(totals.taxSummary.E.net - 4629.63) < 0.01);
});

test('zero-rated codes produce zero tax', () => {
  for (const code of ['A', 'C', 'D'] as TaxCode[]) {
    const tax = extractTaxFromGross(1000, code);
    assert.equal(tax, 0);
  }
});

test('B tax yields the expected 16% split', () => {
  const tax = extractTaxFromGross(1160, 'B');
  assert.ok(Math.abs(tax - 160) < 0.01);
  assert.ok(Math.abs(1160 - tax - 1000) < 0.01);
});
