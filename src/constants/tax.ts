export const TAX_RATE_MAP = {
  A: 0,
  B: 0.16,
  C: 0,
  D: 0,
  E: 0.08,
} as const;

export const TAX_CODE_LABELS = {
  A: 'Exempt',
  B: 'Standard (16%)',
  C: 'Zero-Rated',
  D: 'Other',
  E: 'Reduced (8%)',
} as const;

export type TaxCode = keyof typeof TAX_RATE_MAP;

export const TAX_CODES = Object.keys(TAX_RATE_MAP) as TaxCode[];

export const normalizeTaxCode = (value: string | null | undefined): TaxCode => {
  const candidate = String(value ?? '').trim().toUpperCase();
  if (candidate in TAX_RATE_MAP) {
    return candidate as TaxCode;
  }

  throw new Error(`Invalid tax code: ${value}. Expected one of ${TAX_CODES.join(', ')}.`);
};
