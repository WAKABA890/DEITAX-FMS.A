import type { CreditNote, ShiftSession, Transaction } from '../types';

export const BUSINESS_TIME_ZONE = 'Africa/Nairobi';

export type SalesCategory = 'FUEL' | 'SHOP' | 'OTHER';

export interface SalesSummary {
  totalSales: number;
  fuelRevenue: number;
  shopRevenue: number;
  otherRevenue: number;
  /** Net fuel volume after confirmed RTT returns. */
  fuelVolumeLiters: number;
  /** Immutable physical PTS-2/manual meter dispense before RTT returns. */
  meterFuelVolumeLiters: number;
  /** Fuel returned to tank through issued RTT credit notes. */
  rttReturnedLiters: number;
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
  /** Net fuel dispensed after RTT returns. */
  dispensedLiters: number;
  /** Raw physical meter dispense before RTT returns. */
  meterDispensedLiters: number;
  rttReturnedLiters: number;
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

const isRttCreditNote = (creditNote: Partial<CreditNote>) => {
  if (String(creditNote.status || '').toLowerCase() === 'voided') return false;
  const reason = String(creditNote.reason || '').trim().toUpperCase();
  return reason === 'RTT' || reason === 'RETURN TO TANK' || /\bRTT\b|RETURN\s+TO\s+TANK/.test(reason);
};

const getFuelLitres = (transaction: Partial<Transaction>) => (transaction.items || [])
  .filter((item) => classifyItem(item) === 'FUEL')
  .reduce((sum, item) => sum + (Number(item.qty ?? (item as any).quantity) || 0), 0);

const getRttReturnedLitres = (transactions: Transaction[], creditNotes: CreditNote[]) => {
  const returnByTransactionId = new Map<string, number>();
  for (const creditNote of creditNotes || []) {
    if (!isRttCreditNote(creditNote) || !creditNote.originalTransactionId) continue;
    const returned = (creditNote.items || [])
      .filter((item) => classifyItem(item) === 'FUEL')
      .reduce((sum, item) => sum + (Number(item.quantity ?? item.qty) || 0), 0);
    returnByTransactionId.set(
      creditNote.originalTransactionId,
      (returnByTransactionId.get(creditNote.originalTransactionId) || 0) + returned
    );
  }

  return (transactions || []).reduce((sum, transaction) => {
    const rawLitres = getFuelLitres(transaction);
    return sum + Math.min(rawLitres, returnByTransactionId.get(transaction.id) || 0);
  }, 0);
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

const isIssuedCreditNote = (creditNote: Partial<CreditNote>) => String(creditNote.status || '').toLowerCase() !== 'voided';

const getCreditNoteBreakdown = (creditNote: Partial<CreditNote>) => {
  const totalCents = toMinorUnits(creditNote.totalAmount);
  const totals = { FUEL: 0, SHOP: 0, OTHER: 0 } as Record<SalesCategory, number>;
  const items = Array.isArray(creditNote.items) ? creditNote.items : [];

  if (items.length === 0) {
    totals.OTHER = totalCents;
    return totals;
  }

  let itemTotalCents = 0;
  const itemCategories = new Set<SalesCategory>();
  for (const item of items) {
    const quantity = Number(item.quantity ?? item.qty ?? 0);
    const itemAmount = item.totalAmount ?? item.totalPrice ?? (quantity * Number(item.unitPrice || 0));
    const amountCents = toMinorUnits(itemAmount);
    const category = classifyItem(item);
    totals[category] += amountCents;
    itemTotalCents += amountCents;
    itemCategories.add(category);
  }

  const residualCents = totalCents - itemTotalCents;
  if (residualCents !== 0) {
    const fallbackCategory = itemCategories.size === 1 ? [...itemCategories][0] : 'OTHER';
    totals[fallbackCategory] += residualCents;
  }

  return totals;
};

export const summarizeSales = (transactions: Transaction[], creditNotes: CreditNote[] = []): SalesSummary => {
  const totals = { FUEL: 0, SHOP: 0, OTHER: 0 } as Record<SalesCategory, number>;
  let transactionCount = 0;
  let meterFuelVolumeLiters = 0;

  for (const transaction of transactions || []) {
    if (!isCompletedSale(transaction)) continue;
    const transactionTotals = getTransactionBreakdown(transaction);
    totals.FUEL += transactionTotals.FUEL;
    totals.SHOP += transactionTotals.SHOP;
    totals.OTHER += transactionTotals.OTHER;
    meterFuelVolumeLiters += getFuelLitres(transaction);
    transactionCount += 1;
  }

  for (const creditNote of creditNotes || []) {
    if (!isIssuedCreditNote(creditNote)) continue;
    const creditTotals = getCreditNoteBreakdown(creditNote);
    totals.FUEL -= creditTotals.FUEL;
    totals.SHOP -= creditTotals.SHOP;
    totals.OTHER -= creditTotals.OTHER;
  }

  const rttReturnedLiters = getRttReturnedLitres(
    (transactions || []).filter(isCompletedSale),
    creditNotes
  );
  const summary = {
    totalSales: fromMinorUnits(totals.FUEL + totals.SHOP + totals.OTHER),
    fuelRevenue: fromMinorUnits(totals.FUEL),
    shopRevenue: fromMinorUnits(totals.SHOP),
    otherRevenue: fromMinorUnits(totals.OTHER),
    fuelVolumeLiters: Math.max(0, meterFuelVolumeLiters - rttReturnedLiters),
    meterFuelVolumeLiters,
    rttReturnedLiters,
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
  if(transaction.status==='Completed'&&transaction.dispensedWithoutShift&&transaction.meterReconciliationShiftId===shift.id&&!transaction.settlementShiftId)return true;
  if(!transaction.settlementShiftId)return isTransactionInShiftWindow(transaction,shift);
  const time=Date.parse(transaction.settledAt||'');
  return transaction.settlementShiftId===shift.id&&Number.isFinite(time)&&time>=Date.parse(shift.startTime)&&(!shift.endTime||time<=Date.parse(shift.endTime));
};

const isCreditNoteInShiftWindow = (creditNote: CreditNote, shift: ShiftSession) => {
  if (!isIssuedCreditNote(creditNote)) return false;
  const creditTime = Date.parse(creditNote.timestamp);
  const shiftStartTime = Date.parse(shift.startTime);
  const shiftEndTime = shift.endTime ? Date.parse(shift.endTime) : Number.POSITIVE_INFINITY;
  return Number.isFinite(creditTime)
    && Number.isFinite(shiftStartTime)
    && creditTime >= shiftStartTime
    && creditTime <= shiftEndTime;
};

export const buildDashboardSalesSummary = (
  transactions: Transaction[],
  shifts: ShiftSession[],
  now = new Date(),
  creditNotes: CreditNote[] = []
): DashboardSalesSummary => {
  const todayKey = getBusinessDateKey(now);
  const todaysTransactions = (transactions || []).filter((transaction) => {
    if (!isCompletedSale(transaction)) return false;
    const timestamp = new Date(transaction.settledAt || transaction.timestamp);
    return !Number.isNaN(timestamp.getTime()) && getBusinessDateKey(timestamp) === todayKey;
  });

  const todaysCreditNotes = (creditNotes || []).filter((creditNote) => {
    if (!isIssuedCreditNote(creditNote)) return false;
    const timestamp = new Date(creditNote.timestamp);
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
    const shiftTransactions=(transactions || []).filter((transaction) => isTransactionCollectionInShiftWindow(transaction, shift));
    const shiftCreditNotes = (creditNotes || []).filter((creditNote) => isCreditNoteInShiftWindow(creditNote, shift));
    const shiftSummary = summarizeSales(shiftTransactions, shiftCreditNotes);
    const dispensing=shiftTransactions.filter(transaction=>inferTransactionCategory(transaction)==='FUEL'&&transaction.status==='Completed').reduce((sum,transaction)=>{const litres=getFuelLitres(transaction)||(Number((transaction as any).quantity)||0);return{litres:sum.litres+litres,amount:sum.amount+(Number(transaction.totalAmount)||0)};},{litres:0,amount:0});
    const rttReturnedLiters=getRttReturnedLitres(shiftTransactions.filter(transaction=>transaction.status==='Completed'),shiftCreditNotes);
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
      dispensedLiters: Math.max(0, dispensing.litres-rttReturnedLiters),
      meterDispensedLiters: dispensing.litres,
      rttReturnedLiters,
      dispensedAmount: shiftSummary.fuelRevenue,
    };

    assertActiveShiftInvariant(activeShift);
    return activeShift;
  });

  const dashboardSummary = {
    today: summarizeSales(todaysTransactions, todaysCreditNotes),
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
