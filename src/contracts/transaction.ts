export type SaleCategory = 'FUEL' | 'SHOP' | 'OTHER';

export interface TransactionItemDTO {
  itemId: string;
  pumpId?: string;
  name: string;
  type: 'Fuel' | 'Shop';
  qty: number;
  unitPrice: number;
  totalPrice: number;
  taxAmount: number;
  taxCode: string;
}

export interface TransactionDTO {
  id: string;
  shiftId: string | null;
  transactionType: string;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  paymentMethod: string | null;
  receiptNo: string | null;
  taxInvoiceNo: string | null;
  documentType: string;
  status: string;
  customerId?: string | null;
  pumpId?: string | null;
  productId?: string | null;
  createdAt: string;
  saleCategory: SaleCategory;
  items?: TransactionItemDTO[];
}

export interface ShiftSummaryDTO {
  shiftId: string;
  openingCash: number;
  transactionCount: number;
  totalSales: number;
  totalFuelSales: number;
  totalShopSales: number;
  cashSales: number;
  nonCashSales: number;
  expectedCash: number;
  creditNotesTotal: number;
}

export function resolveSaleCategory(raw: any): SaleCategory {
  const explicit = String(raw?.saleCategory ?? raw?.transactionType ?? raw?.type ?? raw?.category ?? '').trim().toUpperCase();

  if (explicit === 'FUEL' || explicit.includes('FUEL')) return 'FUEL';
  if (explicit === 'SHOP' || explicit.includes('SHOP')) return 'SHOP';
  if (raw?.pumpId || raw?.productId) return 'FUEL';
  if (Array.isArray(raw?.items)) {
    const hasFuel = raw.items.some((item: any) => String(item?.type || '').toLowerCase() === 'fuel');
    const hasShop = raw.items.some((item: any) => String(item?.type || '').toLowerCase() === 'shop');
    if (hasFuel && !hasShop) return 'FUEL';
    if (hasShop && !hasFuel) return 'SHOP';
  }

  return 'OTHER';
}

export function normalizeTransactionForDto(raw: any): TransactionDTO {
  const receiptNo = String(raw?.receiptNo ?? raw?.receipt_number ?? '').trim() || null;
  const taxInvoiceNo = String(raw?.taxInvoiceNo ?? raw?.invoice_number ?? '').trim() || null;
  const paymentMethod = String(raw?.paymentMethod ?? raw?.payment_method ?? '').trim() || null;
  const shiftId = raw?.shiftId ?? raw?.shift_id ?? null;
  const saleCategory = resolveSaleCategory(raw);
  const totalAmount = Number(raw?.totalAmount ?? raw?.total_amount ?? 0);
  const subtotal = Number(raw?.subtotal ?? raw?.subtotal ?? 0);
  const taxAmount = Number(raw?.taxAmount ?? raw?.tax ?? 0);

  return {
    id: String(raw?.id || 'tx-unknown'),
    shiftId,
    transactionType: String(raw?.type ?? raw?.transactionType ?? 'OTHER').trim() || 'OTHER',
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    taxAmount: Number.isFinite(taxAmount) ? taxAmount : 0,
    paymentMethod,
    receiptNo,
    taxInvoiceNo,
    documentType: String(raw?.documentType ?? raw?.document_type ?? 'Receipt').trim() || 'Receipt',
    status: String(raw?.status ?? 'Completed').trim() || 'Completed',
    customerId: raw?.customerId ?? raw?.customer_id ?? null,
    pumpId: raw?.pumpId ?? raw?.pump_id ?? null,
    productId: raw?.productId ?? raw?.product_id ?? null,
    createdAt: String(raw?.createdAt ?? raw?.timestamp ?? raw?.date ?? new Date().toISOString()),
    saleCategory,
    items: Array.isArray(raw?.items) ? raw.items.map((item: any) => ({
      itemId: String(item?.itemId ?? item?.id ?? ''),
      pumpId: item?.pumpId ?? undefined,
      name: String(item?.name ?? 'Item'),
      type: String(item?.type ?? 'Shop').toLowerCase() === 'fuel' ? 'Fuel' : 'Shop',
      qty: Number(item?.qty ?? 0),
      unitPrice: Number(item?.unitPrice ?? 0),
      totalPrice: Number(item?.totalPrice ?? 0),
      taxAmount: Number(item?.taxAmount ?? 0),
      taxCode: String(item?.taxCode ?? 'A'),
    })) : [],
  };
}
