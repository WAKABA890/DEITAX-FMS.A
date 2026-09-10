import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeStockAdjustmentsFromDatabase, rebuildShiftSummaries } from '../src/utils/shift-summary.ts';

const shifts = [
  {
    id: 'shift-1',
    staffId: 'user-1',
    staffName: 'Alice',
    staffRole: 'Fuel Attendant',
    shiftType: 'Morning',
    startTime: '2025-01-02T06:00:00.000Z',
    endTime: null,
    status: 'Active',
    openingCash: 1500,
    totalFuelSales: 0,
    totalShopSales: 0,
    totalExpectedCash: 1500,
  },
] as any;

const transactions = [
  {
    id: 'tx-1',
    shiftId: 'shift-1',
    staffId: 'user-1',
    staffName: 'Alice',
    status: 'Completed',
    timestamp: '2025-01-02T06:30:00.000Z',
    type: 'Fuel',
    saleCategory: 'FUEL',
    totalAmount: 1200,
  },
  {
    id: 'tx-2',
    shiftId: 'shift-1',
    staffId: 'user-1',
    staffName: 'Alice',
    status: 'Completed',
    timestamp: '2025-01-02T07:00:00.000Z',
    type: 'Shop',
    saleCategory: 'SHOP',
    totalAmount: 300,
  },
  {
    id: 'tx-3',
    shiftId: 'shift-2',
    staffId: 'user-2',
    staffName: 'Bob',
    status: 'Completed',
    timestamp: '2025-01-02T07:30:00.000Z',
    type: 'Fuel',
    saleCategory: 'FUEL',
    totalAmount: 999,
  },
] as any;

test('rebuildShiftSummaries derives totals from persisted transactions', () => {
  const hydrated = rebuildShiftSummaries(shifts, transactions);

  assert.equal(hydrated[0].totalFuelSales, 1200);
  assert.equal(hydrated[0].totalShopSales, 300);
  assert.equal(hydrated[0].totalExpectedCash, 3000);
});

test('normalizeStockAdjustmentsFromDatabase restores persisted stock history on startup', () => {
  const hydrated = normalizeStockAdjustmentsFromDatabase([
    {
      id: 'adj-1',
      type: 'Shop',
      referenceId: 'item-1',
      referenceName: 'Motor Oil',
      previousQuantity: 20,
      adjustmentQuantity: -3,
      newQuantity: 17,
      reason: 'Stock Take Audit',
      movementType: 'Stock Decrease',
      source: 'Sales Transaction',
      referenceNumber: 'Rcpt-2025-0001',
      originalDocumentNumber: 'Rcpt-2025-0001',
      performedBy: 'Cashier',
      recordedBy: 'user-1',
      recordedByName: 'Cashier',
      notes: 'Reduced from sale',
    },
  ]);

  assert.equal(hydrated.length, 1);
  assert.equal(hydrated[0].type, 'Shop');
  assert.equal(hydrated[0].itemName, 'Motor Oil');
  assert.equal(hydrated[0].previousQty, 20);
  assert.equal(hydrated[0].differenceQty, -3);
  assert.equal(hydrated[0].source, 'Sales Transaction');
});
