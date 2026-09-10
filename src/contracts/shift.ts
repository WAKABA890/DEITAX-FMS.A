import type { ShiftSummaryDTO, TransactionDTO } from './transaction';

export function buildShiftSummary(
  shiftId: string,
  openingCash: number,
  transactions: TransactionDTO[]
): ShiftSummaryDTO {
  const completedTransactions = (transactions || []).filter(
    (transaction) => transaction.shiftId === shiftId && transaction.status === 'Completed'
  );

  const totalSales = completedTransactions.reduce((sum, transaction) => sum + Number(transaction.totalAmount || 0), 0);
  const fuelSales = completedTransactions
    .filter((transaction) => transaction.saleCategory === 'FUEL')
    .reduce((sum, transaction) => sum + Number(transaction.totalAmount || 0), 0);
  const shopSales = completedTransactions
    .filter((transaction) => transaction.saleCategory === 'SHOP')
    .reduce((sum, transaction) => sum + Number(transaction.totalAmount || 0), 0);
  const cashSales = completedTransactions
    .filter((transaction) => String(transaction.paymentMethod || '').toLowerCase() === 'cash')
    .reduce((sum, transaction) => sum + Number(transaction.totalAmount || 0), 0);
  const nonCashSales = Math.max(0, totalSales - cashSales);

  const expectedCash = Number(openingCash || 0) + cashSales + nonCashSales;

  return {
    shiftId,
    openingCash: Number(openingCash || 0),
    transactionCount: completedTransactions.length,
    totalSales,
    totalFuelSales: fuelSales,
    totalShopSales: shopSales,
    cashSales,
    nonCashSales,
    expectedCash,
    creditNotesTotal: 0,
  };
}

export function buildShiftSummariesFromTransactions(
  shifts: Array<{ id: string; openingCash?: number; status?: string; totalFuelSales?: number; totalShopSales?: number; totalExpectedCash?: number }>,
  transactions: TransactionDTO[]
) {
  return shifts.map((shift) => ({
    ...shift,
    ...buildShiftSummary(shift.id, Number(shift.openingCash || 0), transactions),
  }));
}
