import { TAX_RATE_MAP, type TaxCode, normalizeTaxCode } from '../constants/tax.ts';

export type DocumentLineInput = {
  quantity: number;
  unitPrice: number;
  taxCode: TaxCode | string;
};

export type TaxSummaryEntry = {
  gross: number;
  tax: number;
  net: number;
  rate: number;
};

export type DocumentLineTotals = {
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  taxCode: TaxCode;
  taxRate: number;
};

export type DocumentTotals = {
  items: DocumentLineTotals[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  taxSummary: Record<TaxCode, TaxSummaryEntry>;
};

const roundCurrency = (amount: number) => Number(amount.toFixed(2));

export const extractTaxFromGross = (grossAmount: number, taxCode: TaxCode | string): number => {
  const normalizedCode = typeof taxCode === 'string' ? normalizeTaxCode(taxCode) : taxCode;

  if (!Number.isFinite(grossAmount)) {
    throw new Error(`Invalid gross amount for tax code ${normalizedCode}: ${grossAmount}`);
  }

  if (grossAmount < 0) {
    throw new Error(`Negative gross amounts are not allowed for tax code ${normalizedCode}.`);
  }

  const rate = TAX_RATE_MAP[normalizedCode] ?? 0;
  if (rate === 0) {
    return 0;
  }

  return (grossAmount * rate) / (1 + rate);
};

export const validateDocumentTotals = (totals: Pick<DocumentTotals, 'subtotal' | 'taxAmount' | 'totalAmount' | 'taxSummary'>) => {
  const roundedSubtotal = roundCurrency(totals.subtotal);
  const roundedTax = roundCurrency(totals.taxAmount);
  const roundedTotal = roundCurrency(totals.totalAmount);

  if (totals.subtotal < 0 || totals.taxAmount < 0 || totals.totalAmount < 0) {
    throw new Error('Tax calculation integrity check failed. Negative financial values are not allowed.');
  }

  if (Math.abs(roundedSubtotal + roundedTax - roundedTotal) > 0.01) {
    throw new Error('Tax calculation integrity check failed. Transaction was not saved.');
  }

  if (Math.abs(roundedSubtotal - (roundedTotal - roundedTax)) > 0.01) {
    throw new Error('Subtotal must equal total minus tax amount.');
  }

  const summaryTax = Object.values(totals.taxSummary).reduce((sum, entry) => sum + entry.tax, 0);
  const summaryNet = Object.values(totals.taxSummary).reduce((sum, entry) => sum + entry.net, 0);
  const summaryGross = Object.values(totals.taxSummary).reduce((sum, entry) => sum + entry.gross, 0);

  if (Math.abs(summaryTax - totals.taxAmount) > 0.01) {
    throw new Error('Tax summary tax total does not match the document tax total.');
  }

  if (Math.abs(summaryNet - totals.subtotal) > 0.01) {
    throw new Error('Tax summary net total does not match the document subtotal.');
  }

  if (Math.abs(summaryGross - totals.totalAmount) > 0.01) {
    throw new Error('Tax summary gross total does not match the document total.');
  }
};

export const computeDocumentTotals = (lineItems: DocumentLineInput[]): DocumentTotals => {
  const items: DocumentLineTotals[] = lineItems.map((line) => {
    const quantity = Number(line.quantity ?? 0);
    const unitPrice = Number(line.unitPrice ?? 0);
    const normalizedTaxCode = typeof line.taxCode === 'string' ? normalizeTaxCode(line.taxCode) : line.taxCode;
    const grossAmount = quantity * unitPrice;
    const taxAmount = extractTaxFromGross(grossAmount, normalizedTaxCode);
    const netAmount = grossAmount - taxAmount;

    return {
      quantity,
      unitPrice,
      grossAmount,
      taxAmount,
      netAmount,
      taxCode: normalizedTaxCode,
      taxRate: TAX_RATE_MAP[normalizedTaxCode] ?? 0,
    };
  });

  const taxSummary: Record<TaxCode, TaxSummaryEntry> = {
    A: { gross: 0, tax: 0, net: 0, rate: TAX_RATE_MAP.A },
    B: { gross: 0, tax: 0, net: 0, rate: TAX_RATE_MAP.B },
    C: { gross: 0, tax: 0, net: 0, rate: TAX_RATE_MAP.C },
    D: { gross: 0, tax: 0, net: 0, rate: TAX_RATE_MAP.D },
    E: { gross: 0, tax: 0, net: 0, rate: TAX_RATE_MAP.E },
  };

  for (const item of items) {
    const bucket = taxSummary[item.taxCode];
    bucket.gross += item.grossAmount;
    bucket.tax += item.taxAmount;
    bucket.net += item.netAmount;
  }

  const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.grossAmount, 0);
  const subtotal = totalAmount - taxAmount;

  const totals: DocumentTotals = {
    items,
    subtotal,
    taxAmount,
    totalAmount,
    taxSummary,
  };

  validateDocumentTotals(totals);
  return totals;
};
