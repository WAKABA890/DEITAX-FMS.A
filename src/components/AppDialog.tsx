import React from 'react';

export type AppDialogKind = 'confirmation' | 'warning' | 'error' | 'success' | 'delete';

interface AppDialogProps {
  open: boolean;
  kind?: AppDialogKind;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Shared in-app dialog; avoids browser/Electron confirmation UI. */
export const AppDialog: React.FC<AppDialogProps> = ({ open, kind = 'confirmation', title, message, confirmLabel, busy, onConfirm, onClose }) => {
  if (!open) return null;
  const destructive = kind === 'delete' || kind === 'warning' || kind === 'error';
  return <div className="fms-dialog-overlay z-[200]" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
    <div className="fms-dialog w-full max-w-md p-6">
      <h2 id="app-dialog-title" className="text-base font-bold text-white">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="fms-btn fms-btn-secondary fms-btn-compact">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className={`fms-btn fms-btn-compact ${destructive ? 'fms-btn-danger' : 'fms-btn-primary'}`}>{busy ? 'Working…' : confirmLabel || (kind === 'delete' ? 'Delete' : 'Continue')}</button>
      </div>
    </div>
  </div>;
};
