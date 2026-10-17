import React, { useState } from 'react';
import { Scale, ChevronDown } from 'lucide-react';
import { ShiftSession, ThreeWayReconciliation } from '../types';
import { PaginationControls, usePagination } from './PaginationControls';
import { ShiftReconciliationSourceSummary } from './ShiftReconciliationSourceSummary';

interface ReconciliationLedgerProps {
  reconciliations: ThreeWayReconciliation[];
  shifts?: ShiftSession[];
  selectedShiftId?: string | null;
  onClearSelectedShift?: () => void;
}

export const ReconciliationLedger: React.FC<ReconciliationLedgerProps> = ({ reconciliations = [], shifts = [], selectedShiftId, onClearSelectedShift }) => {
  const [attendant, setAttendant] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const safeReconciliations = reconciliations || [];
  const filteredReconciliations = safeReconciliations.filter((rec) => {
    if (selectedShiftId && rec.shiftId !== selectedShiftId) return false;
    const shift = shifts.find((item) => item.id === rec.shiftId);
    const start = new Date(shift?.startTime || rec.timestamp);
    const localDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const localTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    return `${rec.staffName} ${shift?.staffName || ''}`.toLocaleLowerCase().includes(attendant.trim().toLocaleLowerCase())
      && (!date || localDate === date) && (!time || localTime === time);
  });
  const clearFilters = () => { setAttendant(''); setDate(''); setTime(''); onClearSelectedShift?.(); };
  const reconciliationPagination = usePagination(
    filteredReconciliations,
    JSON.stringify([attendant, date, time, filteredReconciliations.map((rec) => rec.id)]),
    5
  );
  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Scale className="w-6 h-6 text-emerald-400" />
          3-Way Match Ledger
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Historical record comparing physical drawer cash, dispenser pump meter sales, and underground tank dips.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3" aria-label="Search shifts">
        <h3 className="font-semibold text-slate-100">Search shifts</h3>
        {selectedShiftId && <p className="break-words text-sm text-emerald-300">Viewing shift: {selectedShiftId}. Clear filters to view all shifts.</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-2 text-sm text-slate-300">Shift attendant
            <input type="search" className="fms-input block w-full" placeholder="Search attendant name" value={attendant} onChange={(event) => setAttendant(event.target.value)} />
          </label>
          <label className="space-y-2 text-sm text-slate-300">Shift start date
            <input type="date" className="fms-input block w-full" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="space-y-2 text-sm text-slate-300">Shift start time
            <input type="time" className="fms-input block w-full" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <button type="button" className="fms-btn fms-btn-secondary self-end" onClick={clearFilters}>Clear filters</button>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">Search by any field or combine them. Date and time use local shift start time (to the minute); older records without a shift use the reconciliation timestamp.</p>
        <p className="text-sm text-slate-300" role="status">{filteredReconciliations.length} of {safeReconciliations.length} records</p>
      </section>

      {safeReconciliations.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
          <Scale className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="font-bold text-slate-200 text-base">No Shift Reconciliations Submitted Yet</h3>
          <p className="text-xs text-slate-500">
            Clock out active staff members in the Shift Management tab to run a 3-way reconciliation check.
          </p>
        </div>
      ) : filteredReconciliations.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-300">
          No shifts match your search. Change or clear the filters to view records.
        </div>
      ) : (
        <div className="space-y-4">
          {reconciliationPagination.pageItems.map((rec) => (
            (() => {
              const shift = shifts.find((item) => item.id === rec.shiftId);
              return (
            <div
              key={rec.id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">
                    Reconciliation: {rec.staffName}
                  </h3>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span>Shift: <span className="font-mono text-slate-300">{rec.shiftId || '—'}</span></span>
                    <span>Timestamp: {new Date(rec.timestamp).toLocaleString()}</span>
                    {shift && <><span>Started: {new Date(shift.startTime).toLocaleString()}</span><span>Ended: {shift.endTime ? new Date(shift.endTime).toLocaleString() : 'Not recorded'}</span></>}
                  </div>
                </div>

                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    rec.status === 'Auto-Approved' || rec.status === 'Approved'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : rec.status === 'Pending Approval'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {rec.status}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
                {/* Match 1: Cash */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-500 block uppercase font-bold text-[10px]">1. Cash Match</span>
                  <div className="text-slate-300">Expected: KES {rec.expectedCash.toLocaleString()}</div>
                  <div className="text-slate-200">Actual: KES {rec.totalActualCash.toLocaleString()}</div>
                  <div className={`font-bold pt-1 border-t border-slate-800 ${rec.cashVariance === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    Variance: KES {rec.cashVariance.toFixed(2)}
                  </div>
                </div>

                {/* Match 2: Pumps */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-500 block uppercase font-bold text-[10px]">2. Pump Meter Match</span>
                  <div className="text-slate-300">Pumps Count: {rec.pumpReadings.length}</div>
                  <VarianceValue label="Pump variance" value={rec.totalPumpVarianceLiters} />
                </div>

                {/* Match 3: Tanks */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-500 block uppercase font-bold text-[10px]">3. Tank Dip Match</span>
                  <div className="text-slate-300">Tanks Checked: {rec.tankDips.length}</div>
                  <VarianceValue label="Tank dip variance" value={rec.tankDips.length ? rec.totalTankVarianceLiters : null} />
                </div>
              </div>
              <details open={selectedShiftId === rec.shiftId ? true : undefined} className="group rounded-xl border border-slate-800 bg-slate-950 text-xs">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-bold text-slate-100 [&::-webkit-details-marker]:hidden">
                  <span>Shift reconciliation source summary</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-slate-800 p-4">
                  {shift && <div className="mb-4 grid gap-2 sm:grid-cols-3 text-slate-300"><span>Clock in: {new Date(shift.startTime).toLocaleString()}</span><span>Clock out: {shift.endTime ? new Date(shift.endTime).toLocaleString() : '—'}</span><span>Status: {shift.status} / {shift.approvalStatus || rec.status}</span></div>}
                  <ShiftReconciliationSourceSummary reconciliation={rec} shift={shift} />
                  {rec.managerNotes && <div className="mt-3 border-t border-slate-800 pt-3 text-sm leading-relaxed text-slate-300"><h4 className="mb-2 font-semibold">Manager review</h4><p className="whitespace-pre-wrap break-words">{rec.managerNotes}</p></div>}
                </div>
              </details>
            </div>
              );
            })()
          ))}
          <PaginationControls
            currentPage={reconciliationPagination.currentPage}
            totalPages={reconciliationPagination.totalPages}
            itemCount={filteredReconciliations.length}
            pageSize={5}
            onPageChange={reconciliationPagination.setCurrentPage}
          />
        </div>
      )}
    </div>
  );
};

const VarianceValue = ({ label, value }: { label: string; value: number | null }) => {
  const missing = value == null || !Number.isFinite(value);
  const differs = !missing && Math.abs(value) >= 0.0005;
  return <div className={`border-t border-slate-800 pt-2 leading-relaxed ${missing ? 'text-amber-300' : differs ? 'text-rose-400' : 'text-emerald-400'}`}>
    <div className="font-semibold">{label}</div>
    <div className="mt-1 font-bold">{missing ? 'Incomplete — missing reading' : `${value > 0 ? '+' : ''}${value.toLocaleString('en-KE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} L`}</div>
    <div className="mt-1 font-sans">{missing ? 'Review the source summary for missing records.' : differs ? 'Variance recorded' : 'No variance'}</div>
  </div>;
};
