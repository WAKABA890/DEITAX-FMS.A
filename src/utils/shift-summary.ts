import type { ShiftSession, StockAdjustment, Transaction } from '../types';
import { isTransactionCollectionInShiftWindow, summarizeSales } from './sales-summary';

export function inferSaleCategory(transaction: Partial<Transaction> | any): 'FUEL' | 'SHOP' | 'OTHER' {
  const explicit = String(transaction?.saleCategory ?? transaction?.transactionType ?? transaction?.type ?? '').trim().toUpperCase();
  if (explicit === 'FUEL') return 'FUEL';
  if (explicit === 'SHOP') return 'SHOP';
  if (transaction?.pumpId || transaction?.productId) return 'FUEL';
  if (Array.isArray(transaction?.items)) {
    const hasFuel = transaction.items.some((item: any) => String(item?.type || '').toLowerCase() === 'fuel');
    const hasShop = transaction.items.some((item: any) => String(item?.type || '').toLowerCase() === 'shop');
    if (hasFuel && !hasShop) return 'FUEL';
    if (hasShop && !hasFuel) return 'SHOP';
  }
  return 'OTHER';
}

export function rebuildShiftSummaries(
  shifts: ShiftSession[],
  transactions: Transaction[]
): ShiftSession[] {
  return shifts.map((shift) => {
    const shiftTransactions = (transactions || []).filter((transaction) => isTransactionCollectionInShiftWindow(transaction, shift));

    const sales = summarizeSales(shiftTransactions);

    const expectedCash = Number(shift.openingCash || 0) + sales.totalSales;

    return {
      ...shift,
      totalFuelSales: sales.fuelRevenue,
      totalShopSales: sales.shopRevenue,
      totalExpectedCash: expectedCash,
    };
  });
}

export function normalizeStockAdjustmentsFromDatabase(rawAdjustments: any[] | null | undefined): StockAdjustment[] {
  if (!Array.isArray(rawAdjustments)) {
    return [];
  }

  return rawAdjustments.map((entry) => {
    const previousQty = Number(entry?.previousQuantity ?? entry?.previousQty ?? 0);
    const adjustedQty = Number(entry?.newQuantity ?? entry?.adjustedQty ?? entry?.newQty ?? previousQty);
    const delta = Number(entry?.adjustmentQuantity ?? entry?.differenceQty ?? (adjustedQty - previousQty));
    const movementType = delta > 0 ? 'Stock Increase' : delta < 0 ? 'Stock Decrease' : 'No Change';
    const type = String(entry?.type || 'Shop').trim() === 'Fuel' ? 'Fuel' : 'Shop';

    return {
      id: String(entry?.id || `adj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      timestamp: String(entry?.timestamp || entry?.createdAt || entry?.created_at || entry?.date || new Date().toISOString()),
      type,
      itemId: String(entry?.referenceId ?? entry?.itemId ?? ''),
      itemName: String(entry?.referenceName ?? entry?.itemName ?? 'Inventory Item'),
      itemCode: entry?.productCode ?? entry?.itemCode ?? undefined,
      previousQty,
      adjustedQty,
      differenceQty: delta,
      reason: String(entry?.reason || 'Stock Take Audit'),
      movementType,
      source: String(entry?.source || 'Manual Adjustment'),
      referenceNumber: entry?.referenceNumber ?? undefined,
      originalDocumentNumber: entry?.originalDocumentNumber ?? undefined,
      performedBy: String(entry?.performedBy || entry?.recordedByName || 'System'),
      notes: entry?.notes ?? undefined,
      recordedBy: String(entry?.recordedBy || entry?.recordedByName || 'System'),
    } satisfies StockAdjustment;
  });
}
