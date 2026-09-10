import React, { useEffect, useState } from 'react';
import {
  Building2,
  Receipt,
  CheckCircle2,
  ShieldCheck,
  Save,
  QrCode,
  Lock,
  AlertTriangle,
  X,
} from 'lucide-react';
import { StationSettings as StationSettingsType, User } from '../types';
import { usePermissions } from '../hooks/usePermissions';

interface StationSettingsProps {
  settings: StationSettingsType;
  currentUser: User;
  onSaveSettings: (newSettings: Partial<StationSettingsType>) => Promise<StationSettingsType>;
}

// ====== FMS Dialog Shell ======
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

export const StationSettings: React.FC<StationSettingsProps> = ({
  settings,
  currentUser,
  onSaveSettings,
}) => {
  const { hasPermission } = usePermissions(currentUser);
  const canEdit = hasPermission('MANAGE_SETTINGS');

  const createFormData = (): StationSettingsType => ({
    stationName: settings.stationName ?? '',
    tagline: settings.tagline ?? '',
    taxPin: settings.taxPin ?? '',
    address: settings.address ?? '',
    phone: settings.phone ?? '',
    email: settings.email ?? '',
    invoiceTerms: settings.invoiceTerms ?? '',
    paybillNumber: settings.paybillNumber ?? '',
    paybillAccountNumber: settings.paybillAccountNumber ?? '',
    tillNumber: settings.tillNumber ?? '',
    showPaybillOnInvoice: settings.showPaybillOnInvoice ?? true,
    showTillOnInvoice: settings.showTillOnInvoice ?? false,
  });

  const [formData, setFormData] = useState<StationSettingsType>(createFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setFormData(createFormData());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const updateField = <K extends keyof StationSettingsType>(field: K, value: StationSettingsType[K]) => {
    if (!canEdit || isSaving) return;
    setFormData((previous) => ({ ...previous, [field]: value }));
  };

  const showError = (message: string) => {
    setIsSaving(false);
    setErrorMessage(message);
  };

  const closeError = () => {
    setErrorMessage(null);
    setIsSaving(false);
    setFormData((previous) => ({ ...previous }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canEdit) {
      showError('Action Restricted: You do not have permission to alter invoice headers.');
      return;
    }

    const trimmedTaxPin = formData.taxPin.trim();
    const taxPinPattern = /^[A-Z]\d{9}[A-Z0-9]$/i;

    if (!taxPinPattern.test(trimmedTaxPin)) {
      showError('KRA Tax PIN must be in a valid format such as A123456789Z.');
      return;
    }

    if (formData.showPaybillOnInvoice) {
      if (!formData.paybillNumber.trim() || !formData.paybillAccountNumber.trim()) {
        showError('Both Paybill Number and Account Number are required when Paybill is enabled.');
        return;
      }
    }

    if (formData.showTillOnInvoice && !formData.tillNumber.trim()) {
      showError('Till Number is required when Buy Goods Till is enabled.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const settingsToSave: Partial<StationSettingsType> = {
        ...formData,
        taxPin: trimmedTaxPin.toUpperCase(),
      };

      await onSaveSettings(settingsToSave);
      setSuccessMessage('Invoice Header & Station Settings saved successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      let message = 'Failed to save station settings.';
      if (err && typeof err === 'object' && 'message' in err) {
        message = String((err as { message?: string }).message);
      }
      showError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const inputDisabled = !canEdit || isSaving;

  return (
    <div className="space-y-6">
      {/* ERROR DIALOG */}
      {errorMessage && (
        <FMSDialog
          title="Validation Error"
          subtitle="Please correct the highlighted issues and try again."
          icon={<AlertTriangle className="h-5 w-5" />}
          onClose={closeError}
          maxWidth="max-w-md"
        >
          <p className="text-sm text-slate-400 leading-relaxed">{errorMessage}</p>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={closeError}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
            >
              Continue Editing
            </button>
          </div>
        </FMSDialog>
      )}

      {/* HEADER */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Station Manager & Super Admin Controls</span>
          </div>
          <h2 className="text-xl font-bold text-white">Station & Tax Invoice Header Configuration</h2>
          <p className="text-xs text-slate-400 mt-1">
            Customize station parameters, KRA eTIMS registration PIN, Paybill, and tax receipt footer notices.
          </p>
        </div>

        {!canEdit && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs px-3.5 py-2 rounded-xl flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Read-Only mode. Logged in as <strong>{currentUser.role}</strong>.
            </span>
          </div>
        )}
      </div>

      {/* SUCCESS MESSAGE */}
      {successMessage && (
        <div className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 p-4 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* FORM */}
        <form onSubmit={handleSubmit} className="lg:col-span-7 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-400" />
            <span>Station Business Profile</span>
          </h3>

          <div className="space-y-3 text-xs">
            {/* STATION NAME */}
            <div>
              <label className="block text-slate-400 mb-1">Station Trading Name / Branch Header</label>
              <input
                type="text"
                required
                disabled={inputDisabled}
                value={formData.stationName}
                onChange={(e) => updateField('stationName', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
              />
            </div>

            {/* TAGLINE */}
            <div>
              <label className="block text-slate-400 mb-1">Station Slogan / Subtitle</label>
              <input
                type="text"
                disabled={inputDisabled}
                value={formData.tagline}
                onChange={(e) => updateField('tagline', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
              />
            </div>

            {/* TAX PIN */}
            <div>
              <label className="block text-slate-400 mb-1">KRA Tax PIN</label>
              <input
                type="text"
                required
                disabled={inputDisabled}
                value={formData.taxPin}
                onChange={(e) => updateField('taxPin', e.target.value.toUpperCase())}
                placeholder="A123456789Z"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
              />
            </div>

            {/* PAYMENT OPTIONS */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-3">
              <span className="text-slate-300 font-medium">Payment Options on Invoice</span>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                <span className="text-slate-300">Show M-Pesa Paybill on Invoice</span>
                <input
                  type="checkbox"
                  disabled={inputDisabled}
                  checked={formData.showPaybillOnInvoice}
                  onChange={(e) => updateField('showPaybillOnInvoice', e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>

              {formData.showPaybillOnInvoice && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Paybill Number</label>
                    <input
                      type="text"
                      disabled={inputDisabled}
                      value={formData.paybillNumber}
                      onChange={(e) => updateField('paybillNumber', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Account Number</label>
                    <input
                      type="text"
                      disabled={inputDisabled}
                      value={formData.paybillAccountNumber}
                      onChange={(e) => updateField('paybillAccountNumber', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                <span className="text-slate-300">Show Buy Goods Till on Invoice</span>
                <input
                  type="checkbox"
                  disabled={inputDisabled}
                  checked={formData.showTillOnInvoice}
                  onChange={(e) => updateField('showTillOnInvoice', e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>

              {formData.showTillOnInvoice && (
                <div>
                  <label className="block text-slate-400 mb-1">Till Number</label>
                  <input
                    type="text"
                    disabled={inputDisabled}
                    value={formData.tillNumber}
                    onChange={(e) => updateField('tillNumber', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  />
                </div>
              )}
            </div>

            {/* ADDRESS */}
            <div>
              <label className="block text-slate-400 mb-1">Physical Location & Address</label>
              <input
                type="text"
                disabled={inputDisabled}
                value={formData.address}
                onChange={(e) => updateField('address', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
              />
            </div>

            {/* PHONE + EMAIL */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Station Telephone</label>
                <input
                  type="text"
                  disabled={inputDisabled}
                  value={formData.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Station Email</label>
                <input
                  type="email"
                  disabled={inputDisabled}
                  value={formData.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                />
              </div>
            </div>

            {/* TERMS */}
            <div>
              <label className="block text-slate-400 mb-1">Invoice Footer Terms & Return Notice</label>
              <textarea
                rows={3}
                disabled={inputDisabled}
                value={formData.invoiceTerms}
                onChange={(e) => updateField('invoiceTerms', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-xs"
              />
            </div>
          </div>

          {canEdit && (
            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 text-white font-bold px-6 py-2.5 rounded-xl text-xs"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Saving Changes...' : 'Save Invoice Header Settings'}</span>
              </button>
            </div>
          )}
        </form>

        {/* LIVE PREVIEW */}
        <div className="lg:col-span-5 self-start bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-400" />
            <span>Live KRA Tax Receipt Header Preview</span>
          </h3>

          <div className="invoice-header-preview bg-white text-slate-900 p-5 rounded-xl font-sans text-xs shadow-inner space-y-3">
            <div className="text-center border-b pb-3">
              <h4 className="font-black uppercase text-sm">{formData.stationName || 'STATION NAME'}</h4>
              <p className="text-[10px] text-slate-600 italic">{formData.tagline || 'Slogan/Tagline'}</p>
              <p className="text-[10px] text-slate-500 mt-1">{formData.address}</p>
              <p className="text-[10px] text-slate-500">TEL: {formData.phone} | EMAIL: {formData.email}</p>
              <div
                className="invoice-header-preview-pin mt-2 border p-1.5 rounded text-[10px] font-mono font-bold"
                style={{ backgroundColor: '#f1f5f9', borderColor: '#475569', color: '#0f172a' }}
              >
                KRA PIN: {formData.taxPin}
              </div>
            </div>

            <div className="flex justify-between items-center text-[11px] font-mono">
              <span className="font-bold">TAX INVOICE #: Inv000</span>
              <span className="text-slate-500">12/08/2026 14:30</span>
            </div>

            {(formData.showPaybillOnInvoice || formData.showTillOnInvoice) && (
              <div
                className="invoice-header-preview-payment border p-2 rounded text-[10px] flex justify-between items-center"
                style={{ backgroundColor: '#f8fafc', borderColor: '#475569', color: '#0f172a' }}
              >
                <div>
                  {formData.showPaybillOnInvoice && (
                    <p className="font-bold">
                      M-PESA PAYBILL: {formData.paybillNumber || '---'} | A/C: {formData.paybillAccountNumber || '---'}
                    </p>
                  )}
                  {formData.showTillOnInvoice && (
                    <p className="text-slate-500">BUY GOODS TILL: {formData.tillNumber || '---'}</p>
                  )}
                </div>
                <QrCode className="w-10 h-10 text-slate-800" />
              </div>
            )}

            <p className="text-[9px] text-slate-500 text-center italic border-t pt-2">{formData.invoiceTerms}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
