import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildDashboardSalesSummary, summarizeSales } from '../src/utils/sales-summary.ts';

const now = new Date('2026-08-20T09:00:00.000Z');

const transaction = (overrides: Record<string, unknown>) => ({
  id: 'tx-default',
  timestamp: '2026-08-20T06:00:00.000Z',
  shiftId: 'shift-1',
  staffId: 'staff-1',
  staffName: 'Alex',
  receiptNo: 'Rcpt-2026-0001',
  type: 'Fuel',
  items: [],
  subtotal: 0,
  taxAmount: 0,
  totalAmount: 0,
  paymentMethod: 'Cash',
  status: 'Completed',
  ...overrides,
}) as any;

const shift = (overrides: Record<string, unknown>) => ({
  id: 'shift-1',
  staffId: 'staff-1',
  staffName: 'Alex',
  staffRole: 'Fuel Attendant',
  shiftType: 'Morning',
  startTime: '2026-08-20T05:00:00.000Z',
  status: 'Active',
  openingCash: 0,
  totalFuelSales: 0,
  totalShopSales: 0,
  totalExpectedCash: 0,
  ...overrides,
}) as any;

test('sales categories reconcile in minor units without the historical KES 20 drift', () => {
  const summary = summarizeSales([
    transaction({ id: 'fuel', type: 'Fuel', totalAmount: 933285 }),
    transaction({ id: 'shop', type: 'Shop', totalAmount: 150 }),
  ]);

  assert.equal(summary.fuelRevenue, 933285);
  assert.equal(summary.shopRevenue, 150);
  assert.equal(summary.otherRevenue, 0);
  assert.equal(summary.totalSales, 933435);
});

test('mixed baskets are split by line item and reconcile to their transaction total', () => {
  const summary = summarizeSales([
    transaction({
      id: 'mixed',
      type: 'Combined',
      totalAmount: 150,
      items: [
        { type: 'Fuel', qty: 2, unitPrice: 50, totalPrice: 100 },
        { type: 'Shop', qty: 1, unitPrice: 50, totalPrice: 50 },
      ],
    }),
  ]);

  assert.equal(summary.fuelRevenue, 100);
  assert.equal(summary.shopRevenue, 50);
  assert.equal(summary.totalSales, 150);
});

test('issued credit notes reduce real-time sales by their fuel and shop values', () => {
  const dashboard = buildDashboardSalesSummary(
    [
      transaction({ id: 'fuel-sale', type: 'Fuel', totalAmount: 100, items: [{ type: 'Fuel', qty: 1, unitPrice: 100, totalPrice: 100 }] }),
      transaction({ id: 'shop-sale', type: 'Shop', totalAmount: 200, items: [{ type: 'Shop', qty: 2, unitPrice: 100, totalPrice: 200 }] }),
    ],
    [],
    now,
    [
      { id: 'fuel-credit', creditNoteNo: 'Cn-1', timestamp: '2026-08-20T07:30:00.000Z', customerName: 'Walk-in', originalInvoiceNo: '', items: [{ itemId: 'fuel', name: 'Fuel', type: 'Fuel', qty: 1, quantity: 1, unitPrice: 40, totalPrice: 40, taxAmount: 0 }], subtotal: 40, taxAmount: 0, totalAmount: 40, reason: 'RTT', issuedBy: 'Manager', status: 'Issued' },
      { id: 'shop-credit', creditNoteNo: 'Cn-2', timestamp: '2026-08-20T07:45:00.000Z', customerName: 'Walk-in', originalInvoiceNo: '', items: [{ itemId: 'shop', name: 'Shop', type: 'Shop', qty: 1, quantity: 1, unitPrice: 50, totalPrice: 50, taxAmount: 0 }], subtotal: 50, taxAmount: 0, totalAmount: 50, reason: 'Return', issuedBy: 'Manager', status: 'Issued' },
      { id: 'voided-credit', creditNoteNo: 'Cn-3', timestamp: '2026-08-20T08:00:00.000Z', customerName: 'Walk-in', originalInvoiceNo: '', items: [{ itemId: 'shop', name: 'Shop', type: 'Shop', qty: 1, quantity: 1, unitPrice: 30, totalPrice: 30, taxAmount: 0 }], subtotal: 30, taxAmount: 0, totalAmount: 30, reason: 'Return', issuedBy: 'Manager', status: 'Voided' },
    ] as any
  );

  assert.equal(dashboard.today.transactionCount, 2);
  assert.equal(dashboard.today.fuelRevenue, 60);
  assert.equal(dashboard.today.shopRevenue, 150);
  assert.equal(dashboard.today.totalSales, 210);
  assert.equal(dashboard.today.fuelRevenue + dashboard.today.shopRevenue + dashboard.today.otherRevenue, 210);
});
test('today includes completed closed-shift sales while the active roster is deduplicated', () => {
  const dashboard = buildDashboardSalesSummary(
    [
      transaction({ id: 'closed-sale', shiftId: 'closed-shift', type: 'Fuel', totalAmount: 100 }),
      transaction({ id: 'active-sale', shiftId: 'active-shift', type: 'Shop', totalAmount: 50 }),
      transaction({ id: 'duplicate-sale', shiftId: 'duplicate-shift', type: 'Fuel', totalAmount: 80 }),
    ],
    [
      shift({ id: 'closed-shift', status: 'Completed' }),
      shift({ id: 'active-shift', staffId: 'staff-1', startTime: '2026-08-20T06:00:00.000Z' }),
      shift({ id: 'duplicate-shift', staffId: 'staff-1', startTime: '2026-08-20T05:00:00.000Z' }),
    ],
    now
  );

  assert.equal(dashboard.today.totalSales, 230);
  assert.equal(dashboard.activeShifts.length, 1);
  assert.equal(dashboard.activeStaff.count, 1);
  assert.equal(dashboard.activeShifts[0].shiftId, 'active-shift');
  assert.equal(dashboard.activeShifts[0].recordedSales, 50);
  assert.equal(dashboard.activeShifts[0].totalFuelSales + dashboard.activeShifts[0].totalShopSales, 50);
});

test('non-completed and prior-day transactions do not affect today sales', () => {
  const dashboard = buildDashboardSalesSummary(
    [
      transaction({ id: 'today', type: 'Fuel', totalAmount: 100 }),
      transaction({ id: 'voided', type: 'Shop', totalAmount: 999, status: 'Voided' }),
      transaction({ id: 'prior-day', type: 'Shop', totalAmount: 999, timestamp: '2026-08-18T10:00:00.000Z' }),
    ],
    [],
    now
  );

  assert.equal(dashboard.today.transactionCount, 1);
  assert.equal(dashboard.today.totalSales, 100);
  assert.equal(dashboard.today.fuelRevenue + dashboard.today.shopRevenue + dashboard.today.otherRevenue, 100);
});

test('active roster excludes transactions recorded before the current shift started', () => {
  const dashboard = buildDashboardSalesSummary(
    [
      transaction({ id: 'stale', shiftId: 'active-shift', type: 'Fuel', totalAmount: 933285, timestamp: '2026-08-20T04:00:00.000Z' }),
      transaction({ id: 'ongoing-fuel', shiftId: 'active-shift', type: 'Fuel', totalAmount: 32000, timestamp: '2026-08-20T06:30:00.000Z' }),
      transaction({ id: 'ongoing-shop', shiftId: 'active-shift', type: 'Shop', totalAmount: 900, timestamp: '2026-08-20T07:00:00.000Z' }),
    ],
    [shift({ id: 'active-shift', startTime: '2026-08-20T06:00:00.000Z' })],
    now
  );

  assert.equal(dashboard.activeShifts[0].totalFuelSales, 32000);
  assert.equal(dashboard.activeShifts[0].totalShopSales, 900);
  assert.equal(dashboard.activeShifts[0].recordedSales, 32900);
  assert.equal(dashboard.activeShifts[0].transactionCount, 2);
});
