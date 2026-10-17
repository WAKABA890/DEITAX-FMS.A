import React, { useEffect, useRef, useState } from 'react';
import { Transaction, StationSettings } from '../types';
import { X, Download, Printer } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { printSelectedDocument } from '../utils/print-document';
import { TAX_RATE_MAP } from '../constants/tax';

interface ReceiptModalProps {
  transaction: Transaction | null;
  settings?: StationSettings | null;
  onClose: () => void;
  isDraft?: boolean;
  isConfirming?: boolean;
  onConfirm?: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  transaction,
  settings,
  onClose,
  isDraft = false,
  isConfirming = false,
  onConfirm,
}) => {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const receiptRef = useRef<HTMLElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    previewScrollRef.current?.scrollTo({ top: 0 });
  }, [transaction?.id]);

  if (!transaction) return null;

  const resolveReceiptTarget = () => {
    if (receiptRef.current) return receiptRef.current;
    return document.querySelector('.thermal-receipt.pdf-capture') as HTMLElement | null;
  };

  const handlePrint = () => {
    try {
      const target = resolveReceiptTarget();
      if (!target) throw new Error('Receipt element was not found.');
      printSelectedDocument(target, { pageSize: '80mm auto' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown print error';
      setPdfError(`Unable to print document: ${message}`);
    }
  };

  const handleDownload = async () => {
    setIsGeneratingPdf(true);
    setPdfError(null);

    try {
      const target = resolveReceiptTarget();

      if (!target) {
        throw new Error('Receipt element was not found.');
      }

      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      const rect = target.getBoundingClientRect();
      const captureWidth = Math.max(Math.ceil(rect.width || target.scrollWidth || target.offsetWidth || target.clientWidth || 540), 1);
      const captureHeight = Math.max(Math.ceil(rect.height || target.scrollHeight || target.offsetHeight || target.clientHeight || 900), 1);

      if (!captureWidth || !captureHeight) {
        throw new Error(`Invalid receipt dimensions: ${captureWidth} x ${captureHeight}`);
      }

      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: captureWidth,
        height: captureHeight,
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDocument) => {
          const clonedReceipt = clonedDocument.querySelector('.thermal-receipt') as HTMLElement | null;

          if (clonedReceipt) {
            clonedReceipt.style.backgroundColor = '#ffffff';
            clonedReceipt.style.color = '#111111';
            clonedReceipt.style.opacity = '1';
            clonedReceipt.style.display = 'block';
            clonedReceipt.style.width = `${captureWidth}px`;
            clonedReceipt.style.maxWidth = `${captureWidth}px`;
            clonedReceipt.style.minWidth = `${captureWidth}px`;
          }

          const screenUI = clonedDocument.querySelectorAll('.receipt-screen-ui, button, .pdf-error');
          screenUI.forEach((element) => {
            if (element instanceof HTMLElement) {
              element.style.display = 'none';
            }
          });
        },
      });

      if (!canvas.width || !canvas.height) {
        throw new Error('Generated receipt canvas has invalid dimensions.');
      }

      const imgData = canvas.toDataURL('image/png');
      const pdfWidthMm = 80;
      const pdfHeightMm = Math.max((canvas.height * pdfWidthMm) / canvas.width, 80);

      if (!Number.isFinite(pdfHeightMm) || pdfHeightMm <= 0) {
        throw new Error(`Invalid PDF height: ${pdfHeightMm}`);
      }

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pdfWidthMm, pdfHeightMm],
        compress: true,
      });

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidthMm, pdfHeightMm, undefined, 'FAST');

      const safeFileName = `${(transaction.receiptNo || transaction.taxInvoiceNo || 'receipt')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'receipt'}.pdf`;

      pdf.save(safeFileName);
    } catch (error) {
      console.error('Receipt PDF generation failed:', error);

      const message = error instanceof Error ? error.message : 'Unknown PDF generation error';

      setPdfError(`Unable to generate PDF: ${message}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const stationName = settings?.stationName || 'DEITAX FMS.A PETROLEUM LTD';
  const stationTagline = settings?.tagline || 'Fueling your journey with confidence';
  const stationAddress = settings?.address || 'Westlands Highway Station #04';
  const stationPhone = settings?.phone || '+254 (0) 700 123 456';
  const stationEmail = settings?.email || 'support@dtfms.co.ke';
  const stationTaxPin = settings?.taxPin || 'P051892301A';
  const stationPaybill = settings?.paybillNumber || '000000';
  const stationPaybillAccount = settings?.paybillAccountNumber || '000000';
  const stationTill = settings?.tillNumber || '000000';
  const showPaybillOnReceipt = settings?.showPaybillOnInvoice ?? true;
  const showTillOnReceipt = settings?.showTillOnInvoice ?? false;
  const hasPaymentOptions = (showPaybillOnReceipt && Boolean(stationPaybill) && Boolean(stationPaybillAccount)) || (showTillOnReceipt && Boolean(stationTill));
  const invoiceTerms = settings?.invoiceTerms || 'Thank you for fueling with DEITAX FMS.A Petroleum! Safe Journey.';
  const finalizedDocumentHeading = (() => {
    const kind = (transaction.documentType || (transaction.taxInvoiceNo ? 'Invoice' : 'Receipt')).toLowerCase();

    if (kind === 'invoice') return 'NORMAL INVOICE';
    if (kind === 'credit note') return 'CREDIT NOTE';
    return 'RECEIPT';
  })();
  const documentHeading = isDraft ? `DRAFT ${finalizedDocumentHeading}` : finalizedDocumentHeading;
  const isCreditNote = (transaction.documentType || '').toLowerCase() === 'credit note' || finalizedDocumentHeading === 'CREDIT NOTE';

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-KE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);

  type ReceiptItemLike = {
    name: string;
    qty: number;
    unitPrice: number;
    totalPrice: number;
    taxAmount: number;
    taxableAmount?: number;
    totalAmount?: number;
    type: 'Fuel' | 'Shop';
    taxCode?: string;
    taxRate?: number;
  };

  // Never fabricate product lines when a malformed or legacy record has no
  // item payload. A neutral line preserves the recorded totals without showing
  // products that were not part of the transaction.
  const fallbackTotal = Number(transaction.totalAmount ?? 0);
  const fallbackSubtotal = Number(transaction.subtotal ?? fallbackTotal);
  const fallbackTax = Number(transaction.taxAmount ?? Math.max(0, fallbackTotal - fallbackSubtotal));
  const fallbackItems: ReceiptItemLike[] = [{
    name: 'TRANSACTION ITEM',
    qty: 1,
    unitPrice: fallbackTotal,
    totalPrice: fallbackTotal,
    taxableAmount: fallbackSubtotal,
    taxAmount: fallbackTax,
    type: transaction.type === 'Shop' ? 'Shop' : 'Fuel',
    taxCode: 'A',
  }];

  const receiptItems: ReceiptItemLike[] = transaction.items && transaction.items.length > 0 ? transaction.items.map((item) => {
    const rawItem = item as any;
    const qty = Number(rawItem.quantity ?? rawItem.qty ?? 1);
    const unitPrice = Number(rawItem.unitPrice ?? 0);
    const totalPrice = Number(rawItem.totalAmount ?? rawItem.totalPrice ?? (qty * unitPrice));
    const taxCode = String(rawItem.taxCode || 'A').toUpperCase();
    const taxRate = TAX_RATE_MAP[taxCode as keyof typeof TAX_RATE_MAP] ?? 0;
    // Receipt figures are derived from the VAT-inclusive line amount and tax
    // code. This also renders legacy PTS-2 captures consistently when an old
    // persisted taxAmount was calculated using the wrong rate representation.
    const taxAmount = taxRate === 0 ? 0 : (totalPrice * taxRate) / (1 + taxRate);
    const taxableAmount = totalPrice - taxAmount;

    return {
      ...item,
      name: String(rawItem.name || 'ITEM').replace(/\s*\([^)]*\)\s*$/g, '').trim() || 'ITEM',
      qty,
      unitPrice,
      totalPrice,
      taxableAmount,
      totalAmount: rawItem.totalAmount ?? totalPrice,
      taxAmount,
      taxCode,
      taxRate,
    };
  }) : fallbackItems;
  const itemCount = receiptItems.length;
  const hasStoredItems = Boolean(transaction.items && transaction.items.length > 0);
  const calculatedSubtotal = receiptItems.reduce((sum, item) => sum + Number(item.taxableAmount ?? (Number(item.totalPrice || 0) - Number(item.taxAmount || 0))), 0);
  const calculatedTax = receiptItems.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
  const calculatedTotal = receiptItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const subtotal = hasStoredItems ? calculatedSubtotal : Number(transaction.subtotal ?? calculatedSubtotal);
  const taxAmount = hasStoredItems ? calculatedTax : Number(transaction.taxAmount ?? calculatedTax);
  const totalAmount = hasStoredItems ? calculatedTotal : Number(transaction.totalAmount ?? calculatedTotal);
  const signedSubtotal = isCreditNote ? -Math.abs(subtotal) : subtotal;
  const signedTaxAmount = isCreditNote ? -Math.abs(taxAmount) : taxAmount;
  const signedTotalAmount = isCreditNote ? -Math.abs(totalAmount) : totalAmount;
  const paymentMethod = String(transaction.paymentMethod || 'Cash');
  const paymentMethodMap: Record<string, string> = {
    Cash: 'CASH',
    'M-Pesa': 'MOBILE MONEY',
    Card: 'CARD',
    Credit: 'CREDIT',
    'Bank Transfer': 'BANK TRANSFER',
  };
  const paymentLabel = paymentMethodMap[paymentMethod] || paymentMethod.toUpperCase();

  const taxSummary: Record<string, { taxable: number; tax: number; rate: string }> = {
    A: { taxable: 0, tax: 0, rate: 'Exempt' },
    B: { taxable: 0, tax: 0, rate: '16%' },
    C: { taxable: 0, tax: 0, rate: '0%' },
    D: { taxable: 0, tax: 0, rate: 'Non-VAT' },
    E: { taxable: 0, tax: 0, rate: '8%' },
  };

  for (const item of receiptItems) {
    const total = Number(item.totalPrice || 0);
    const taxCode = String(item.taxCode || 'A').toUpperCase();
    const group = taxSummary[taxCode] || taxSummary.A;
    const tax = Number(item.taxAmount || 0);
    group.taxable += Math.max(0, total - tax);
    group.tax += tax;
  }

  const amountPaid = totalAmount;
  const changeDue = Math.max(0, amountPaid - totalAmount);

  const visibleTaxGroups = (['A', 'B', 'C', 'D', 'E'] as const).filter((code) => {
    const group = taxSummary[code];
    return Number(group.taxable) > 0 || Number(group.tax) > 0 || Number(group.taxable + group.tax) > 0;
  });

  console.log('Receipt tax debug:', {
    receiptItems,
    taxSummary,
    visibleTaxGroups,
  });

  const dateValue = new Date(transaction.timestamp);
  const receiptDate = dateValue.toLocaleDateString('en-GB');
  const receiptTime = dateValue.toLocaleTimeString('en-GB');
  const compactTime = receiptTime.includes(':') ? receiptTime.slice(0, 5) : receiptTime;

  const totalAmountLabel = `KES ${formatCurrency(signedTotalAmount)}`;
  const subtotalLabel = `KES ${formatCurrency(signedSubtotal)}`;
  const taxLabel = `KES ${formatCurrency(signedTaxAmount)}`;
  const amountPaidLabel = `KES ${formatCurrency(amountPaid)}`;
  const changeDueLabel = `KES ${formatCurrency(changeDue)}`;
  const originalReferenceNo = (() => {
    const originalDocumentNo = (transaction.originalDocumentNo || '').trim();
    const invoiceNo = (transaction.originalInvoiceNo || '').trim();
    const receiptNo = (transaction.originalReceiptNo || '').trim();

    if (originalDocumentNo && /^(Rcpt|Rec|Inv)/i.test(originalDocumentNo)) return originalDocumentNo;
    if (receiptNo && /^(Rcpt|Rec)/i.test(receiptNo)) return receiptNo;
    if (invoiceNo && /^Inv/i.test(invoiceNo)) return invoiceNo;
    if (receiptNo) return receiptNo;
    if (invoiceNo) return invoiceNo;
    return 'Original document unavailable';
  })();
  const originalReferenceLabel = 'Original Document No:';

  return (
    <>
      <style>{`
        .thermal-receipt,
        .thermal-receipt *,
        .receipt-paper,
        .receipt-paper * {
          font-family: "Courier New", Courier, monospace;
        }

        .thermal-receipt {
          width: 80mm;
          max-width: 80mm;
          min-width: 80mm;
          margin: 0 auto;
          padding: 2mm 2mm;
          box-sizing: border-box;
          background: #ffffff;
          color: #111111;
          font-size: 10px;
          line-height: 1.4;
          height: auto;
          min-height: 0;
          overflow: visible;
          opacity: 1;
        }

        .receipt-paper {
          width: 100%;
          box-sizing: border-box;
          margin: 0;
          padding: 0 1mm;
          background: #ffffff;
          color: #111111;
          overflow: visible;
          height: auto;
          min-height: 0;
          line-height: 1.4;
          opacity: 1;
        }

        .receipt-header,
        .receipt-info,
        .receipt-table,
        .receipt-totals,
        .receipt-payment,
        .receipt-tax,
        .receipt-footer {
          width: 100%;
          height: auto;
          min-height: 0;
        }

        .receipt-divider {
          border: 0;
          border-top: 1px dashed #444444;
          margin: 7px 0;
          height: 0;
          min-height: 0;
          overflow: visible;
        }

        .receipt-divider.major,
        .receipt-divider.strong {
          border-top: 1.5px solid #222222;
          margin: 8px 0;
        }

        .receipt-divider.total {
          border-top: 2px solid #000000;
          border-bottom: 2px solid #000000;
          margin: 8px 0;
        }

        .receipt-heading {
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          line-height: 1.3;
          margin: 4px 0 8px;
          padding: 2px 0;
          color: #000000;
        }

        .receipt-station-name {
          text-align: left;
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
          margin: 6px 0 8px;
          padding: 2px 0;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          color: #000000;
          opacity: 1;
          letter-spacing: 0.01em;
        }

        .receipt-station-address,
        .receipt-meta,
        .receipt-copy,
        .receipt-row,
        .receipt-line,
        .receipt-table-head,
        .receipt-item-row,
        .receipt-total-row,
        .receipt-payment-row,
        .receipt-tax-row,
        .receipt-footer-row,
        .receipt-total-final {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 4px;
          line-height: 1.4;
          flex-wrap: wrap;
        }

        .receipt-station-address,
        .receipt-meta,
        .receipt-copy,
        .receipt-row,
        .receipt-line,
        .receipt-total-row,
        .receipt-payment-row,
        .receipt-tax-row,
        .receipt-footer-row {
          font-size: 9.5px;
        }

        .receipt-station-address,
        .receipt-meta,
        .receipt-copy {
          text-align: left;
          justify-content: flex-start;
          width: 100%;
          min-width: 0;
          overflow: visible;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          color: #000000;
          opacity: 1;
          font-weight: 800;
          letter-spacing: 0.01em;
          line-height: 1.5;
          display: block;
        }

        .receipt-meta {
          font-size: 9px;
          color: #000000;
          font-weight: 800;
          opacity: 1;
        }

        .receipt-copy {
          font-size: 9px;
          color: #000000;
          font-weight: 800;
          opacity: 1;
        }

        .receipt-info {
          margin-top: 4px;
          margin-bottom: 4px;
          padding: 2px 0;
        }

        .receipt-row {
          margin: 0;
          padding: 2px 0;
          min-height: 18px;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          color: #111111;
          font-weight: 600;
        }

        .receipt-row span,
        .receipt-total-row span,
        .receipt-payment-row span,
        .receipt-tax-row span,
        .receipt-footer-row span {
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .receipt-row span:last-child,
        .receipt-total-row span:last-child,
        .receipt-payment-row span:last-child,
        .receipt-tax-row span:last-child,
        .receipt-footer-row span:last-child {
          text-align: right;
        }

        .receipt-table {
          margin-top: 4px;
          margin-bottom: 4px;
          padding: 4px 0;
          overflow: visible;
        }

        .receipt-table-head,
        .receipt-item-row {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(32px, 0.5fr) minmax(55px, 0.9fr) minmax(65px, 1fr) minmax(30px, 0.4fr);
          align-items: center;
          column-gap: 2px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          padding: 4px 0;
          line-height: 1.4;
          min-height: 18px;
          overflow: visible;
          height: auto;
        }

        .receipt-table-head {
          font-size: 9px;
          font-weight: 700;
          margin-bottom: 2px;
          text-transform: uppercase;
          border-bottom: 1px dashed #444444;
          padding-bottom: 5px;
          color: #111111;
        }

        .receipt-table-head > div,
        .receipt-item-row > div {
          min-width: 0;
          overflow: visible;
          text-overflow: initial;
          white-space: normal;
        }

        .receipt-table-head > div:nth-child(-n + 2),
        .receipt-item-row > div:nth-child(-n + 2) {
          justify-self: start;
          text-align: left;
        }

        .receipt-table-head > div:nth-child(n + 3),
        .receipt-item-row > div:nth-child(n + 3) {
          text-align: right;
          justify-self: end;
          white-space: nowrap;
          overflow: visible;
          text-overflow: clip;
        }

        .receipt-item-row {
          font-size: 9.5px;
          margin: 0;
          min-height: 18px;
          height: auto;
          color: #111111;
          font-weight: 600;
        }

        .item-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.4;
          min-width: 0;
        }

        .receipt-totals,
        .receipt-payment,
        .receipt-tax,
        .receipt-footer {
          margin-top: 6px;
          padding-top: 6px;
          padding-bottom: 6px;
        }

        .receipt-total-row,
        .receipt-payment-row,
        .receipt-footer-row {
          margin: 0;
          padding: 3px 0;
          line-height: 1.4;
          min-height: 18px;
          color: #111111;
          font-weight: 600;
        }

        .receipt-total-final {
          margin-top: 6px;
          padding: 6px 0;
          border-top: 1.5px solid #222222;
          border-bottom: 2px solid #000000;
          font-weight: 700;
          font-size: 13px;
          line-height: 1.3;
          width: 100%;
          height: auto;
          min-height: 18px;
          color: #000000;
        }

        .receipt-payment-title,
        .receipt-tax-title,
        .receipt-footer-title {
          font-size: 10px;
          font-weight: 700;
          margin: 4px 0 2px;
          text-transform: uppercase;
          line-height: 1.3;
          color: #111111;
        }

        .receipt-payment-options {
          margin-top: 8px;
          margin-bottom: 6px;
          padding: 4px 0;
          border-top: 1px dotted #444444;
          border-bottom: 1px dotted #444444;
          width: 100%;
        }

        .receipt-payment-options-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          text-align: center;
          letter-spacing: 0.02em;
          line-height: 1.5;
          color: #111111;
          margin: 4px 0;
        }

        .receipt-payment-options-row {
          text-align: center;
          font-size: 9px;
          font-weight: 600;
          line-height: 1.5;
          color: #111111;
          margin: 2px 0;
        }

        .receipt-payment-row {
          padding: 2px 0;
        }

        .payment-method {
          margin-top: 2px;
          margin-bottom: 6px;
          font-weight: 700;
          color: #111111;
        }

        .receipt-tax-table {
          width: 100%;
          margin-top: 2px;
        }

        .receipt-tax-head,
        .receipt-tax-body-row {
          display: grid;
          grid-template-columns: 0.6fr 1.2fr 1fr;
          column-gap: 4px;
          align-items: center;
          padding: 3px 0;
          line-height: 1.4;
          min-height: 18px;
          height: auto;
        }

        .receipt-tax-head {
          font-size: 9px;
          font-weight: 700;
          margin-bottom: 2px;
          text-transform: uppercase;
          color: #111111;
        }

        .receipt-tax-head > div,
        .receipt-tax-body-row > div {
          overflow: visible;
          text-overflow: initial;
          white-space: normal;
        }

        .receipt-tax-head > div:nth-child(n + 2),
        .receipt-tax-body-row > div:nth-child(n + 2) {
          text-align: right;
        }

        .receipt-tax-body-row {
          font-size: 9px;
          margin: 0;
          color: #111111;
          font-weight: 600;
        }

        .receipt-footer {
          margin-top: 6px;
          text-align: center;
          padding-top: 8px;
          padding-bottom: 8px;
          line-height: 1.4;
        }

        .receipt-footer .receipt-footer-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 9px;
          margin: 0;
          padding: 2px 0;
          min-height: 18px;
          line-height: 1.4;
          color: #111111;
          font-weight: 600;
        }

        .receipt-footer .receipt-footer-row span:last-child {
          text-align: right;
          min-width: 0;
          overflow: visible;
          text-overflow: clip;
          white-space: nowrap;
        }

        .receipt-credit-note-notice {
          display: block;
          width: 100%;
          text-align: center;
          margin-top: 8px;
          margin-bottom: 2px;
          color: #111111;
          line-height: 1.5;
        }

        .receipt-credit-note-line,
        .receipt-credit-note-message {
          display: block;
          width: 100%;
          text-align: center;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.02em;
          line-height: 1.5;
          color: #111111;
        }

        .receipt-thanks {
          text-align: center;
          font-size: 11px;
          font-weight: 700;
          margin-top: 8px;
          padding-top: 6px;
          letter-spacing: 0.02em;
          line-height: 1.4;
          border-top: 1px dashed #444444;
          color: #111111;
        }

      `}</style>

      <div
        ref={previewScrollRef}
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-0 pt-14 backdrop-blur-sm animate-in fade-in duration-200 relative"
      >
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          {!isDraft && (
            <>
              <button
                onClick={handlePrint}
                aria-label="Print finalized receipt"
                className="p-2 rounded-lg bg-slate-900/90 text-slate-100 border border-slate-700 shadow-lg hover:bg-slate-800 transition-colors"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                onClick={handleDownload}
                disabled={isGeneratingPdf}
                aria-label="Download receipt PDF"
                className="p-2 rounded-lg bg-slate-900/90 text-slate-100 border border-slate-700 shadow-lg hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            aria-label="Close receipt"
            className="p-2 rounded-lg bg-slate-900/90 text-slate-200 border border-slate-700 shadow-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <main ref={receiptRef} data-printable-document className="thermal-receipt receipt-print-area receipt-print-shell pdf-capture shrink-0">
          {pdfError && (
            <div className="receipt-screen-ui bg-red-950/90 text-red-200 px-4 py-2 text-xs border-b border-red-800">
              {pdfError}
            </div>
          )}

          <div className="receipt-paper">
            <header className="receipt-header">
              <div className="receipt-divider major" />
              <div className="receipt-heading">{documentHeading}</div>
              <div className="receipt-divider major" />
              <div className="receipt-station-name">{stationName.toUpperCase()}</div>
              <div className="receipt-station-address">{stationAddress}</div>
              <div className="receipt-meta">PIN: {stationTaxPin}</div>
              <div className="receipt-copy">{isDraft ? 'Draft preview - not yet issued' : 'Original'}</div>
            </header>

            <div className="receipt-divider" />

            <section className="receipt-info">
              <div className="receipt-row">
                <span>Date: {receiptDate}</span>
                <span>Time: {compactTime}</span>
              </div>
              <div className="receipt-row">
                <span>Buyer: {transaction.customerName || 'Walk-in Customer'}</span>
              </div>
              <div className="receipt-row">
                <span>Buyer PIN: {transaction.customerPin || '-'}</span>
              </div>
              {isCreditNote ? (
                <>
                  {transaction.originalInvoiceNo || transaction.originalReceiptNo ? (
                    <div className="receipt-row">
                      <span>{originalReferenceLabel}</span>
                      <span>{originalReferenceNo}</span>
                    </div>
                  ) : (
                    <div className="receipt-row">
                      <span>{originalReferenceLabel}</span>
                      <span>{originalReferenceNo}</span>
                    </div>
                  )}
                </>
              ) : null}
              <div className="receipt-row">
                <span>Served By: {transaction.staffName || 'Cashier'}</span>
              </div>
            </section>

            <div className="receipt-divider" />

            <section className="receipt-table">
              <div className="receipt-table-head">
                <div>ITEM</div>
                <div>QTY</div>
                <div>PRICE</div>
                <div>TOTAL</div>
                <div>TAX</div>
              </div>

              {receiptItems.map((item, index) => {
                const taxCode = String(item.taxCode || 'A').toUpperCase();
                const taxRateMap: Record<string, string> = {
                  A: '0%',
                  B: '16%',
                  C: '0%',
                  D: '0%',
                  E: '8%',
                };
                const taxLabel = taxRateMap[taxCode] || '0%';
                const itemTotal = Number(item.totalPrice || 0);
                const signedTotal = isCreditNote ? -Math.abs(itemTotal) : itemTotal;

                return (
                  <div key={`${item.name}-${index}`} className="receipt-item-row">
                    <div className="item-name">{String(item.name || 'ITEM').toUpperCase()}</div>
                    <div>{Number(item.qty || 0).toFixed(1)}</div>
                    <div>{formatCurrency(Number(item.unitPrice || item.totalPrice || 0))}</div>
                    <div>{formatCurrency(signedTotal)}</div>
                    <div>{taxLabel}</div>
                  </div>
                );
              })}
            </section>

            <div className="receipt-divider" />

            <section className="receipt-totals">
              <div className="receipt-total-row">
                <span>Subtotal (Ex. VAT)</span>
                <span>{subtotalLabel}</span>
              </div>
              <div className="receipt-total-row">
                <span>VAT</span>
                <span>{taxLabel}</span>
              </div>
              <div className="receipt-total-final">
                <span>TOTAL TO PAY</span>
                <span>{totalAmountLabel}</span>
              </div>
            </section>

            <div className="receipt-divider" />

            <section className="receipt-tax">
              <div className="receipt-tax-title">Tax Summary</div>
              <div className="receipt-tax-table">
                <div className="receipt-tax-head">
                  <div>Rate</div>
                  <div>Gross</div>
                  <div>Tax</div>
                </div>

                {visibleTaxGroups.map((code) => {
                  const group = taxSummary[code];
                  const gross = (group.taxable || 0) + (group.tax || 0);

                  return (
                    <div key={code} className="receipt-tax-body-row">
                      <div>{group.rate}</div>
                      <div>{`KES ${formatCurrency(gross)}`}</div>
                      <div>{`KES ${formatCurrency(group.tax)}`}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="receipt-divider" />

            <section className="receipt-payment">
              <div className="receipt-payment-title">Payment Details</div>
              <div className="receipt-payment-row payment-method">
                <span>PAYMENT METHOD: {paymentLabel}</span>
              </div>
              <div className="receipt-payment-row">
                <span>Amount Paid</span>
                <span>{amountPaidLabel}</span>
              </div>
              <div className="receipt-payment-row">
                <span>Change Due</span>
                <span>{changeDueLabel}</span>
              </div>
            </section>

            {hasPaymentOptions && (
              <section className="receipt-payment-options">
                <div className="receipt-payment-options-title">PAYMENT OPTIONS</div>
                {showPaybillOnReceipt && stationPaybill && stationPaybillAccount && (
                  <div className="receipt-payment-options-row">
                    M-PESA PAYBILL: {stationPaybill} | A/C: {stationPaybillAccount}
                  </div>
                )}
                {showTillOnReceipt && stationTill && (
                  <div className="receipt-payment-options-row">
                    BUY GOODS TILL: {stationTill}
                  </div>
                )}
              </section>
            )}

            <footer className="receipt-footer">
              <div className="receipt-footer-row">
                <span>{isDraft ? 'Document Status:' : isCreditNote ? 'Credit Note No:' : 'Receipt No:'}</span>
                <span>{isDraft ? 'Draft - number assigned after confirmation' : transaction.receiptNo || 'N/A'}</span>
              </div>
              {isCreditNote ? (
                <div className="receipt-footer-row">
                  <span>{originalReferenceLabel}</span>
                  <span>{originalReferenceNo}</span>
                </div>
              ) : null}
              <div className="receipt-footer-row">
                <span>Date:</span>
                <span>{receiptDate}</span>
              </div>
              <div className="receipt-footer-row">
                <span>Time:</span>
                <span>{receiptTime}</span>
              </div>
              {isCreditNote && (
                <div className="receipt-credit-note-notice" aria-label="Credit note approval notice">
                  <span className="receipt-credit-note-line">------------------------------------------------</span>
                  <span className="receipt-credit-note-message">CREDIT NOTE IS APPROVED ONLY</span>
                  <span className="receipt-credit-note-message">FOR ORIGINAL SALES RECEIPT</span>
                  <span className="receipt-credit-note-line">------------------------------------------------</span>
                </div>
              )}
              {/* ✅ Dynamic footer using invoiceTerms from settings */}
              <div className="receipt-thanks">{invoiceTerms}</div>
            </footer>
          </div>
        </main>
        {isDraft && onConfirm && (
          <div className="receipt-screen-ui absolute inset-x-0 bottom-0 z-10 border-t border-slate-700 bg-slate-900/95 p-3 backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
              <div className="text-xs text-slate-300">No sale, stock movement, or document number has been created.</div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isConfirming}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={isConfirming}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isConfirming ? 'Processing...' : 'Confirm & Process Sale'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
