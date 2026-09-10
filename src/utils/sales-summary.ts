import type { ShiftSession, Transaction } from '../types';

export const BUSINESS_TIME_ZONE = 'Africa/Nairobi';

export type SalesCategory = 'FUEL' | 'SHOP' | 'OTHER';

export interface SalesSummary {
  totalSales: number;
  fuelRevenue: number;
  shopRevenue: number;
  otherRevenue: number;
  fuelVolumeLiters: number;
  transactionCount: number;
}

export interface ActiveShiftSalesSummary {
  shiftId: string;
  staffId: string;
  staffName: string;
  staffRole: string;
  shiftType: string;
  startTime: string;
  totalFuelSales: number;
  totalShopSales: number;
  recordedSales: number;
  transactionCount: number;
  dispensedLiters: number;
  dispensedAmount: number;
}

export interface DashboardSalesSummary {
  today: SalesSummary;
  activeShifts: ActiveShiftSalesSummary[];
  activeStaff: {
    count: number;
    staffIds: string[];
  };
}

const toMinorUnits = (value: unknown) => Math.round((Number(value) || 0) * 100);
const fromMinorUnits = (value: number) => value / 100;

const getBusinessDateKey = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const isCompletedSale = (transaction: Partial<Transaction>) => transaction.status === 'Completed';

const inferTransactionCategory = (transaction: Partial<Transaction>): SalesCategory => {
  const explicit = String(transaction.saleCategory ?? transaction.type ?? '').trim().toUpperCase();
  if (explicit === 'FUEL') return 'FUEL';
  if (explicit === 'SHOP') return 'SHOP';
  if ((transaction as any).pumpId || (transaction as any).productId) return 'FUEL';
  return 'OTHER';
};

const classifyItem = (item: any): SalesCategory => {
  const type = String(item?.type ?? '').trim().toUpperCase();
  if (type === 'FUEL') return 'FUEL';
  if (type === 'SHOP') return 'SHOP';
  return 'OTHER';
};

const getTransactionBreakdown = (transaction: Partial<Transaction>) => {
  const totalCents = toMinorUnits(transaction.totalAmount);
  const totals = { FUEL: 0, SHOP: 0, OTHER: 0 } as Record<SalesCategory, number>;
  const items = Array.isArray(transaction.items) ? transaction.items : [];

  if (items.length === 0) {
    totals[inferTransactionCategory(transaction)] = totalCents;
    return totals;
  }

  let itemTotalCents = 0;
  const itemCategories = new Set<SalesCategory>();
  for (const item of items) {
    const itemAmount = item.totalAmount ?? item.totalPrice ?? (Number(item.qty || 0) * Number(item.unitPrice || 0));
    const amountCents = toMinorUnits(itemAmount);
    const category = classifyItem(item);
    totals[category] += amountCents;
    itemTotalCents += amountCents;
    itemCategories.add(category);
  }

  const residualCents = totalCents - itemTotalCents;
  if (residualCents !== 0) {
    const fallbackCategory = itemCategories.size === 1
      ? [...itemCategories][0]
      : inferTransactionCategory(transaction);
    totals[fallbackCategory] += residualCents;
  }

  return totals;
};

export const summarizeSales = (transactions: Transaction[]): SalesSummary => {
  const totals = { FUEL: 0, SHOP: 0, OTHER: 0 } as Record<SalesCategory, number>;
  let transactionCount = 0;
  let fuelVolumeLiters = 0;

  for (const transaction of transactions || []) {
    if (!isCompletedSale(transaction)) continue;
    const transactionTotals = getTransactionBreakdown(transaction);
    totals.FUEL += transactionTotals.FUEL;
    totals.SHOP += transactionTotals.SHOP;
    totals.OTHER += transactionTotals.OTHER;
    fuelVolumeLiters += (transaction.items || [])
      .filter((item) => classifyItem(item) === 'FUEL')
      .reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    transactionCount += 1;
  }

  const summary = {
    totalSales: fromMinorUnits(totals.FUEL + totals.SHOP + totals.OTHER),
    fuelRevenue: fromMinorUnits(totals.FUEL),
    shopRevenue: fromMinorUnits(totals.SHOP),
    otherRevenue: fromMinorUnits(totals.OTHER),
    fuelVolumeLiters,
    transactionCount,
  };

  assertSalesSummaryInvariant(summary, 'sales summary');
  return summary;
};

export const isTransactionInShiftWindow = (transaction: Transaction, shift: ShiftSession) => {
  if (transaction.shiftId !== shift.id) return false;

  const transactionTime = Date.parse(transaction.timestamp);
  const shiftStartTime = Date.parse(shift.startTime);
  const shiftEndTime = shift.endTime ? Date.parse(shift.endTime) : Number.POSITIVE_INFINITY;

  return Number.isFinite(transactionTime)
    && Number.isFinite(shiftStartTime)
    && transactionTime >= shiftStartTime
    && transactionTime <= shiftEndTime;
};

export const isTransactionCollectionInShiftWindow = (transaction: Transaction, shift: ShiftSession) => {
  if(!transaction.settlementShiftId)return isTransactionInShiftWindow(transaction,shift);
  const time=Date.parse(transaction.settledAt||'');
  return transaction.settlementShiftId===shift.id&&Number.isFinite(time)&&time>=Date.parse(shift.startTime)&&(!shift.endTime||time<=Date.parse(shift.endTime));
};

export const buildDashboardSalesSummary = (
  transactions: Transaction[],
  shifts: ShiftSession[],
  now = new Date()
): DashboardSalesSummary => {
  const todayKey = getBusinessDateKey(now);
  const todaysTransactions = (transactions || []).filter((transaction) => {
    if (!isCompletedSale(transaction)) return false;
    const timestamp = new Date(transaction.settledAt || transaction.timestamp);
    return !Number.isNaN(timestamp.getTime()) && getBusinessDateKey(timestamp) === todayKey;
  });

  const latestActiveShiftByStaff = new Map<string, ShiftSession>();
  for (const shift of shifts || []) {
    if (shift.status !== 'Active' || !shift.staffId) continue;
    const existing = latestActiveShiftByStaff.get(shift.staffId);
    if (!existing || Date.parse(shift.startTime) > Date.parse(existing.startTime)) {
      latestActiveShiftByStaff.set(shift.staffId, shift);
    }
  }

  const activeShifts = [...latestActiveShiftByStaff.values()].map((shift) => {
    const shiftTransactions=(transactions || []).filter((transaction) => isTransactionInShiftWindow(transaction, shift));
    const shiftSummary = summarizeSales((transactions||[]).filter(transaction=>isTransactionCollectionInShiftWindow(transaction,shift)));
    const dispensing=shiftTransactions.filter(transaction=>inferTransactionCategory(transaction)==='FUEL'&&transaction.status!=='Voided').reduce((sum,transaction)=>{const items=Array.isArray(transaction.items)?transaction.items:[];const litres=items.filter(item=>classifyItem(item)==='FUEL').reduce((value,item)=>value+(Number(item.qty??(item as any).quantity)||0),0)||(Number((transaction as any).quantity)||0);return{litres:sum.litres+litres,amount:sum.amount+(Number(transaction.totalAmount)||0)};},{litres:0,amount:0});
    const recordedSales = shiftSummary.fuelRevenue + shiftSummary.shopRevenue;
    const activeShift = {
      shiftId: shift.id,
      staffId: shift.staffId,
      staffName: shift.staffName,
      staffRole: shift.staffRole,
      shiftType: shift.shiftType,
      startTime: shift.startTime,
      totalFuelSales: shiftSummary.fuelRevenue,
      totalShopSales: shiftSummary.shopRevenue,
      recordedSales,
      transactionCount: shiftSummary.transactionCount,
      dispensedLiters: dispensing.litres,
      dispensedAmount: dispensing.amount,
    };

    assertActiveShiftInvariant(activeShift);
    return activeShift;
  });

  const dashboardSummary = {
    today: summarizeSales(todaysTransactions),
    activeShifts,
    activeStaff: {
      count: activeShifts.length,
      staffIds: activeShifts.map((shift) => shift.staffId),
    },
  };

  assertDashboardSummaryInvariant(dashboardSummary);
  return dashboardSummary;
};

export const assertSalesSummaryInvariant = (summary: SalesSummary, context: string) => {
  const categorizedTotal = summary.fuelRevenue + summary.shopRevenue + summary.otherRevenue;
  if (Math.abs(summary.totalSales - categorizedTotal) >= 0.01) {
    throw new Error(`Dashboard sales invariant failed for ${context}: total ${summary.totalSales} does not equal categorized total ${categorizedTotal}.`);
  }
};

export const assertActiveShiftInvariant = (shift: ActiveShiftSalesSummary) => {
  const calculatedRecordedSales = shift.totalFuelSales + shift.totalShopSales;
  if (Math.abs(shift.recordedSales - calculatedRecordedSales) >= 0.01) {
    throw new Error(`Shift sales invariant failed for ${shift.shiftId}: recorded sales do not equal fuel plus shop sales.`);
  }
};

export const assertDashboardSummaryInvariant = (summary: DashboardSalesSummary) => {
  assertSalesSummaryInvariant(summary.today, 'today');
  for (const shift of summary.activeShifts) assertActiveShiftInvariant(shift);

  const uniqueStaff = new Set(summary.activeShifts.map((shift) => shift.staffId));
  if (summary.activeStaff.count !== uniqueStaff.size) {
    throw new Error('Active staff invariant failed: count does not equal the unique active roster size.');
  }
};
