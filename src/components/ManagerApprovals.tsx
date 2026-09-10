import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Check,
  X,
  ShieldAlert,
  KeyRound,
  AlertTriangle,
  Loader2,
  ClipboardCheck,
  History,
} from 'lucide-react';

import { ManagerApproval, User } from '../types';
import { usePermissions } from '../hooks/usePermissions';

interface ManagerApprovalsProps {
  approvals?: ManagerApproval[];
  currentUser: User;
  onResolveApproval: (
    approvalId: string,
    action: 'Approved' | 'Rejected',
    managerId: string,
    managerName: string,
    managerPin: string,
    notes: string
  ) => Promise<any>;
}

type ResolutionAction = 'Approved' | 'Rejected';

export const ManagerApprovals: React.FC<ManagerApprovalsProps> = ({
  approvals = [],
  currentUser,
  onResolveApproval,
}) => {
  const [selectedApproval, setSelectedApproval] = useState<ManagerApproval | null>(null);
  const [actionType, setActionType] = useState<ResolutionAction>('Approved');
  const [managerPinInput, setManagerPinInput] = useState<string>('');
  const [managerNotesInput, setManagerNotesInput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const { hasPermission } = usePermissions(currentUser);
  const canManageApprovals = hasPermission('MANAGE_APPROVALS');
  const isAdmin = currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin';
  const isAuthorized = canManageApprovals || isAdmin;

  // ==================================================
  // SAFE APPROVAL DATA
  // ==================================================

  const safeApprovals = Array.isArray(approvals) ? approvals.filter(Boolean) : [];
  const pendingList = safeApprovals.filter(
    (approval) => String(approval?.status ?? '').toLowerCase() === 'pending'
  );
  const resolvedList = safeApprovals.filter(
    (approval) => String(approval?.status ?? '').toLowerCase() !== 'pending'
  );

  // ==================================================
  // RESET / CLOSE DIALOG
  // ==================================================

  const resetDialog = () => {
    setSelectedApproval(null);
    setActionType('Approved');
    setManagerPinInput('');
    setManagerNotesInput('');
    setErrorMsg(null);
    setIsSubmitting(false);
  };

  const closeDialog = () => {
    if (isSubmitting) return;
    resetDialog();
  };

  // ==================================================
  // OPEN AUTHORIZATION DIALOG
  // ==================================================

  const openAuthorizationDialog = (approval: ManagerApproval, action: ResolutionAction) => {
    setManagerPinInput('');
    setErrorMsg(null);
    setIsSubmitting(false);

    setSelectedApproval(approval);
    setActionType(action);
    setManagerNotesInput(
      action === 'Approved'
        ? `Approved by ${currentUser?.name || 'Administrator'}.`
        : 'Rejected — further investigation or correction is required.'
    );
  };

  // ==================================================
  // ESCAPE KEY SUPPORT
  // ==================================================

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedApproval && !isSubmitting) {
        resetDialog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedApproval, isSubmitting]);

  // ==================================================
  // PIN INPUT
  // ==================================================

  const handlePinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const numericPin = event.target.value.replace(/\D/g, '').slice(0, 6);
    setManagerPinInput(numericPin);
    if (errorMsg) setErrorMsg(null);
  };

  // ==================================================
  // RESOLVE APPROVAL
  // ==================================================

  const handleResolve = async () => {
    if (!selectedApproval || isSubmitting) return;

    if (!isAuthorized) {
      setErrorMsg('Only Admin, Super Admin, or users with MANAGE_APPROVALS permission can approve or reject requests.');
      return;
    }

    const pin = managerPinInput.trim();
    const notes = managerNotesInput.trim();

    if (!pin) {
      setErrorMsg('Please enter your Administrator Security PIN.');
      return;
    }
    if (pin.length < 4) {
      setErrorMsg('Your Security PIN must contain at least 4 digits.');
      return;
    }
    if (!notes) {
      setErrorMsg('Please provide a resolution note or justification before continuing.');
      return;
    }
    if (!currentUser?.id) {
      setErrorMsg('Unable to identify the authorizing administrator. Please sign in again.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      await onResolveApproval(
        selectedApproval.id,
        actionType,
        currentUser.id,
        currentUser.name || 'Administrator',
        pin,
        notes
      );
      resetDialog();
    } catch (err: any) {
      console.error('Manager approval resolution failed:', err);
      setErrorMsg(err?.message || 'Authorization failed. Please verify your PIN and administrator permissions.');
      setIsSubmitting(false);
    }
  };

  // ==================================================
  // ACCESS RESTRICTED
  // ==================================================

  if (!isAuthorized) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-xl">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10">
            <ShieldAlert className="h-7 w-7 text-rose-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-100">Access Restricted</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Manager Approvals and Exception Overrides are restricted to authorized Admin, Super Admin, or users with MANAGE_APPROVALS permission.
          </p>
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-500">
            Current role: <span className="font-semibold text-slate-300">{currentUser?.role || 'Unknown'}</span>
          </div>
        </div>
      </div>
    );
  }

  // ==================================================
  // COMPONENT
  // ==================================================

  return (
    <div className="space-y-6 pb-12">
      {/* HEADER */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-100">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
            Manager Approvals & Exception Overrides
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Review operational exceptions, cash variances, fuel discrepancies, and override requests using mandatory administrator PIN authorization.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Authorized User</div>
            <div className="mt-0.5 text-xs font-bold text-emerald-400">{currentUser?.role}</div>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 text-center ${
              pendingList.length > 0 ? 'border-amber-500/20 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Pending</div>
            <div className={`mt-0.5 text-sm font-black ${pendingList.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {pendingList.length}
            </div>
          </div>
        </div>
      </div>

      {/* PENDING APPROVALS */}
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-100">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Pending Exception Inbox
          </h3>
          <span className="text-xs text-slate-500">Requires Administrator Authorization</span>
        </div>

        {pendingList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 py-12 text-center">
            <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-emerald-500/70" />
            <p className="text-sm font-semibold text-slate-300">No Pending Approvals</p>
            <p className="mt-1 text-xs text-slate-500">All current manager approval requests have been resolved.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingList.map((app) => (
              <div
                key={app.id}
                className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4 transition-colors hover:border-slate-700 md:flex-row md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-200">{app.type}</span>
                    <span className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                      {app.amountOrQty}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">{app.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-500">
                    <span>
                      Requested by: <span className="text-slate-400">{app.requestedBy}</span>
                    </span>
                    <span className="hidden sm:inline">•</span>
                    <span>{app.timestamp ? new Date(app.timestamp).toLocaleString() : 'Unknown time'}</span>
                  </div>
                </div>
                <div className="flex w-full items-center gap-2 md:w-auto">
                  <button
                    type="button"
                    onClick={() => openAuthorizationDialog(app, 'Approved')}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/10 transition-all hover:bg-emerald-500 active:scale-[0.98] md:flex-none"
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => openAuthorizationDialog(app, 'Rejected')}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-600/10 transition-all hover:bg-rose-500 active:scale-[0.98] md:flex-none"
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* HISTORY */}
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-100">
            <History className="h-5 w-5 text-slate-400" />
            Historical Approvals & Overrides Archive
          </h3>
          <span className="text-xs text-slate-500">{resolvedList.length} Resolved</span>
        </div>

        {resolvedList.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">No historical approval records are available yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs font-mono text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Requested By</th>
                  <th className="px-4 py-3">Amount / Qty</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3">Manager Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {resolvedList.map((app) => {
                  const isApproved = String(app.status).toLowerCase() === 'approved';
                  return (
                    <tr key={app.id} className="transition-colors hover:bg-slate-950">
                      <td className="px-4 py-3 font-bold text-slate-200">{app.type}</td>
                      <td className="px-4 py-3 text-slate-400">{app.requestedBy}</td>
                      <td className="px-4 py-3 font-bold text-amber-400">{app.amountOrQty}</td>
                      <td className="max-w-xs px-4 py-3 text-slate-400">{app.reason}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-bold ${
                            isApproved
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                              : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                          }`}
                        >
                          {app.status}
                        </span>
                      </td>
                      <td className="max-w-sm px-4 py-3 text-slate-400">{app.managerNotes || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AUTHORIZATION DIALOG */}
      {selectedApproval && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="approval-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            className="relative my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={`h-1.5 w-full ${actionType === 'Approved' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                    actionType === 'Approved'
                      ? 'border-emerald-500/20 bg-emerald-500/10'
                      : 'border-rose-500/20 bg-rose-500/10'
                  }`}
                >
                  {actionType === 'Approved' ? <Check className="h-5 w-5 text-emerald-400" /> : <X className="h-5 w-5 text-rose-400" />}
                </div>
                <div>
                  <h3 id="approval-dialog-title" className="text-base font-bold text-slate-100">
                    Administrator Authorization
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">Secure DT-FMS exception resolution</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={isSubmitting}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Close authorization dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Resolution Action</div>
                    <div className={`mt-1 text-sm font-black ${actionType === 'Approved' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {actionType}
                    </div>
                  </div>
                  <span className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs font-bold text-slate-200">
                    {selectedApproval.amountOrQty}
                  </span>
                </div>
                <div className="mt-3 border-t border-slate-800 pt-3">
                  <div className="text-xs font-bold text-slate-300">{selectedApproval.type}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500">{selectedApproval.reason}</div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/10 bg-emerald-500/5 px-4 py-3">
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Authorizing User</div>
                  <div className="text-xs font-bold text-slate-200">
                    {currentUser?.name}
                    <span className="ml-2 text-[10px] font-normal text-emerald-400">{currentUser?.role}</span>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="approval-notes" className="mb-1.5 block text-xs font-semibold text-slate-400">
                  Resolution Notes / Justification
                </label>
                <textarea
                  id="approval-notes"
                  rows={3}
                  value={managerNotesInput}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setManagerNotesInput(event.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Enter the reason for this decision..."
                  className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <label htmlFor="approval-pin" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                  <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                  Administrator Security PIN
                </label>
                <input
                  id="approval-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={managerPinInput}
                  disabled={isSubmitting}
                  onChange={handlePinChange}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !isSubmitting) {
                      event.preventDefault();
                      handleResolve();
                    }
                  }}
                  placeholder="••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center font-mono text-xl font-bold tracking-[0.45em] text-emerald-400 outline-none transition-colors placeholder:text-slate-700 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <p className="mt-1.5 text-[10px] text-slate-600">
                  Enter your registered administrator PIN to authorize this action.
                </p>
              </div>

              {errorMsg && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-xs text-rose-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-slate-800 bg-slate-950/40 px-6 py-4">
              <button
                type="button"
                onClick={closeDialog}
                disabled={isSubmitting}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-3 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResolve}
                disabled={isSubmitting}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                  actionType === 'Approved'
                    ? 'bg-emerald-600 shadow-lg shadow-emerald-600/10 hover:bg-emerald-500'
                    : 'bg-rose-600 shadow-lg shadow-rose-600/10 hover:bg-rose-500'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {actionType === 'Approved' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    Confirm {actionType}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};