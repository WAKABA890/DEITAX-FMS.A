import React, { useState } from 'react';
import {
  Clock,
  UserCheck,
  Scale,
  DollarSign,
  Gauge,
  Droplets,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ChevronRight,
  ChevronLeft,
  X,
  FileCheck,
  KeyRound,
  PlusCircle,
  Calendar,
  User,
  Trash2,
  Check,
  Printer,
} from 'lucide-react';
import {
  ShiftSession,
  ShiftSchedule,
  ShiftPlan,
  User as UserType,
  PumpNozzle,
  FuelTank,
  ThreeWayReconciliation,
} from '../types';
import { usePermissions } from '../hooks/usePermissions';
import { PaginationControls, usePagination } from './PaginationControls';

interface ShiftManagementProps {
  shifts: ShiftSession[];
  schedules: ShiftSchedule[];
  shiftPlans: ShiftPlan[];
  users: UserType[];
  pumps: PumpNozzle[];
  tanks: FuelTank[];
  reconciliations?: ThreeWayReconciliation[];
  currentUser: UserType;
  onReprintReconciliation?: (reconciliation: ThreeWayReconciliation) => void;
  onClockInSubmit: (
    userId: string,
    pin: string,
    shiftType: string,
    openingCash: number,
    openingPumpReadings?: any[],
    openingTankDips?: any[],
    shiftPlanId?: string
  ) => Promise<ShiftSession>;
  onSubmitReconciliation: (data: any) => Promise<{ reconciliation: ThreeWayReconciliation; shift: ShiftSession }>;
  onAssignSchedule?: (data: any) => Promise<any>;
  onDeleteSchedule?: (shiftPlanId: string, userId: string) => Promise<any>;
  onCreateShiftPlan?: (data: { name: string; shiftType: string; scheduledStart?: string; scheduledEnd?: string; userIds: string[]; scheduleType?: 'one-time' | 'recurring'; recurrenceStartDate?: string; recurrenceEndDate?: string; recurrenceWeekdays?: number[]; startTime?: string; endTime?: string }) => Promise<any>;
  onAssignShiftPlanUser?: (shiftPlanId: string, userId: string) => Promise<any>;
  onRemoveShiftPlanUser?: (shiftPlanId: string, userId: string) => Promise<any>;
  onDeleteShiftPlan?: (shiftPlanId: string) => Promise<any>;
}

type ModalState = {
  type: 'alert' | 'confirm';
  message: string;
  onConfirm?: () => void;
} | null;

// ========== FMS Dialog Shell (Reusable) ==========
const FMSDialog = ({
  title,
  subtitle,
  icon,
  children,
  onClose,
  maxWidth = 'max-w-xl',
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
    <div
      className={`relative w-full ${maxWidth} max-h-[92vh] overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/50`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[calc(92vh-73px)] overflow-y-auto p-5">{children}</div>
    </div>
  </div>
);

export const ShiftManagement: React.FC<ShiftManagementProps> = ({
  shifts = [],
  schedules = [],
  shiftPlans = [],
  users = [],
  pumps = [],
  tanks = [],
  reconciliations = [],
  currentUser,
  onReprintReconciliation,
  onClockInSubmit,
  onSubmitReconciliation,
  onAssignSchedule,
  onDeleteSchedule,
  onCreateShiftPlan,
  onAssignShiftPlanUser,
  onRemoveShiftPlanUser,
  onDeleteShiftPlan,
}) => {
  const { hasPermission } = usePermissions(currentUser);
  const canManageShifts = hasPermission('CREATE_SHIFT') || hasPermission('ASSIGN_SHIFT_USERS') || hasPermission('REMOVE_SHIFT_USERS');

  const safeUsers = Array.isArray(users) ? users : [];
  const safePumps = Array.isArray(pumps) ? pumps : [];
  const safeTanks = Array.isArray(tanks) ? tanks : [];
  const safeShifts = Array.isArray(shifts) ? shifts : [];
  const [activeTab, setActiveTab] = useState<'shifts' | 'roster' | 'schedules'>('shifts');
  const [rosterPeriod, setRosterPeriod] = useState<'upcoming' | 'ongoing' | 'completed'>('upcoming');
  const [selectedRosterStatus, setSelectedRosterStatus] = useState<ShiftSchedule['status']>('Upcoming');
  const [selectedRoster, setSelectedRoster] = useState<ShiftPlan | null>(null);
  const [rosterUserId, setRosterUserId] = useState('');

  // Custom modal state for alert/confirm
  const [modal, setModal] = useState<ModalState>(null);
  const showAlert = (message: string) => setModal({ type: 'alert', message });
  const showConfirm = (message: string, onConfirm: () => void) => setModal({ type: 'confirm', message, onConfirm });

  // Clock In Wizard Modal State
  const [showClockInModal, setShowClockInModal] = useState<boolean>(false);
  const [clockInStep, setClockInStep] = useState<number>(1);
  const [clockInUser, setClockInUser] = useState<UserType>(currentUser);
  const [clockInPin, setClockInPin] = useState<string>('');
  const [clockInShiftPlanId, setClockInShiftPlanId] = useState<string>('');
  const [clockInFloat, setClockInFloat] = useState<number>(0);
  const [clockInError, setClockInError] = useState<string | null>(null);

  // Mandatory Opening Readings
  const [openingPumpMetersInput, setOpeningPumpMetersInput] = useState<Record<string, number>>({});
  const [openingTankDipsInput, setOpeningTankDipsInput] = useState<Record<string, number>>({});

  // Clock Out Guided Reconciliation Wizard State
  const [selectedShiftToReconcile, setSelectedShiftToReconcile] = useState<ShiftSession | null>(null);
  const [wizardStep, setWizardStep] = useState<number>(1);

  // Cash Count Denominations
  const [notes1000, setNotes1000] = useState<number>(0);
  const [notes500, setNotes500] = useState<number>(0);
  const [notes200, setNotes200] = useState<number>(0);
  const [notes100, setNotes100] = useState<number>(0);
  const [notes50, setNotes50] = useState<number>(0);
  const [coins, setCoins] = useState<number>(0);
  const [mpesaDirect, setMpesaDirect] = useState<number>(0);
  const [cardDirect, setCardDirect] = useState<number>(0);
  const [creditDirect, setCreditDirect] = useState<number>(0);

  // Closing Meters & Dips
  const [pumpClosingMeters, setPumpClosingMeters] = useState<Record<string, number>>({});
  const [tankClosingDips, setTankClosingDips] = useState<Record<string, number>>({});

  // Assign Schedule Modal State
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [assignStaffIds, setAssignStaffIds] = useState<string[]>([(users || [])[0]?.id || '']);
  const [assignShiftType, setAssignShiftType] = useState<string>('Morning');
  const [assignDate, setAssignDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [assignStartTime, setAssignStartTime] = useState<string>('06:00');
  const [assignEndTime, setAssignEndTime] = useState<string>('14:00');
  const [assignScheduleType, setAssignScheduleType] = useState<'one-time' | 'recurring'>('one-time');
  const [assignEndDate, setAssignEndDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [assignWeekdays, setAssignWeekdays] = useState<number[]>([]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const toSafeNumber = (value: number | string | null | undefined) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const safeTimeLabel = (value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const scheduledTimeRangeLabel = (start?: string | null, end?: string | null) => {
    const formatTime = (value?: string | null) => {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return '—';
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    };
    return `${formatTime(start)} - ${formatTime(end)}`;
  };
  const formatShiftDuration = (start: string, end: string) => {
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return '—';
    const minutes = Math.max(0, Math.round((endTime - startTime) / 60000));
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  };

  // Init Opening Readings for Clock-In Modal
  const openClockInWizard = () => {
    const fallbackUser = currentUser ?? safeUsers[0];
    if (!fallbackUser) {
      showAlert('No staff user is available to clock in.');
      return;
    }

    setClockInUser(fallbackUser);
    setClockInPin('');
    setClockInShiftPlanId('');
    setClockInStep(1);
    setClockInError(null);

    setOpeningPumpMetersInput({});

    const initialTanks: Record<string, number> = {};
    safeTanks.forEach((t) => {
      initialTanks[t.id] = toSafeNumber(t?.currentLevelLiters);
    });
    setOpeningTankDipsInput(initialTanks);

    setShowClockInModal(true);
  };

  const canManageShiftForUser = (targetStaffId?: string) => {
    if (!targetStaffId) return false;
    if (currentUser?.id === targetStaffId) return true;
    return canManageShifts;
  };

  const hasRosterPermission = (permission: string) => canManageShifts || currentUser.permissions?.includes(permission as any);

  // Clock-in Submission Handler
  const handleClockInSubmit = async () => {
    if (!clockInUser || !clockInPin) {
      setClockInError('Please select user and enter PIN');
      return;
    }

    const allowedUserId = currentUser?.id ?? clockInUser.id;
    if (clockInUser.id !== allowedUserId) {
      setClockInError('Clock-in is restricted to the logged-in user only.');
      return;
    }

    setIsSubmitting(true);
    try {
      setClockInError(null);

      const openingPumpPayload = safePumps.map((p) => ({
        pumpId: p.id,
        pumpName: p.pumpName,
        fuelName: p.fuelName,
        openingMeter: openingPumpMetersInput[p.id],
      }));

      const openingTankPayload = safeTanks.map((t) => ({
        tankId: t.id,
        tankName: t.tankName,
        fuelName: t.fuelName,
        openingDip: toSafeNumber(openingTankDipsInput[t.id] ?? t.currentLevelLiters),
      }));

      await onClockInSubmit(
        clockInUser.id,
        clockInPin,
        shiftPlans.find((plan) => plan.id === clockInShiftPlanId)?.shiftType || 'Morning',
        clockInFloat,
        openingPumpPayload,
        openingTankPayload,
        clockInShiftPlanId
      );

      setShowClockInModal(false);
      setClockInPin('');
    } catch (err: any) {
      setClockInError(err.message || 'Clock in failed. Check PIN.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Launch Clock-Out Reconciliation Wizard
  const startClockOutWizard = (shift: ShiftSession) => {
    if (!canManageShiftForUser(shift?.staffId)) {
      showAlert('Only the logged-in staff member can clock out their own shift. Admins can close other staff shifts.');
      return;
    }

    setSelectedShiftToReconcile(shift);
    setWizardStep(1);

    // Actual figures always start empty.  Do not leak expected collections or
    // populate physical-count fields from system figures.
    setNotes1000(0);
    setNotes500(0);
    setNotes200(0);
    setNotes100(0);
    setNotes50(0);
    setCoins(0);
    setMpesaDirect(0);
    setCardDirect(0);
    setCreditDirect(0);

    setPumpClosingMeters({});

    const tankMap: Record<string, number> = {};
    safeTanks.forEach((t) => {
      tankMap[t.id] = toSafeNumber(t?.currentLevelLiters);
    });
    setTankClosingDips(tankMap);
  };

  const actualCashCountTotal =
    notes1000 * 1000 +
    notes500 * 500 +
    notes200 * 200 +
    notes100 * 100 +
    notes50 * 50 +
    coins +
    mpesaDirect +
    cardDirect +
    creditDirect;


  const handleFinalReconciliationSubmit = async () => {
    if (!selectedShiftToReconcile) return;
    setIsSubmitting(true);

    try {
      const pumpReadingsPayload = safePumps.map((p) => {
        const closing = pumpClosingMeters[p.id];
        const opening = toSafeNumber(
          selectedShiftToReconcile.openingPumpReadings?.find((op) => op.pumpId === p.id)?.openingMeter ?? p.openingMeterReading
        );
        return {
          pumpId: p.id,
          pumpName: p.pumpName,
          fuelName: p.fuelName,
          openingMeter: opening,
          closingMeter: closing,
        };
      });

      const tankDipsPayload = safeTanks.map((t) => {
        const closingDip = toSafeNumber(tankClosingDips[t.id] ?? t.currentLevelLiters);
        const openingDip = toSafeNumber(
          selectedShiftToReconcile.openingTankDips?.find((ot) => ot.tankId === t.id)?.openingDip ?? t.lastDipReading
        );
        return {
          tankId: t.id,
          tankName: t.tankName,
          fuelName: t.fuelName,
          openingDip: openingDip,
          closingDip,
          actualSales: Math.max(0, openingDip - closingDip),
        };
      });

      const payload = {
        shiftId: selectedShiftToReconcile.id,
        staffId: selectedShiftToReconcile.staffId,
        staffName: selectedShiftToReconcile.staffName,
        cashCount: {
          notes1000,
          notes500,
          notes200,
          notes100,
          notes50,
          coins,
          mpesaDirect,
          cardDirect,
          creditDirect,
        },
        pumpReadings: pumpReadingsPayload,
        tankDips: tankDipsPayload,
      };

      await onSubmitReconciliation(payload);
      setSelectedShiftToReconcile(null);
    } catch (err: any) {
      showAlert(err.message || 'Failed to submit reconciliation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignStaffIds || assignStaffIds.length === 0) {
      showAlert('Please select at least one staff member to assign.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (onCreateShiftPlan) {
        await onCreateShiftPlan({
          name: `${assignShiftType} Shift`,
          shiftType: assignShiftType,
          scheduledStart: assignScheduleType === 'one-time' ? new Date(`${assignDate}T${assignStartTime}`).toISOString() : undefined,
          scheduledEnd: assignScheduleType === 'one-time' ? new Date(`${assignDate}T${assignEndTime}`).toISOString() : undefined,
          userIds: assignStaffIds.filter(Boolean),
          scheduleType: assignScheduleType,
          recurrenceStartDate: assignScheduleType === 'recurring' ? assignDate : undefined,
          recurrenceEndDate: assignScheduleType === 'recurring' ? assignEndDate : undefined,
          recurrenceWeekdays: assignScheduleType === 'recurring' ? assignWeekdays : undefined,
          startTime: assignScheduleType === 'recurring' ? assignStartTime : undefined,
          endTime: assignScheduleType === 'recurring' ? assignEndTime : undefined,
        });
      }
      setShowAssignModal(false);
    } catch (err: any) {
      showAlert(err.message || 'Failed to assign shift schedule.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSchedule = async (schedule: ShiftSchedule) => {
    showConfirm('Are you sure you want to remove this shift assignment?', async () => {
      try {
        if (onDeleteSchedule) {
          if (!schedule.shiftPlanId) {
            throw new Error('This schedule is missing its roster shift reference. Refresh and try again.');
          }
          await onDeleteSchedule(schedule.shiftPlanId, schedule.staffId);
        }
      } catch (err: any) {
        showAlert(err.message || 'Failed to delete schedule.');
      }
    });
  };

  const handleDeleteShiftPlan = async (shiftPlanId: string) => {
    if (!onDeleteShiftPlan) return;
    showConfirm('Are you sure you want to delete this shift roster? This action cannot be undone.', async () => {
      try {
        await onDeleteShiftPlan(shiftPlanId);
      } catch (err: any) {
        showAlert(err.message || 'Failed to delete shift roster.');
      }
    });
  };

  const activeShiftsList = safeShifts.filter((s) => s?.status === 'Active');
  const pastShiftsList = safeShifts.filter((s) => s?.status !== 'Active').sort((a,b) => {
    const bTime=Date.parse(b.endTime||b.startTime||'')||0;const aTime=Date.parse(a.endTime||a.startTime||'')||0;
    return bTime-aTime || String(b.id).localeCompare(String(a.id));
  });
  const historyPagination = usePagination(pastShiftsList, pastShiftsList.map((shift) => `${shift.id}:${shift.status}:${shift.endTime}`).join('|'));
  const rosterStatuses = ['Upcoming', 'Due', 'In Progress', 'Completed', 'Stale', 'Cancelled'];
  const rosterStatusCounts = Object.fromEntries(rosterStatuses.map((status) => [status, schedules.filter((schedule) => schedule.status === status).length]));
  const currentRosterSchedules = schedules
    .filter((schedule) => schedule.status === selectedRosterStatus)
    .sort((left, right) => {
      const leftStart = Date.parse(left.startTime);
      const rightStart = Date.parse(right.startTime);
      const leftDistance = Number.isFinite(leftStart) ? Math.abs(leftStart - Date.now()) : Number.POSITIVE_INFINITY;
      const rightDistance = Number.isFinite(rightStart) ? Math.abs(rightStart - Date.now()) : Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance || rightStart - leftStart || left.id.localeCompare(right.id);
    });
  const scheduleStatusPagination = usePagination(
    currentRosterSchedules,
    `${selectedRosterStatus}:${currentRosterSchedules.map((schedule) => `${schedule.id}:${schedule.startTime}:${schedule.status}`).join('|')}`
  );
  const rosterStatusBadgeClass = (status: ShiftSchedule['status']) => {
    if (status === 'Due') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    if (status === 'In Progress') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    if (status === 'Completed') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
    if (status === 'Stale') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    if (status === 'Cancelled') return 'border-slate-600 bg-slate-800 text-slate-400';
    return 'border-slate-700 bg-slate-800 text-slate-300';
  };
  const rosterNow = Date.now();
  const rosterPlans = shiftPlans.filter((plan) => {
    const start = Date.parse(plan.scheduledStart);
    const end = Date.parse(plan.scheduledEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    if (rosterPeriod === 'upcoming') return start > rosterNow;
    if (rosterPeriod === 'ongoing') return start <= rosterNow && rosterNow < end;
    return end <= rosterNow;
  });
  const rosterPagination = usePagination(rosterPlans, `${rosterPeriod}:${rosterPlans.map((plan) => plan.id).join('|')}`);

  return (
    <div className="space-y-6 pb-12">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Clock className="w-4 h-4" />
            <span>Pump Attendant & Cashier Shift Control</span>
          </div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Shift Clock-In, Meter Audit & 3-Way Reconciliation
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Clock-out is manual and must be completed by the staff member when the shift ends. Restarting the app does not close an active shift.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={openClockInWizard}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-lg shadow-emerald-500/20"
          >
            <UserCheck className="w-4 h-4" />
            <span>Clock-In / Open Shift</span>
          </button>

          {canManageShifts && (
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium px-4 py-2.5 rounded-xl text-xs"
            >
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>Assign Shift to Staff</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 gap-4 text-xs font-bold">
        <button
          onClick={() => setActiveTab('shifts')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'shifts' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Active & Reconciled Shifts ({shifts.length})
        </button>
        <button
          onClick={() => setActiveTab('roster')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'roster' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Shift Rosters ({shiftPlans.length})
        </button>
        <button
          onClick={() => setActiveTab('schedules')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'schedules' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Assigned Shift Rosters ({schedules.length})
        </button>
      </div>

      {activeTab === 'shifts' ? (
        <div className="space-y-6">
          {/* Active Shifts */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>Currently Active Shifts ({activeShiftsList.length})</span>
              </span>
              <span className="text-xs text-amber-400 font-mono">Real-time Station Operations</span>
            </h3>

            {activeShiftsList.length === 0 ? (
              <div className="text-center p-8 bg-slate-950/60 rounded-xl border border-slate-800 text-slate-500 text-xs">
                No active staff currently clocked in. Click "Clock-In / Open Shift" to start a shift session. Active shifts remain open until the user manually clocks out at the end of the shift.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeShiftsList.map((shift) => (
                  <div
                    key={shift.id}
                    className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 relative overflow-hidden"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                          {shift.shiftType} Shift
                        </span>
                        <h4 className="font-bold text-white text-sm mt-1.5">{shift.staffName}</h4>
                        <p className="text-[11px] text-slate-400 capitalize">{shift.staffRole}</p>
                      </div>

                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                    </div>

                    <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800/80 text-[11px] space-y-1 font-mono">
                      <div className="flex justify-between text-slate-400">
                        <span>Opening Float:</span>
                        <span className="text-white font-bold">KES {toSafeNumber(shift.openingCash).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Fuel Sales Recorded:</span>
                        <span className="text-emerald-400">KES {toSafeNumber(shift.totalFuelSales).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Shop Sales Recorded:</span>
                        <span className="text-blue-400">KES {toSafeNumber(shift.totalShopSales).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-300 font-bold border-t border-slate-800 pt-1">
                        <span>Expected Drawer Cash:</span>
                        <span className="text-emerald-300">KES {toSafeNumber(shift.totalExpectedCash).toFixed(2)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => startClockOutWizard(shift)}
                      disabled={!canManageShiftForUser(shift?.staffId)}
                      className={`w-full py-2 rounded-xl text-xs shadow-md flex items-center justify-center gap-1.5 font-bold ${
                        canManageShiftForUser(shift?.staffId)
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/20'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                      }`}
                    >
                      <Scale className="w-4 h-4" />
                      <span>Clock Out & Reconcile 3-Way Match</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Past Shift History */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-white">Shift Audit & Reconciliation History</h3>

            <div className="overflow-x-auto">
              <table className="fms-table min-w-[760px] text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3">Staff Member</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Shift</th>
                    <th className="p-3">Clock-In / Out Time</th>
                    <th className="p-3 text-right">Expected Drawer</th>
                    <th className="p-3 text-right">Actual Count</th>
                    <th className="p-3 text-right">Cash Variance</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-right">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {historyPagination.pageItems.map((s) => {
                    const reconciliation = reconciliations.find((record) => record.shiftId === s.id);
                    return <tr key={s.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-bold text-white">
                        <div>{s.staffName}</div>
                        <div className="text-[10px] text-slate-400">{s.staffRole}</div>
                      </td>
                      <td className="p-3 whitespace-nowrap text-slate-300">{Number.isFinite(Date.parse(s.endTime||s.startTime||'')) ? new Date(s.endTime||s.startTime).toLocaleDateString('en-KE',{year:'numeric',month:'short',day:'2-digit'}) : '—'}</td>
                      <td className="p-3 font-mono">{s.shiftType}</td>
                      <td className="p-3 text-slate-400 text-[11px]">
                        <div>In: {safeTimeLabel(s.startTime)}</div>
                        {s.endTime && <div>Out: {safeTimeLabel(s.endTime)}</div>}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-300">KES {toSafeNumber(s.totalExpectedCash).toFixed(2)}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-400">
                        KES {toSafeNumber(s.actualCashCount).toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        <span className={toSafeNumber(s.cashVariance) < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                          KES {toSafeNumber(s.cashVariance).toFixed(2)}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            s.status === 'Completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {reconciliation ? (
                          <button type="button" onClick={() => onReprintReconciliation?.(reconciliation)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-200 hover:bg-slate-700" title="Preview and reprint shift reconciliation">
                            <Printer className="h-3.5 w-3.5 text-emerald-400" />
                            Reprint Report
                          </button>
                        ) : <span className="text-[10px] text-slate-500">No report</span>}
                      </td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
            <PaginationControls currentPage={historyPagination.currentPage} totalPages={historyPagination.totalPages} itemCount={pastShiftsList.length} onPageChange={historyPagination.setCurrentPage} />
          </div>
        </div>
      ) : activeTab === 'roster' ? (
        <div className="space-y-4">
          <div className="flex gap-2 border-b border-slate-800 pb-3 text-xs">
            {([['upcoming', 'Upcoming'], ['ongoing', 'Ongoing'], ['completed', 'Completed / Past']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setRosterPeriod(value)} className={`rounded-lg px-3 py-1.5 font-semibold ${rosterPeriod === value ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{label}</button>)}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl overflow-x-auto">
            <table className="fms-table min-w-[760px] text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">Shift</th>
                  <th className="p-3">Shift Date</th>
                  <th className="p-3 text-center">Users</th>
                  <th className="p-3 text-center">In</th>
                  <th className="p-3 text-center">Out</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rosterPagination.pageItems.map((plan) => {
                  const assigned = plan.assignments.filter((assignment) => assignment.status !== 'Removed From Assignment');
                  const clockedOut = assigned.filter((assignment) => Boolean(assignment.clockOutTime));
                  const clockedIn = assigned.filter((assignment) => Boolean(assignment.clockInTime) && !assignment.clockOutTime);
                  const notClockedIn = assigned.filter((assignment) => !assignment.clockInTime).length;
                  const shiftDate = plan.scheduledStart
                    ? new Date(plan.scheduledStart).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' })
                    : '—';
                  return (
                    <tr key={plan.id} className="hover:bg-slate-800/40">
                      <td className="p-3">
                        <div className="font-bold text-white">{plan.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {scheduledTimeRangeLabel(plan.scheduledStart, plan.scheduledEnd)}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-slate-300">{shiftDate}</td>
                      <td className="p-3 text-center font-mono">{assigned.length}</td>
                      <td className="p-3 text-center font-mono text-emerald-400">{clockedIn.length}</td>
                      <td className="p-3 text-center font-mono text-blue-400">{clockedOut.length}</td>
                      <td className="p-3">
                        <div className="text-slate-300">{notClockedIn} not clocked in</div>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700">{plan.status}</span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedRoster(plan)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                          >
                            <User className="h-3.5 w-3.5" />
                            View Users
                          </button>

                          {onDeleteShiftPlan && canManageShifts && (
                            <button
                              type="button"
                              onClick={() => handleDeleteShiftPlan(plan.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-400 transition-colors hover:border-rose-500/50 hover:bg-rose-500/20 hover:text-rose-300"
                              title="Delete Shift Roster"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rosterPlans.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-slate-500" colSpan={7}>
                      No shift rosters have been created.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <PaginationControls currentPage={rosterPagination.currentPage} totalPages={rosterPagination.totalPages} itemCount={rosterPlans.length} onPageChange={rosterPagination.setCurrentPage} />
          </div>

          {selectedRoster && (
            <FMSDialog
              title={`${selectedRoster.name} Roster`}
              subtitle="Assignment remains separate from attendance."
              icon={<User className="h-5 w-5" />}
              onClose={() => setSelectedRoster(null)}
              maxWidth="max-w-3xl"
            >
              <div className="flex justify-end mb-4">
                <button onClick={() => setSelectedRoster(null)} className="p-1.5 text-slate-400 hover:text-white" title="Close roster">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {selectedRoster.assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="grid grid-cols-[1.3fr_1fr_1fr] gap-3 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-white">{assignment.userName}</div>
                      <div className="text-slate-400">{assignment.userRole}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Assignment</div>
                      <div>{assignment.status}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Attendance</div>
                      <div>
                        {assignment.clockOutTime
                          ? `Clocked out ${safeTimeLabel(assignment.clockOutTime)}`
                          : assignment.clockInTime
                          ? `Clocked in ${safeTimeLabel(assignment.clockInTime)}`
                          : 'Not clocked in'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {(hasRosterPermission('ASSIGN_SHIFT_USERS') || hasRosterPermission('REMOVE_SHIFT_USERS')) && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
                  {hasRosterPermission('ASSIGN_SHIFT_USERS') && (
                    <>
                      <select
                        value={rosterUserId}
                        onChange={(event) => setRosterUserId(event.target.value)}
                        className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
                      >
                        <option value="">Add eligible user</option>
                        {safeUsers
                          .filter(
                            (user) =>
                              user.active &&
                              !selectedRoster.assignments.some((assignment) => assignment.userId === user.id)
                          )
                          .map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} ({user.role})
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={async () => {
                          if (!rosterUserId || !onAssignShiftPlanUser) return;
                          try {
                            const updatedRoster = await onAssignShiftPlanUser(selectedRoster.id, rosterUserId);
                            setSelectedRoster(updatedRoster);
                            setRosterUserId('');
                          } catch (err: any) {
                            showAlert(err.message || 'Failed to add user to the shift roster.');
                          }
                        }}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Add User
                      </button>
                    </>
                  )}
                  {hasRosterPermission('REMOVE_SHIFT_USERS') &&
                    selectedRoster.assignments
                      .filter((assignment) => assignment.status !== 'Removed From Assignment')
                      .map((assignment) => (
                        <button
                          key={assignment.id}
                          onClick={async () => {
                            if (!onRemoveShiftPlanUser) return;
                            const updatedRoster = await onRemoveShiftPlanUser(selectedRoster.id, assignment.userId);
                            setSelectedRoster(updatedRoster);
                          }}
                          className="rounded-lg border border-rose-500/40 px-2 py-1.5 text-xs text-rose-300"
                        >
                          Remove {assignment.userName}
                        </button>
                      ))}
                </div>
              )}
            </FMSDialog>
          )}
        </div>
      ) : (
        /* Schedules Tab */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>Assigned Shift Rosters & Duty Schedules</span>
            </h3>

            {canManageShifts && (
              <button
                onClick={() => setShowAssignModal(true)}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-xl text-xs"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Assign New Shift</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" role="tablist" aria-label="Roster status filters">
            {rosterStatuses.map((status) => <button key={status} type="button" role="tab" aria-selected={selectedRosterStatus === status} onClick={() => setSelectedRosterStatus(status as ShiftSchedule['status'])} className={`rounded-lg border p-3 text-left transition-colors ${selectedRosterStatus === status ? 'border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/40' : status === 'Stale' ? 'border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15' : 'border-slate-800 bg-slate-950 hover:bg-slate-800/70'}`}><div className="text-[10px] font-bold uppercase text-slate-400">{status}</div><div className="mt-1 text-xl font-bold text-white">{rosterStatusCounts[status]}</div></button>)}
          </div>

          <div className="overflow-x-auto">
            <table className="fms-table min-w-[760px] text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">Assigned Staff</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Shift Type</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Hours</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {currentRosterSchedules.length === 0 ? (
                  <tr><td colSpan={7} className="p-5 text-center text-slate-400">No {selectedRosterStatus.toLowerCase()} shift assignments.</td></tr>
                ) : scheduleStatusPagination.pageItems.map((sch) => (
                  <tr key={sch.id} className="hover:bg-slate-800/40">
                    <td className="p-3 font-bold text-white">{sch.staffName}</td>
                    <td className="p-3 text-slate-400">{sch.role}</td>
                    <td className="p-3 font-mono text-emerald-400"><div>{sch.shiftName || sch.shiftType}</div><div className="text-[10px] text-slate-500">{sch.recurrenceId ? 'Recurring' : 'One-Time'}</div></td>
                    <td className="p-3 font-mono">{sch.date}</td>
                    <td className="p-3 font-mono text-slate-400">
                      {sch.startTime} - {sch.endTime}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${rosterStatusBadgeClass(sch.status)}`}>
                        {sch.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {canManageShifts && (
                        <button
                          onClick={() => handleDeleteSchedule(sch)}
                          className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Delete Shift Assignment"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls currentPage={scheduleStatusPagination.currentPage} totalPages={scheduleStatusPagination.totalPages} itemCount={currentRosterSchedules.length} onPageChange={scheduleStatusPagination.setCurrentPage} />
        </div>
      )}

      {/* ========== Clock-In Wizard Modal ========== */}
      {showClockInModal && (
        <FMSDialog
          title="Opening Shift Clock-In"
          subtitle={`Step ${clockInStep} of 3 • Opening meter & tank audit`}
          icon={<Clock className="h-5 w-5" />}
          onClose={() => setShowClockInModal(false)}
          maxWidth="max-w-2xl"
        >
          {clockInError && (
            <div className="bg-rose-500/20 border border-rose-500/30 text-rose-300 p-3 rounded-xl text-xs mb-4">{clockInError}</div>
          )}

          {/* Step 1: User & Cash Float */}
          {clockInStep === 1 && (
            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Select Staff User</label>
                <select
                  value={clockInUser?.id || currentUser?.id || ''}
                  onChange={(e) => {
                    const u = safeUsers.find((x) => x.id === e.target.value);
                    if (u && (u.id === currentUser?.id || canManageShifts)) {
                      setClockInUser(u);
                    }
                  }}
                  disabled={!canManageShifts}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {safeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div>
                  <label className="block text-slate-400 mb-1">Enter User PIN</label>
                  <input
                    type="password"
                    maxLength={4}
                    placeholder="e.g. 1111"
                    value={clockInPin}
                    onChange={(e) => setClockInPin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono font-bold tracking-widest text-center"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Assigned Roster Shift</label>
                <select
                  value={clockInShiftPlanId}
                  onChange={(e) => setClockInShiftPlanId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                >
                  <option value="">Select assigned roster shift</option>
                  {shiftPlans
                    .filter((plan) =>
                      plan.assignments.some(
                        (assignment) =>
                          assignment.userId === clockInUser?.id &&
                          assignment.status === 'Due' &&
                          !assignment.clockInTime &&
                          Date.parse(plan.scheduledStart) <= Date.now() &&
                          Date.now() <= Date.parse(plan.scheduledEnd)
                      )
                    )
                    .map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} ({safeTimeLabel(plan.scheduledStart)} - {safeTimeLabel(plan.scheduledEnd)})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Opening Cash Float Allowance (KES)</label>
                <input
                  type="number"
                  value={clockInFloat}
                  onChange={(e) => setClockInFloat(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-emerald-400 font-mono font-bold"
                />
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    if (!clockInShiftPlanId) {
                      setClockInError('Select an assigned roster shift before continuing.');
                      return;
                    }
                    setClockInStep(2);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500"
                >
                  Next: Record Opening Pump Meters
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Mandatory Opening Pump Meter Readings */}
          {clockInStep === 2 && (
            <div className="space-y-4 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center gap-2 text-amber-300">
                <Gauge className="w-5 h-5 text-amber-400 shrink-0" />
                <span>
                  Opening baselines carry forward the previous shift closing meters. Your observations are recorded separately; differences from the system/PTS-2 reading require manager approval.
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {safePumps.map((p) => (
                  <div
                    key={p.id}
                    className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-white">{p.pumpName}</div>
                      <div className="text-[10px] text-emerald-400">{p.fuelName}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] text-slate-400">Baseline: {Number(p.previousClosingMeter??p.currentMeterReading).toFixed(3)} L<br/>System / PTS-2: {Number(p.currentMeterReading).toFixed(3)} L</div><span className="text-slate-400 text-[11px]">Your observed meter (L):</span>
                      <input
                        type="number"
                        step="0.1"
                        value={openingPumpMetersInput[p.id] ?? ''}
                        onChange={(e) =>
                          setOpeningPumpMetersInput(previous=>{const next={...previous};if(e.target.value==='')delete next[p.id];else next[p.id]=Number(e.target.value);return next;})
                        }
                        className="w-32 bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-right font-mono font-bold text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setClockInStep(1)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setClockInStep(3)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500"
                >
                  Next: Record Tank Dips
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Mandatory Opening Tank Dip Readings */}
          {clockInStep === 3 && (
            <div className="space-y-4 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center gap-2 text-emerald-300">
                <Droplets className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>
                  <strong>MANDATORY:</strong> Input opening physical tank dip readings (Liters) to initialize wet stock ledger tracking.
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {safeTanks.map((t) => (
                  <div
                    key={t.id}
                    className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-white">{t.tankName}</div>
                      <div className="text-[10px] text-slate-400">Capacity: {t.capacityLiters.toLocaleString()} L</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-[11px]">Opening Dip (L):</span>
                      <input
                        type="number"
                        step="1"
                        value={openingTankDipsInput[t.id] ?? t.currentLevelLiters}
                        onChange={(e) =>
                          setOpeningTankDipsInput({ ...openingTankDipsInput, [t.id]: parseFloat(e.target.value) || 0 })
                        }
                        className="w-32 bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-right font-mono font-bold text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setClockInStep(2)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleClockInSubmit}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isSubmitting ? 'Opening Shift...' : 'Complete Clock-In'}
                </button>
              </div>
            </div>
          )}
        </FMSDialog>
      )}

      {/* ========== Clock-Out Reconciliation Wizard ========== */}
      {selectedShiftToReconcile && (
        <FMSDialog
          title={`3-Way Reconciliation — ${selectedShiftToReconcile.staffName}`}
          subtitle={`Step ${wizardStep} of 4 • Closing shift audit`}
          icon={<Scale className="h-5 w-5" />}
          onClose={() => setSelectedShiftToReconcile(null)}
          maxWidth="max-w-3xl"
        >
          {/* Step 1: Physical Cash Count */}
          {wizardStep === 1 && (
            <div className="space-y-4 text-xs">
              <h4 className="font-bold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Physical Cash Count & Digital Till Collections</span>
              </h4>

              <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">KES 1,000 Notes</label>
                  <input
                    type="number"
                    value={notes1000}
                    onChange={(e) => setNotes1000(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">KES 500 Notes</label>
                  <input
                    type="number"
                    value={notes500}
                    onChange={(e) => setNotes500(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">KES 200 Notes</label>
                  <input
                    type="number"
                    value={notes200}
                    onChange={(e) => setNotes200(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">KES 100 Notes</label>
                  <input
                    type="number"
                    value={notes100}
                    onChange={(e) => setNotes100(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">KES 50 Notes</label>
                  <input
                    type="number"
                    value={notes50}
                    onChange={(e) => setNotes50(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">Coins Total (KES)</label>
                  <input
                    type="number"
                    value={coins}
                    onChange={(e) => setCoins(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">M-Pesa Direct Collections</label>
                  <input
                    type="number"
                    value={mpesaDirect}
                    onChange={(e) => setMpesaDirect(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">Card / Credit Sales</label>
                  <input
                    type="number"
                    value={cardDirect}
                    onChange={(e) => setCardDirect(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-right font-mono text-emerald-400"
                  />
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1 font-mono">
                <div className="flex justify-between text-white font-bold">
                  <span>Actual Physical Count:</span>
                  <span className="text-emerald-400">KES {actualCashCountTotal.toFixed(2)}</span>
                </div>
                <p className="border-t border-slate-800 pt-2 text-[10px] text-slate-400">System reconciliation is calculated only after submission.</p>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  disabled
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500"
                >
                  Next: Record Closing Pump Meters
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Closing Pump Meter Readings */}
          {wizardStep === 2 && (
            <div className="space-y-4 text-xs">
              <h4 className="font-bold text-white flex items-center gap-2">
                <Gauge className="w-4 h-4 text-amber-400" />
                <span>Closing Pump Meter Readings</span>
              </h4>
              <p className="text-slate-400">The system reads closing meters at submission. Your observation is kept for review and cannot change the meter or shift volume.</p>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {safePumps.map((p) => {
                  const opening =
                    selectedShiftToReconcile.openingPumpReadings?.find((op) => op.pumpId === p.id)?.openingMeter ??
                    p.openingMeterReading;
                  const closing = p.currentMeterReading;
                  const salesL = Math.max(0, closing - opening);
                  return (
                    <div
                      key={p.id}
                      className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-bold text-white">{p.pumpName} ({p.fuelName})</div>
                        <div className="text-[10px] text-slate-400">Opening baseline: {opening.toFixed(3)} L<br/>System / PTS-2: {Number(p.currentMeterReading).toFixed(3)} L</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">Your observed meter (L):</div>
                          <input
                            type="number"
                            step="0.1"
                            value={pumpClosingMeters[p.id] ?? ''}
                            onChange={(e) => setPumpClosingMeters(previous=>{const next={...previous};if(e.target.value==='')delete next[p.id];else next[p.id]=Number(e.target.value);return next;})}
                            className="w-28 bg-slate-900 border border-slate-700 rounded p-1 text-right font-mono font-bold text-emerald-400"
                          />
                        </div>
                        <div className="text-right w-20">
                          <span className="text-[10px] text-slate-500 block">Dispensed</span>
                          <span className="font-bold text-white font-mono">{salesL.toFixed(3)} L</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(3)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500"
                >
                  Next: Record Tank Dips
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Tank Dip Readings */}
          {wizardStep === 3 && (
            <div className="space-y-4 text-xs">
              <h4 className="font-bold text-white flex items-center gap-2">
                <Droplets className="w-4 h-4 text-blue-400" />
                <span>Closing Tank Dip Readings</span>
              </h4>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {safeTanks.map((t) => {
                  const openingDip =
                    selectedShiftToReconcile.openingTankDips?.find((ot) => ot.tankId === t.id)?.openingDip ?? t.lastDipReading;
                  const closingDip = tankClosingDips[t.id] ?? t.currentLevelLiters;
                  const wetUsage = Math.max(0, openingDip - closingDip);
                  return (
                    <div
                      key={t.id}
                      className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-bold text-white">{t.tankName}</div>
                        <div className="text-[10px] text-slate-400">Opening Dip: {openingDip} L</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">Closing Dip (L):</div>
                          <input
                            type="number"
                            step="1"
                            value={closingDip}
                            onChange={(e) => setTankClosingDips({ ...tankClosingDips, [t.id]: parseFloat(e.target.value) || 0 })}
                            className="w-28 bg-slate-900 border border-slate-700 rounded p-1 text-right font-mono font-bold text-emerald-400"
                          />
                        </div>
                        <div className="text-right w-20">
                          <span className="text-[10px] text-slate-500 block">Wet Depletion</span>
                          <span className="font-bold text-white font-mono">{wetUsage} L</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(4)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500"
                >
                  Next: 3-Way Reconciliation Match
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Summary & Submit */}
          {wizardStep === 4 && (
            <div className="space-y-4 text-xs">
              <h4 className="font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>3-Way Match Verification Summary</span>
              </h4>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 font-mono">
                <div className="flex justify-between text-emerald-400 font-bold">
                  <span>Actual Physical Count:</span>
                  <span>KES {actualCashCountTotal.toFixed(2)}</span>
                </div>
                <p className="border-t border-slate-800 pt-2 text-[10px] text-slate-400">Submit your physical figures. Variances are evaluated privately by the system.</p>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setWizardStep(3)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleFinalReconciliationSubmit}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isSubmitting ? 'Submitting...' : 'Submit 3-Way Reconciliation & Close Shift'}
                </button>
              </div>
            </div>
          )}
        </FMSDialog>
      )}

      {/* ========== Assign Schedule Modal ========== */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative my-8 text-slate-100">
            <button
              onClick={() => setShowAssignModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Assign Shift Schedule</h3>
                <p className="text-xs text-slate-400">Schedule shift duties for station staff members.</p>
              </div>
            </div>

            <form onSubmit={handleAssignScheduleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1.5 font-medium">Assign To Staff Member(s) (Multi-Select Enabled)</label>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-36 overflow-y-auto space-y-2">
                  {safeUsers.map((u) => {
                    const isSelected = assignStaffIds.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2.5 cursor-pointer text-slate-200 hover:text-white">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAssignStaffIds([...assignStaffIds, u.id]);
                            } else {
                              setAssignStaffIds(assignStaffIds.filter((id) => id !== u.id));
                            }
                          }}
                          className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/20"
                        />
                        <span className="font-semibold text-xs">{u.name}</span>
                        <span className="text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 ml-auto">
                          {u.role}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-emerald-400 mt-1">Selected: {assignStaffIds.length} staff member(s) assigned to this shift simultaneously</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Shift Type</label>
                  <select
                    value={assignShiftType}
                    onChange={(e) => setAssignShiftType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="Morning">Morning Shift</option>
                    <option value="Evening">Evening Shift</option>
                    <option value="Night">Night Shift</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Schedule Type</label>
                  <select
                    value={assignScheduleType}
                    onChange={(e) => setAssignScheduleType(e.target.value as 'one-time' | 'recurring')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="one-time">One-Time</option>
                    <option value="recurring">Recurring</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">{assignScheduleType === 'recurring' ? 'Recurrence Start Date' : 'Shift Date'}</label>
                  <input
                    type="date"
                    required
                    value={assignDate}
                    onChange={(e) => setAssignDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                  />
                </div>
                {assignScheduleType === 'recurring' && (
                  <div>
                    <label className="block text-slate-400 mb-1">Recurrence End Date</label>
                    <input
                      type="date"
                      required
                      min={assignDate}
                      value={assignEndDate}
                      onChange={(e) => setAssignEndDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={assignStartTime}
                    onChange={(e) => setAssignStartTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">End Time</label>
                  <input
                    type="time"
                    required
                    value={assignEndTime}
                    onChange={(e) => setAssignEndTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                  />
                </div>
              </div>

              {assignScheduleType === 'recurring' && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <label className="block text-slate-400 mb-2">Repeat On</label>
                  <div className="grid grid-cols-7 gap-1.5">
                    {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((label, day) => {
                      const selected = assignWeekdays.includes(day);
                      return <button
                        key={label}
                        type="button"
                        onClick={() => setAssignWeekdays((days) => selected ? days.filter((value) => value !== day) : [...days, day])}
                        className={`min-h-9 rounded-lg border text-[10px] font-bold transition-colors ${selected ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                        aria-pressed={selected}
                      >
                        {label}
                      </button>;
                    })}
                  </div>
                  {!assignWeekdays.length && <p className="mt-2 text-[10px] text-amber-300">Select at least one day for this recurring roster.</p>}
                </div>
              )}

              <div className="pt-3 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-500/20"
                >
                  {isSubmitting ? 'Saving...' : 'Assign Shift Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========== Custom Alert/Confirm Modal ========== */}
      {modal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6">
            <div className="flex items-start gap-3">
              {modal.type === 'confirm' ? (
                <div className="p-2 bg-amber-500/10 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
              ) : (
                <div className="p-2 bg-emerald-500/10 rounded-xl">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-white font-bold">{modal.type === 'confirm' ? 'Confirm Action' : 'Notice'}</h3>
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">{modal.message}</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              {modal.type === 'confirm' && (
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const onConfirm = modal.onConfirm;
                  setModal(null);
                  onConfirm?.();
                }}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
              >
                {modal.type === 'confirm' ? 'Confirm' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
