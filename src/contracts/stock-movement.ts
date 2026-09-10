export type StockMovementType =
  | 'SALE'
  | 'CREDIT_NOTE_RETURN'
  | 'MANUAL_ADJUSTMENT'
  | 'RESTOCK'
  | 'FUEL_DELIVERY'
  | 'PUMP_ADJUSTMENT'
  | 'TANK_ADJUSTMENT';

export interface StockMovementDTO {
  id: string;
  movementType: StockMovementType;
  stockType: 'FUEL' | 'SHOP';
  referenceId: string | null;
  referenceNumber: string | null;
  referenceName: string | null;
  previousQty: number | null;
  quantityChange: number;
  newQty: number | null;
  transactionId?: string | null;
  creditNoteId?: string | null;
  deliveryId?: string | null;
  createdAt: string;
}

export function normalizeMovementType(value: string | null | undefined): StockMovementType {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'MANUAL_ADJUSTMENT';
  if (raw.includes('CREDIT')) return 'CREDIT_NOTE_RETURN';
  if (raw.includes('FUEL') && raw.includes('DELIVERY')) return 'FUEL_DELIVERY';
  if (raw.includes('PUMP')) return 'PUMP_ADJUSTMENT';
  if (raw.includes('TANK')) return 'TANK_ADJUSTMENT';
  if (raw.includes('RESTOCK')) return 'RESTOCK';
  if (raw.includes('SALE')) return 'SALE';
  return 'MANUAL_ADJUSTMENT';
}

export function mapStockMovementToDto(raw: any): StockMovementDTO {
  const movementType = normalizeMovementType(raw?.movementType ?? raw?.movement_type ?? raw?.source ?? raw?.type);
  const referenceId = raw?.referenceId ?? raw?.reference_id ?? null;
  const previousQty = raw?.previousQty ?? raw?.previous_quantity ?? null;
  const newQty = raw?.newQty ?? raw?.new_quantity ?? raw?.adjustedQty ?? raw?.adjustmentQuantity ?? null;
  const quantityChange = Number(raw?.quantityChange ?? raw?.adjustmentQuantity ?? raw?.differenceQty ?? (newQty !== null && previousQty !== null ? Number(newQty) - Number(previousQty) : 0));

  return {
    id: String(raw?.id || 'adj-unknown'),
    movementType,
    stockType: String(raw?.type ?? 'Shop').toLowerCase() === 'fuel' ? 'FUEL' : 'SHOP',
    referenceId: referenceId ? String(referenceId) : null,
    referenceNumber: raw?.referenceNumber ?? raw?.reference_number ?? raw?.originalDocumentNumber ?? null,
    referenceName: raw?.referenceName ?? raw?.reference_name ?? raw?.itemName ?? null,
    previousQty: previousQty === null || previousQty === undefined ? null : Number(previousQty),
    quantityChange: Number(quantityChange || 0),
    newQty: newQty === null || newQty === undefined ? null : Number(newQty),
    transactionId: raw?.transactionId ?? raw?.transaction_id ?? null,
    creditNoteId: raw?.creditNoteId ?? raw?.credit_note_id ?? null,
    deliveryId: raw?.deliveryId ?? raw?.delivery_id ?? null,
    createdAt: String(raw?.createdAt ?? raw?.timestamp ?? new Date().toISOString()),
  };
}
