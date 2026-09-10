export interface CreditNoteDTO {
  id: string;
  creditNoteNo: string;
  originalTransactionId?: string | null;
  originalDocumentType?: 'invoice' | 'receipt';
  originalDocumentNo?: string | null;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  status: string;
  createdAt: string;
}

export function mapCreditNoteToDto(raw: any): CreditNoteDTO {
  const totalAmount = Number(raw?.totalAmount ?? raw?.total_amount ?? 0);
  const subtotal = Number(raw?.subtotal ?? 0);
  const taxAmount = Number(raw?.taxAmount ?? raw?.tax_amount ?? 0);

  return {
    id: String(raw?.id || 'cn-unknown'),
    creditNoteNo: String(raw?.creditNoteNo ?? raw?.credit_note_no ?? 'Cn-unknown'),
    originalTransactionId: raw?.originalTransactionId ?? raw?.original_transaction_id ?? null,
    originalDocumentType: String(raw?.originalDocumentType ?? raw?.original_document_type ?? '').toLowerCase() === 'receipt' ? 'receipt' : 'invoice',
    originalDocumentNo: raw?.originalDocumentNo ?? raw?.original_document_no ?? null,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    taxAmount: Number.isFinite(taxAmount) ? taxAmount : 0,
    status: String(raw?.status ?? 'Issued').trim() || 'Issued',
    createdAt: String(raw?.createdAt ?? raw?.timestamp ?? new Date().toISOString()),
  };
}
