import React, { useState } from 'react';
import {
  Fuel,
  Droplets,
  TrendingUp,
  DollarSign,
  Users,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  ShoppingCart,
  Receipt,
  Clock,
  ArrowUpRight,
  ShieldAlert,
  Rss,
  PlusCircle,
} from 'lucide-react';
import {
  FuelTank,
  PumpNozzle,
  ShiftSession,
  Transaction,
  User,
  FuelProduct,
} from '../types';
import type { DashboardSalesSummary } from '../utils/sales-summary';

interface DashboardProps {
  tanks: FuelTank[];
  pumps: PumpNozzle[];
  shifts: ShiftSession[];
  transactions: Transaction[];
  products: FuelProduct[];
  currentUser: User;
  summary: DashboardSalesSummary | null;
  onOpenDipModal: (tank: FuelTank) => void;
  onNavigateTab: (tab: string) => void;
  onOpenReceipt: (tx: Transaction) => void;
  onConfirmAutomationPayment: (transactionId: string, paymentMethod: string, paymentReference?: string) => Promise<Transaction>;
}

export const Dashboard: React.FC<DashboardProps> = ({
  tanks,
  pumps,
  shifts,
  transactions,
  products,
  currentUser,
  summary,
  onOpenDipModal,
  onNavigateTab,
  onOpenReceipt,
  onConfirmAutomationPayment,
}) => {
  // Pagination state for the sales stream
  const [currentPage, setCurrentPage] = useState(1);
  const [settlingTx, setSettlingTx] = useState<Transaction | null>(null);
  const [settlementMethod, setSettlementMethod] = useState('Cash');
  const [settlementReference, setSettlementReference] = useState('');
  const [settlementError, setSettlementError] = useState('');
  const [settlementSaving, setSettlementSaving] = useState(false);
  const pageSize = 10;

  // Metrics calculation
  const safeTransactions = transactions || [];
  const safeShifts = shifts || [];
  const safeTanks = tanks || [];
  const safePumps = pumps || [];

  // Controller captures intentionally remain Payment Pending until settlement,
  // but they must still be visible in the real-time transaction stream.
  const completedTx = safeTransactions.filter((transaction) => transaction.status === 'Completed' || transaction.source === 'AUTOMATION');
  const totalPages = Math.ceil(completedTx.length / pageSize);
  const paginatedTx = completedTx.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const dashboardSummary = summary ?? {
    today: { totalSales: 0, fuelRevenue: 0, shopRevenue: 0, otherRevenue: 0, fuelVolumeLiters: 0, transactionCount: 0 },
    activeShifts: [],
    activeStaff: { count: 0, staffIds: [] },
  };
  const { today, activeShifts: activeShiftPerformance, activeStaff } = dashboardSummary;
  const totalSalesToday = today.totalSales;
  const fuelRevenueToday = today.fuelRevenue;
  const shopRevenueToday = today.shopRevenue;
  const fuelLitersToday = today.fuelVolumeLiters;

  const currentActiveShift = safeShifts
    .filter((shift) => shift.status === 'Active')
    .sort((left, right) => Number(right.staffId===currentUser.id)-Number(left.staffId===currentUser.id)||Date.parse(right.startTime) - Date.parse(left.startTime))[0];
  const activeShiftOpeningByNozzleId = new Map(
    (currentActiveShift?.openingPumpReadings || []).map((reading) => [reading.pumpId, Number(reading.openingMeter)])
  );

  const tankCards = safeTanks.map((tank) => {
    const currentVolume = Number(tank.currentLevelLiters ?? 0);
    const capacity = Number(tank.capacityLiters ?? 0);
    const percentage = capacity > 0 ? (currentVolume / capacity) * 100 : 0;
    const reorderThreshold = Number(tank.reorderLevelLiters ?? 0);
    let status: 'OPTIMAL LEVEL' | 'LOW STOCK' | 'CRITICAL' | 'EMPTY / OUT OF STOCK' = 'OPTIMAL LEVEL';

    if (currentVolume <= 0) status = 'EMPTY / OUT OF STOCK';
    else if (currentVolume <= reorderThreshold) status = 'CRITICAL';
    else if (percentage < 30) status = 'LOW STOCK';

    return {
      ...tank,
      currentVolume,
      capacity,
      percentage,
      reorderThreshold,
      status,
    };
  });

  const pumpCards = safePumps.map((pump) => {
    const currentMeter = Number(pump.currentMeterReading ?? 0);
    const openingMeter = activeShiftOpeningByNozzleId.get(pump.id) ?? currentMeter;
    const nozzleTransactions = currentActiveShift ? safeTransactions.filter(transaction =>
      (String((transaction as any).nozzleId || '') === pump.id || (transaction.items||[]).some(item=>String(item.nozzleId||item.pumpId||'')===pump.id))
      && (transaction.shiftId === currentActiveShift.id || transaction.meterReconciliationShiftId === currentActiveShift.id)
      && transaction.status !== 'Voided'
      && (transaction.status === 'Completed' || transaction.source === 'AUTOMATION')
    ) : [];
    const capturedLiters = nozzleTransactions.reduce((sum, transaction) => {
      const itemLiters=(transaction.items || []).filter(item => String(item.type || '').toUpperCase() === 'FUEL'&&String(item.nozzleId||(transaction as any).nozzleId||item.pumpId||'')===pump.id).reduce((value,item)=>value+(Number(item.qty)||0),0);
      return sum + (itemLiters || Number((transaction as any).quantity || 0));
    },0);
    const capturedAmount = nozzleTransactions.reduce((sum,transaction)=>{
      const items=(transaction.items||[]).filter(item=>String(item.type||'').toUpperCase()==='FUEL'&&String(item.nozzleId||(transaction as any).nozzleId||item.pumpId||'')===pump.id);
      return sum+(items.length?items.reduce((value,item)=>value+Number(item.totalPrice??Number(item.qty)*Number(item.unitPrice)),0):Number(transaction.totalAmount||0));
    },0);

    return {
      ...pump,
      openingMeter,
      currentMeter,
      capturedLiters,
      capturedAmount,
      unattendedMeterLiters:Number(currentActiveShift?.openingPumpReadings?.find(reading=>reading.pumpId===pump.id)?.unattendedMeterLiters||0),
    };
  });

  const getDocumentKind = (tx: Pick<Transaction, 'documentType' | 'taxInvoiceNo' | 'receiptNo'>) => {
    if (tx.documentType === 'Invoice') return 'Invoice';
    if (tx.documentType === 'Receipt') return 'Receipt';
    if (tx.taxInvoiceNo) return 'Invoice';
    if (tx.receiptNo) return 'Receipt';
    return 'Receipt';
  };

  // Handle page changes
  const goToPreviousPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const confirmSettlement = async () => {
    if (!settlingTx || settlementSaving) return;
    setSettlementSaving(true);
    setSettlementError('');
    try {
      const settled = await onConfirmAutomationPayment(settlingTx.id, settlementMethod, settlementReference.trim() || undefined);
      setSettlingTx(null);
      setSettlementReference('');
      onOpenReceipt(settled);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : 'Payment confirmation failed.');
    } finally {
      setSettlementSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-28 h-28 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Real-Time Sales
            </span>
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-100 font-mono">
              KES {totalSalesToday.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
            </div>
            <div className="flex items-center gap-1 mt-1 text-xs text-emerald-400 font-medium">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{today.transactionCount} Completed Transactions</span>
            </div>
          </div>
        </div>

        {/* Fuel Liters Sold */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Fuel Volume Dispensed
            </span>
            <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
              <Fuel className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-100 font-mono">
              {fuelLitersToday.toLocaleString('en-KE', { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-slate-400">Liters</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Fuel Revenue: <span className="text-slate-200 font-semibold font-mono">KES {fuelRevenueToday.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Shop Revenue */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Convenience Shop Sales
            </span>
            <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
              <ShoppingCart className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-100 font-mono">
              KES {shopRevenueToday.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Lubricants & Convenience Store
            </div>
          </div>
        </div>

        {/* Active Staff */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Active On-Shift Staff
            </span>
            <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-100 font-mono">
              {activeStaff.count} <span className="text-sm font-normal text-slate-400">Clocked In</span>
            </div>
            <button
              onClick={() => onNavigateTab('shifts')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1 mt-1 transition-colors"
            >
              <span>Manage Shifts & Clock In</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Fuel Tank Level Indicators Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Droplets className="w-5 h-5 text-emerald-400" />
              Live Underground Fuel Tank Inventory & Dip Readings
            </h2>
            <p className="text-xs text-slate-400">
              Real-time tank volume tracking, reorder thresholds, and manual dip logs.
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('pumps')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all border border-slate-700 flex items-center gap-2 self-start sm:self-auto"
          >
            <Gauge className="w-4 h-4 text-emerald-400" />
            View Full Tank & Pump Center
          </button>
        </div>

        {/* Tank Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {tankCards.map((tank) => {
            const pct = Math.round(tank.percentage);
            const isReorder = tank.currentVolume <= tank.reorderThreshold;
            const isLow = pct < 30;

            let statusBg = 'bg-emerald-500';
            let statusBadge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            let statusText = 'Optimal Level';

            if (tank.currentVolume <= 0) {
              statusBg = 'bg-rose-500';
              statusBadge = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
              statusText = 'EMPTY / OUT OF STOCK';
            } else if (isReorder) {
              statusBg = 'bg-rose-500';
              statusBadge = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
              statusText = 'CRITICAL';
            } else if (isLow) {
              statusBg = 'bg-amber-500';
              statusBadge = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
              statusText = 'LOW STOCK';
            }

            return (
              <div
                key={tank.id}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-5 space-y-4 relative overflow-hidden"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-100 text-sm">{tank.tankName}</h3>
                    <p className="text-xs text-slate-400">{tank.fuelName}</p>
                  </div>
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${statusBadge}`}>
                    {statusText}
                  </span>
                </div>

                {/* Level Gauge Visual */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-400">Storage Volume:</span>
                    <span className="font-bold text-slate-100">
                      {tank.currentVolume.toLocaleString()} / {tank.capacity.toLocaleString()} L
                    </span>
                  </div>

                  <div className="h-4 bg-slate-900 rounded-full border border-slate-800 p-0.5 overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${statusBg}`}
                      style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-200 font-mono drop-shadow">
                      {pct}% Capacity
                    </div>
                  </div>
                </div>

                {/* Dip Info & Action */}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/60">
                  <div className="text-slate-400 text-[11px]">
                    Last Dip: <span className="text-slate-200 font-mono font-semibold">{Number(tank.lastDipReading ?? 0).toLocaleString()} L</span>
                  </div>
                  <button
                    onClick={() => onOpenDipModal(tank)}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 text-xs font-medium rounded-lg transition-colors border border-slate-700/60"
                  >
                    Enter Dip Reading
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Middle Grid: Active Pumps & Active Staff */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pump Nozzles Meters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-emerald-400" />
              <h3 className="font-bold text-slate-100 text-base">Active Fuel Nozzle Totalizer Readings</h3>
            </div>
            <button
              onClick={() => onNavigateTab('pumps')}
              className="text-xs text-emerald-400 hover:underline font-medium"
            >
              View All Pumps
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pumpCards.map((pump) => {
              const dispensedLiters = pump.currentMeter - pump.openingMeter;
              return (
                <div
                  key={pump.id}
                  className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 text-xs">{pump.pumpName} / {pump.nozzleName || `Nozzle ${pump.nozzleNumber || 1}`}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                      {pump.status || 'Active'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{pump.fuelName}</div>

                  <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800/80 font-mono text-xs space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Opening Nozzle Reading:</span>
                      <span>{pump.openingMeter.toFixed(3)} L</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-100 text-sm">
                      <span>Current Nozzle Reading:</span>
                      <span className="text-emerald-400">{pump.currentMeter.toFixed(3)} L</span>
                    </div>
                    <div className="flex justify-between gap-3 text-[11px] text-amber-400 pt-1 border-t border-slate-800">
                      <span>Shift Volume · {pump.fuelName}:</span>
                      <span className="text-right">{dispensedLiters>=0?'+':''}{dispensedLiters.toFixed(3)} L</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400"><span>Before clock-in (unattended):</span><span>{pump.unattendedMeterLiters.toFixed(3)} L</span></div>
                    <div className="flex justify-between gap-3 text-[11px] text-slate-400">
                      <span>Recorded Sales (incl. unattended):</span>
                      <span className="text-right">{pump.capturedLiters.toFixed(3)} L · KES {pump.capturedAmount.toLocaleString('en-KE',{minimumFractionDigits:2})}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Current Active Staff & Shifts */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-purple-400" />
              <h3 className="font-bold text-slate-100 text-base">Active Shift Roster & Staff Performance</h3>
            </div>
            <button
              onClick={() => onNavigateTab('shifts')}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-all flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Clock In Staff
            </button>
          </div>

          {activeShiftPerformance.length === 0 ? (
            <div className="text-center py-8 text-slate-400 space-y-2">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
              <p className="text-sm font-medium">No active staff currently clocked into a shift.</p>
              <p className="text-xs text-slate-500">Clock in fuel/shop attendants to start recording sales.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeShiftPerformance.map((shift) => {
                const isCurrentUserRow = currentUser?.id === shift.staffId;

                return (
                <div
                  key={shift.shiftId}
                  className={`bg-slate-950 p-4 rounded-xl border flex items-center justify-between gap-4 ${
                    isCurrentUserRow ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-bold text-sm ${
                      isCurrentUserRow
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                    }`}>
                      {shift.staffName.charAt(0) || 'S'}
                    </div>
                    <div>
                      <div className="font-bold text-slate-200 text-sm flex items-center gap-2">
                        {shift.staffName}
                        <span className="text-[10px] px-2 py-0.2 bg-purple-500/20 text-purple-300 rounded font-normal">
                          {shift.staffRole || 'Active shift'}
                        </span>
                        {isCurrentUserRow && (
                          <span className="text-[10px] px-2 py-0.2 bg-emerald-500/20 text-emerald-300 rounded font-normal">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-3 mt-0.5">
                        <span>Shift: {shift.shiftType}</span>
                        <span>Started: {new Date(shift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{shift.transactionCount} sales</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-xs text-slate-400">Recorded Sales</div>
                    <div className="text-sm font-bold text-emerald-400">
                      KES {shift.recordedSales.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Fuel {shift.totalFuelSales.toLocaleString('en-KE', { minimumFractionDigits: 2 })} | Shop {shift.totalShopSales.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-amber-300">
                      Dispensed {(shift.dispensedLiters || 0).toFixed(3)} L · KES {(shift.dispensedAmount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions Feed with Pagination */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-slate-100 text-base">Real-Time Sales Stream</h3>
          </div>
          <button
            onClick={() => onNavigateTab('pos')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-1.5"
          >
            <ShoppingCart className="w-4 h-4" />
            Launch POS Terminal
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="fms-table min-w-[720px] text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Receipt / Invoice No</th>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Attendant</th>
                <th className="py-3 px-4">Customer / Plate</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4 text-right">Amount (KES)</th>
                <th className="py-3 px-4 text-center">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {paginatedTx.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 italic">
                    No completed or pending automation transactions found.
                  </td>
                </tr>
              ) : (
                paginatedTx.map((tx) => {
                  const documentKind = getDocumentKind(tx);
                  const documentNumber = tx.source === 'AUTOMATION' && tx.status === 'Payment Pending'
                    ? 'Automation Pending'
                    : documentKind === 'Invoice'
                    ? (tx.taxInvoiceNo || tx.receiptNo || 'Inv000')
                    : (tx.receiptNo || tx.taxInvoiceNo || 'Rcpt000');

                  return (
                    <tr key={tx.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-200">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              documentKind === 'Invoice'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                            }`}
                          >
                            {documentKind}
                          </span>
                          <span>{documentNumber}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            tx.type === 'Fuel'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : tx.type === 'Shop'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {tx.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{tx.dispensedWithoutShift?<><span className="text-amber-400">Unattended dispensing</span>{tx.settlementShiftId&&<div className="text-[10px]">Payment: {tx.staffName}</div>}</>:tx.staffName}</td>
                      <td className="py-3 px-4 text-slate-300">
                        <div>{tx.customerName || 'Walk-in'}</div>
                        {tx.vehiclePlate && (
                          <div className="text-[10px] font-bold text-emerald-400">{tx.vehiclePlate}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-sans">
                        <span className="px-2 py-0.5 bg-slate-800 rounded text-[11px]">
                          {tx.paymentMethod}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-100 text-sm">
                        KES {tx.totalAmount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {tx.status === 'Payment Pending' ? (
                          <button onClick={() => { setSettlingTx(tx); setSettlementMethod('Cash'); setSettlementReference(''); setSettlementError(''); }} className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25">Confirm Payment</button>
                        ) : (
                          <button
                            onClick={() => onOpenReceipt(tx)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg transition-colors text-[11px] font-sans font-medium"
                          >
                            View {documentKind}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-2">
            <div className="text-xs text-slate-400">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, completedTx.length)} of {completedTx.length} transactions
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={goToPreviousPage}
                disabled={currentPage === 1}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700"
              >
                Previous
              </button>
              <span className="text-xs text-slate-400 px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      {settlingTx && (
        <div className="fms-dialog-overlay z-50">
          <div className="fms-dialog w-full max-w-md p-6">
            <h2 className="text-lg font-black">Confirm Automated Payment</h2>
            <p className="mt-1 text-xs text-slate-400">{settlingTx.items?.[0]?.name || 'Fuel'} · {settlingTx.items?.[0]?.qty || 0} L · KES {settlingTx.totalAmount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</p>
            {settlementError && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{settlementError}</p>}
            <label className="mt-4 block text-xs font-bold text-slate-300">Payment method<select className="fms-input mt-1" value={settlementMethod} onChange={(event) => setSettlementMethod(event.target.value)}><option>Cash</option><option>M-Pesa</option><option>Card</option><option>Bank Transfer</option></select></label>
            {settlementMethod !== 'Cash' && <label className="mt-3 block text-xs font-bold text-slate-300">Payment reference<input className="fms-input mt-1" value={settlementReference} onChange={(event) => setSettlementReference(event.target.value)} placeholder="Required" /></label>}
            <p className="mt-4 text-xs text-slate-400">Confirmation issues the next receipt number once, records the inflow, and assigns the sale to your active shift.</p>
            <div className="mt-5 flex justify-end gap-2"><button className="fms-btn fms-btn-secondary" disabled={settlementSaving} onClick={() => setSettlingTx(null)}>Cancel</button><button className="fms-btn fms-btn-primary" disabled={settlementSaving || (settlementMethod !== 'Cash' && !settlementReference.trim())} onClick={() => void confirmSettlement()}>{settlementSaving ? 'Confirming…' : 'Confirm & Issue Receipt'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
