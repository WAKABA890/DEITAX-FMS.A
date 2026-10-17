import React from 'react';
import type { OpeningPumpReading, PumpReconciliationReading, ShiftSession, TankReconciliationDip, ThreeWayReconciliation } from '../types';

type SourceValue = number | string | null | undefined;
type ValueKind = 'liters' | 'money';

interface SummaryRow {
  id: string;
  label: string;
  userValue: SourceValue;
  pts2Value: SourceValue;
  variance?: SourceValue;
  kind: ValueKind;
}

interface ShiftReconciliationSourceSummaryProps {
  reconciliation: ThreeWayReconciliation;
  shift?: ShiftSession;
  tone?: 'screen' | 'document';
}

const toFiniteNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const formatLiters = (value: SourceValue) => {
  if (typeof value === 'string') return value;
  const numericValue = toFiniteNumber(value);
  return numericValue == null
    ? 'Not recorded'
    : `${numericValue.toLocaleString('en-KE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} L`;
};

const formatMoney = (value: SourceValue) => {
  if (typeof value === 'string') return value;
  const numericValue = toFiniteNumber(value);
  return numericValue == null
    ? 'Not recorded'
    : `KES ${numericValue.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatSourceValue = (value: SourceValue, kind: ValueKind) => kind === 'money' ? formatMoney(value) : formatLiters(value);

const hasVariance = (value: SourceValue) => {
  const numericValue = toFiniteNumber(value);
  return numericValue != null && Math.abs(numericValue) >= 0.0005;
};

const formatVariance = (value: SourceValue, kind: ValueKind) => {
  const numericValue = toFiniteNumber(value);
  if (numericValue == null) return 'Not recorded';
  if (!hasVariance(numericValue)) return 'No variance';
  const absoluteValue = Math.abs(numericValue);
  const formattedValue = kind === 'money' ? formatMoney(absoluteValue) : formatLiters(absoluteValue);
  return `${numericValue > 0 ? '+' : '-'}${formattedValue}`;
};

const getUserMeterSales = (opening: ShiftSession['openingPumpReadings'][number] | undefined, reading: PumpReconciliationReading) => {
  const openingMeter = toFiniteNumber(opening?.reportedOpeningMeter);
  const closingMeter = toFiniteNumber(reading.reportedClosingMeter);
  return openingMeter == null || closingMeter == null ? null : closingMeter - openingMeter;
};

const toPositiveWholeNumber = (value: unknown) => {
  const numericValue = toFiniteNumber(value);
  return numericValue != null && numericValue > 0 && Number.isInteger(numericValue) ? numericValue : null;
};

const getNamedNumber = (value: unknown, name: 'pump' | 'nozzle') => {
  const match = String(value || '').match(new RegExp(`\\b${name}\\s*0*(\\d+)\\b`, 'i'));
  return match ? toPositiveWholeNumber(match[1]) : null;
};

const formatPumpNozzleLabel = (
  reading: PumpReconciliationReading,
  opening: OpeningPumpReading | undefined,
  fallbackNozzleNumber: number,
) => {
  const pumpName = String(reading.pumpName || opening?.pumpName || '').trim();
  const nozzleName = String(reading.nozzleName || opening?.nozzleName || '').trim();
  const pumpNumber = toPositiveWholeNumber(reading.pumpNumber)
    ?? toPositiveWholeNumber(opening?.pumpNumber)
    ?? getNamedNumber(pumpName, 'pump');
  const nozzleNumber = toPositiveWholeNumber(reading.nozzleNumber)
    ?? toPositiveWholeNumber(opening?.nozzleNumber)
    ?? getNamedNumber(nozzleName, 'nozzle')
    ?? getNamedNumber(pumpName, 'nozzle')
    ?? fallbackNozzleNumber;
  const pumpLabel = pumpNumber == null
    ? (pumpName.replace(/\s*[\/|.-]\s*nozzle\b.*$/i, '').trim() || 'Pump')
    : `Pump ${String(pumpNumber).padStart(2, '0')}`;
  const fuelName = String(reading.fuelName || opening?.fuelName || 'Fuel').trim() || 'Fuel';

  return `${pumpLabel} Nozzle ${nozzleNumber} / ${fuelName}`;
};

export const ShiftReconciliationSourceSummary: React.FC<ShiftReconciliationSourceSummaryProps> = ({
  reconciliation,
  shift,
  tone = 'screen',
}) => {
  const isDocument = tone === 'document';
  const openingPumps = new Map((shift?.openingPumpReadings || []).map((reading) => [reading.pumpId, reading]));
  const openingTanks = new Map((shift?.openingTankDips || []).map((dip) => [dip.tankId, dip]));
  const pumpReadings = reconciliation.pumpReadings?.length ? reconciliation.pumpReadings : (shift?.closingPumpReadings || []);
  const tankDips = reconciliation.tankDips?.length ? reconciliation.tankDips : (shift?.closingTankDips || []);
  const nextHistoricalNozzleNumberByPump = new Map<string, number>();

  const cashRows: SummaryRow[] = [{
    id: 'cash-closing-count',
    label: 'Closing cash count',
    userValue: shift?.actualCashCount ?? reconciliation.totalActualCash,
    pts2Value: 'N/A',
    variance: reconciliation.cashVariance,
    kind: 'money',
  }];

  const pumpRows = pumpReadings.flatMap((reading, index): SummaryRow[] => {
    const opening = openingPumps.get(reading.pumpId);
    const pumpNumber = toPositiveWholeNumber(reading.pumpNumber)
      ?? toPositiveWholeNumber(opening?.pumpNumber)
      ?? getNamedNumber(reading.pumpName || opening?.pumpName, 'pump');
    const pumpKey = pumpNumber == null
      ? String(reading.pumpName || opening?.pumpName || reading.pumpId || index).trim().toLocaleLowerCase()
      : `pump-${pumpNumber}`;
    const fallbackNozzleNumber = (nextHistoricalNozzleNumberByPump.get(pumpKey) || 0) + 1;
    nextHistoricalNozzleNumberByPump.set(pumpKey, fallbackNozzleNumber);
    const label = formatPumpNozzleLabel(reading, opening, fallbackNozzleNumber);
    const pts2Opening = opening?.authoritativeOpeningMeter ?? opening?.openingMeter ?? reading.openingMeter;
    const pts2Closing = reading.authoritativeClosingMeter ?? reading.closingMeter;

    return [
      {
        id: `${reading.pumpId}-${index}-opening`,
        label: `${label} opening meter`,
        userValue: opening?.reportedOpeningMeter,
        pts2Value: pts2Opening,
        variance: opening?.variance,
        kind: 'liters',
      },
      {
        id: `${reading.pumpId}-${index}-closing`,
        label: `${label} closing meter`,
        userValue: reading.reportedClosingMeter,
        pts2Value: pts2Closing,
        variance: reading.reportedVarianceLiters,
        kind: 'liters',
      },
      {
        id: `${reading.pumpId}-${index}-sales`,
        label: `${label} dispensed`,
        userValue: getUserMeterSales(opening, reading),
        pts2Value: reading.meterSalesLiters,
        variance: reading.varianceLiters,
        kind: 'liters',
      },
    ];
  });

  const tankRows = tankDips.flatMap((dip: TankReconciliationDip, index): SummaryRow[] => {
    const opening = openingTanks.get(dip.tankId);
    const label = `${dip.tankName || `Tank ${index + 1}`} / ${dip.fuelName || 'Fuel'}`;

    return [
      {
        id: `${dip.tankId}-${index}-opening`,
        label: `${label} opening stock`,
        userValue: opening?.reportedOpeningDip,
        pts2Value: opening?.authoritativeQuantity,
        variance: opening?.variance,
        kind: 'liters',
      },
      {
        id: `${dip.tankId}-${index}-movement`,
        label: `${label} tank movement`,
        userValue: dip.actualSales,
        pts2Value: 'N/A',
        variance: dip.varianceLiters,
        kind: 'liters',
      },
      {
        id: `${dip.tankId}-${index}-closing`,
        label: `${label} closing stock`,
        userValue: dip.closingDip,
        pts2Value: 'N/A',
        kind: 'liters',
      },
    ];
  });

  const tableClass = isDocument
    ? 'w-full table-fixed border-collapse text-[8px] text-slate-700'
    : 'w-full min-w-[560px] table-fixed border-collapse text-sm leading-relaxed text-slate-300';
  const headerClass = isDocument
    ? 'border-y border-slate-300 text-[7px] uppercase text-slate-600'
    : 'border-y border-slate-700 text-[10px] uppercase text-slate-500';
  const rowClass = isDocument
    ? 'border-b border-slate-100 align-top'
    : 'border-b border-slate-800 align-top';
  const varianceClass = (value: SourceValue) => hasVariance(value)
    ? (isDocument ? 'font-bold text-rose-700' : 'font-bold text-rose-400')
    : (isDocument ? 'text-slate-600' : 'text-slate-400');

  const renderTable = (title: string, rows: SummaryRow[]) => (
    <div className={isDocument ? 'space-y-1' : 'space-y-2'}>
      <h5 className={isDocument ? 'font-bold uppercase text-slate-700' : 'font-bold uppercase text-slate-200'}>{title}</h5>
      {rows.length === 0 ? (
        <p className={isDocument ? 'text-[9px] text-slate-500' : 'text-xs text-slate-500'}>No readings were recorded.</p>
      ) : (
        <div className={isDocument ? undefined : 'overflow-x-auto'}><table className={tableClass}>
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className={headerClass}>
            <tr>
              <th className="py-1 pr-1 text-left font-bold">Measure</th>
              <th className="px-1 py-1 text-right font-bold">User</th>
              <th className="px-1 py-1 text-right font-bold">PTS-2</th>
              <th className="py-1 pl-1 text-right font-bold">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowClass}>
                <td className="py-1 pr-1 font-medium break-words">{row.label}</td>
                <td className="px-1 py-1 text-right break-words">{formatSourceValue(row.userValue, row.kind)}</td>
                <td className="px-1 py-1 text-right break-words">{formatSourceValue(row.pts2Value, row.kind)}</td>
                <td className={`py-1 pl-1 text-right break-words ${varianceClass(row.variance)}`}>{formatVariance(row.variance, row.kind)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );

  return (
    <div className={isDocument ? 'space-y-3' : 'space-y-4'}>
      {renderTable('Cash reconciliation', cashRows)}
      {renderTable('Pump / nozzle source values', pumpRows)}
      {renderTable('Tank source values', tankRows)}
      <p className={isDocument ? 'text-[8px] text-slate-500' : 'text-[10px] text-slate-500'}>
        Variance is shown only when the comparison source was captured; “Not recorded” is not treated as zero.
      </p>
    </div>
  );
};
