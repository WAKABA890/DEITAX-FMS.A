import React from 'react';
import { Scale, CheckCircle2, AlertTriangle, ShieldAlert, FileText } from 'lucide-react';
import { ShiftSession, ThreeWayReconciliation } from '../types';
import { PaginationControls, usePagination } from './PaginationControls';

interface ReconciliationLedgerProps {
  reconciliations: ThreeWayReconciliation[];
  shifts?: ShiftSession[];
}

export const ReconciliationLedger: React.FC<ReconciliationLedgerProps> = ({ reconciliations = [], shifts = [] }) => {
  const safeReconciliations = reconciliations || [];
  const reconciliationPagination = usePagination(
    safeReconciliations,
    safeReconciliations.map((reconciliation) => reconciliation.id).join('|')
  );
  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Scale className="w-6 h-6 text-emerald-400" />
          3-Way Cash, Pump & Tank Reconciliation Ledger
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Historical record comparing physical drawer cash, dispenser pump meter sales, and underground tank dips.
        </p>
      </div>

      {safeReconciliations.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
          <Scale className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="font-bold text-slate-200 text-base">No Shift Reconciliations Submitted Yet</h3>
          <p className="text-xs text-slate-500">
            Clock out active staff members in the Shift Management tab to run a 3-way reconciliation check.
          </p>
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
                  <span className="text-xs text-slate-400">
                    Timestamp: {new Date(rec.timestamp).toLocaleString()}
                  </span>
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
                  <div className="text-emerald-400 font-bold pt-1 border-t border-slate-800">
                    Pump Variance: {rec.totalPumpVarianceLiters.toFixed(1)} L
                  </div>
                </div>

                {/* Match 3: Tanks */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-500 block uppercase font-bold text-[10px]">3. Tank Dip Match</span>
                  <div className="text-slate-300">Tanks Checked: {rec.tankDips.length}</div>
                  <div className="text-emerald-400 font-bold pt-1 border-t border-slate-800">
                    Tank Dip Variance: {rec.totalTankVarianceLiters.toFixed(1)} L
                  </div>
                </div>
              </div>
              {shift && <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs">
                <h4 className="mb-3 font-bold text-slate-100">Shift snapshot</h4>
                <div className="grid gap-2 sm:grid-cols-3 text-slate-300"><span>Clock in: {new Date(shift.startTime).toLocaleString()}</span><span>Clock out: {shift.endTime ? new Date(shift.endTime).toLocaleString() : '—'}</span><span>Status: {shift.status} / {shift.approvalStatus || rec.status}</span></div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div><h5 className="mb-2 font-semibold text-emerald-300">Actual opening figures</h5><p>Cash in drawer: KES {Number(shift.openingCash || 0).toFixed(2)}</p>{(shift.openingPumpReadings || []).map((reading) => <p key={reading.pumpId}>{reading.pumpName}: {Number(reading.openingMeter).toFixed(3)} L baseline · PTS-2 at clock-in {Number(reading.authoritativeOpeningMeter??reading.openingMeter).toFixed(3)} L · User record {reading.reportedOpeningMeter==null?'—':Number(reading.reportedOpeningMeter).toFixed(3)+' L'} · Unattended {Number(reading.unattendedMeterLiters||0).toFixed(3)} L</p>)}{(shift.openingTankDips || []).map((dip) => <p key={dip.tankId}>{dip.tankName}: {Number(dip.openingDip).toFixed(2)} L</p>)}</div>
                  <div><h5 className="mb-2 font-semibold text-amber-300">Actual closing figures</h5><p>Physical cash count: KES {Number(shift.actualCashCount ?? rec.totalActualCash).toFixed(2)}</p>{(shift.closingPumpReadings || rec.pumpReadings).map((reading) => <p key={reading.pumpId}>{reading.pumpName}: {Number(reading.closingMeter).toFixed(2)} L (dispensed {Number(reading.meterSalesLiters).toFixed(3)} L; unattended sales {Number(reading.unattendedSalesLiters||0).toFixed(3)} L) · User record {reading.reportedClosingMeter==null?'—':Number(reading.reportedClosingMeter).toFixed(3)+' L'} · Observation variance {Number(reading.reportedVarianceLiters||0).toFixed(3)} L</p>)}{(shift.closingTankDips || rec.tankDips).map((dip) => <p key={dip.tankId}>{dip.tankName}: {Number(dip.closingDip).toFixed(2)} L</p>)}</div>
                </div>
                {rec.managerNotes && <p className="mt-3 border-t border-slate-800 pt-3 text-slate-300">Manager review: {rec.managerNotes}</p>}
              </div>}
            </div>
              );
            })()
          ))}
          <PaginationControls
            currentPage={reconciliationPagination.currentPage}
            totalPages={reconciliationPagination.totalPages}
            itemCount={safeReconciliations.length}
            onPageChange={reconciliationPagination.setCurrentPage}
          />
        </div>
      )}
    </div>
  );
};
