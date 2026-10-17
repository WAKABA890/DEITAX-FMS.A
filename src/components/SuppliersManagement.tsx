import React, { useState } from 'react';
import {
  Truck,
  Plus,
  Search,
  DollarSign,
  Building2,
  Phone,
  Mail,
  FileText,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  X,
  History,
  ShieldCheck,
  Receipt,
  Calendar,
} from 'lucide-react';
import {
  SupplierAccount,
  SupplierPayment,
  FuelDelivery,
  User,
  StationSettings,
} from '../types';
import { usePermissions } from '../hooks/usePermissions';
import { AppDialog } from './AppDialog';

interface SuppliersManagementProps {
  suppliers?: SupplierAccount[];
  deliveries?: FuelDelivery[];
  currentUser?: User;
  stationSettings?: StationSettings;
  onSaveSupplier?: (data: any) => Promise<any>;
  onRecordPayment?: (data: any) => Promise<any>;
  onDeleteSupplier?: (supplierId: string) => Promise<any>;
}

export const SuppliersManagement: React.FC<SuppliersManagementProps> = ({
  suppliers = [],
  deliveries = [],
  currentUser,
  stationSettings,
  onSaveSupplier,
  onRecordPayment,
  onDeleteSupplier,
}) => {
  const { hasPermission } = usePermissions(currentUser ?? null);
  const canManageSuppliers = hasPermission('MANAGE_SUPPLIERS');
  const canRecordPayment = hasPermission('RECORD_SUPPLIER_PAYOUT');
  const canDeleteSupplier = hasPermission('DELETE_SUPPLIER');

  const [activeTab, setActiveTab] = useState<'directory' | 'deliveries'>('directory');
  const [searchTerm, setSearchTerm] = useState('');

  // Register / Edit Supplier Modal State
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierAccount | null>(null);
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supKraPin, setSupKraPin] = useState('');
  const [supPaymentTerms, setSupPaymentTerms] = useState('Net 14 Days');
  const [supStatus, setSupStatus] = useState<'Active' | 'Inactive'>('Active');
  const [isSubmittingSup, setIsSubmittingSup] = useState(false);

  // Payment Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierAccount | null>(null);
  const [payAmount, setPayAmount] = useState<number>(100000);
  const [payMethod, setPayMethod] = useState<'Bank Transfer' | 'M-Pesa' | 'Cash' | 'Cheque'>('Bank Transfer');
  const [payRefNo, setPayRefNo] = useState('');
  const [payDeliveryNote, setPayDeliveryNote] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<SupplierAccount | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState(false);

  const deleteSupplier = async () => {
    if (!supplierToDelete || !onDeleteSupplier) return;
    setDeletingSupplier(true);
    try {
      await onDeleteSupplier(supplierToDelete.id);
      setSupplierToDelete(null);
      setFeedback({ type: 'success', message: 'Supplier deleted successfully.' });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.message || 'Supplier could not be deleted.' });
      setSupplierToDelete(null);
    } finally { setDeletingSupplier(false); }
  };

  const openNewSupplierModal = () => {
    if (!canManageSuppliers) return;
    setEditingSupplier(null);
    setSupName('');
    setSupContact('');
    setSupPhone('');
    setSupEmail('');
    setSupAddress('');
    setSupKraPin('');
    setSupPaymentTerms('Net 14 Days');
    setSupStatus('Active');
    setShowSupplierModal(true);
  };

  const openEditSupplierModal = (sup: SupplierAccount) => {
    if (!canManageSuppliers) return;
    setEditingSupplier(sup);
    setSupName(sup.name);
    setSupContact(sup.contactPerson || '');
    setSupPhone(sup.phone || '');
    setSupEmail(sup.email || '');
    setSupAddress(sup.address || '');
    setSupKraPin(sup.kraPin || '');
    setSupPaymentTerms(sup.paymentTerms || 'Net 14 Days');
    setSupStatus(sup.status);
    setShowSupplierModal(true);
  };

  const handleSaveSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim() || !supPhone.trim()) {
      setFeedback({ type: 'error', message: 'Supplier Company Name and Phone Number are required.' });
      return;
    }
    if(suppliers.some(s=>s.id!==editingSupplier?.id&&s.name.trim().toLowerCase()===supName.trim().toLowerCase())){setFeedback({type:'error',message:'A supplier with this name already exists.'});return;}
    if(supKraPin.trim()&&suppliers.some(s=>s.id!==editingSupplier?.id&&String(s.kraPin||'').trim().toUpperCase()===supKraPin.trim().toUpperCase())){setFeedback({type:'error',message:'A supplier with this Tax PIN already exists.'});return;}

    setIsSubmittingSup(true);
    setFeedback(null);
    try {
      if (onSaveSupplier) {
        await onSaveSupplier({
          id: editingSupplier?.id,
          name: supName,
          contactPerson: supContact,
          phone: supPhone,
          email: supEmail,
          address: supAddress,
          kraPin: supKraPin,
          paymentTerms: supPaymentTerms,
          status: supStatus,
          userId: currentUser?.id,
          userName: currentUser?.name,
          userRole: currentUser?.role,
        });
        setFeedback({ type: 'success', message: `Supplier account '${supName}' saved successfully.` });
        setShowSupplierModal(false);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save supplier.' });
    } finally {
      setIsSubmittingSup(false);
    }
  };

  const openPaymentModal = (sup: SupplierAccount) => {
    if (!canRecordPayment) return;
    setSelectedSupplier(sup);
    setPayAmount(sup.currentBalance > 0 ? sup.currentBalance : 50000);
    setPayMethod('Bank Transfer');
    setPayRefNo(`BKTRF-${Math.floor(100000 + Math.random() * 900000)}`);
    setPayDeliveryNote('');
    setPayNotes('');
    setShowPaymentModal(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier || payAmount <= 0) {
      setFeedback({ type: 'error', message: 'Please enter a valid payment amount.' });
      return;
    }

    if (payAmount > selectedSupplier.currentBalance) {
      setFeedback({
        type: 'error',
        message: `Payment amount cannot exceed the outstanding balance of KES ${selectedSupplier.currentBalance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}.`,
      });
      return;
    }

    setIsSubmittingPay(true);
    setFeedback(null);
    try {
      if (onRecordPayment) {
        await onRecordPayment({
          supplierId: selectedSupplier.id,
          amount: payAmount,
          paymentMethod: payMethod,
          referenceNo: payRefNo,
          deliveryNoteNo: payDeliveryNote,
          notes: payNotes,
          userId: currentUser?.id,
          userName: currentUser?.name,
          userRole: currentUser?.role,
        });
        setFeedback({
          type: 'success',
          message: `Recorded KES ${payAmount.toLocaleString()} payment to ${selectedSupplier.name}. Cash Flow Outflow logged!`,
        });
        setShowPaymentModal(false);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to record supplier payment.' });
    } finally {
      setIsSubmittingPay(false);
    }
  };

  const filteredSuppliers = suppliers.filter((s) => {
    const q = searchTerm.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.kraPin && s.kraPin.toLowerCase().includes(q)) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
      (s.phone && s.phone.includes(q))
    );
  });

  const totalOutstandingToSuppliers = suppliers.reduce((sum, s) => sum + (s.currentBalance || 0), 0);
  const activeSuppliersCount = suppliers.filter((s) => s.status === 'Active').length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900/90 border border-slate-800 p-6 rounded-2xl shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Truck className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-black text-slate-100 tracking-tight">Suppliers & OMCs</h1>
          </div>
          <p className="text-xs text-slate-400">
            Manage Oil Marketing Companies (OMCs), wholesale fuel suppliers, credit balances, and payout ledgers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {canManageSuppliers && (
            <button
              onClick={openNewSupplierModal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all shadow-lg shadow-emerald-950/40 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Register Oil Supplier / OMC
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs font-semibold ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Suppliers Owed</div>
          <div className="text-2xl font-black text-rose-400 font-mono mt-2">
            KES {totalOutstandingToSuppliers.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Total unpaid balance across registered OMCs</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Active OMC Accounts</div>
          <div className="text-2xl font-black text-slate-100 font-mono mt-2">{activeSuppliersCount}</div>
          <p className="text-[11px] text-emerald-400 mt-1">Authorized wholesale fuel distributors</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Fuel Deliveries Logged</div>
          <div className="text-2xl font-black text-emerald-400 font-mono mt-2">{deliveries.length}</div>
          <p className="text-[11px] text-slate-400 mt-1">Tank refilling events recorded in system</p>
        </div>
      </div>

      {/* Navigation Sub-Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('directory')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'directory'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Supplier Directory ({suppliers.length})
          </button>
          <button
            onClick={() => setActiveTab('deliveries')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'deliveries'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Truck className="w-4 h-4" />
            Delivery History ({deliveries.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search supplier, Tax PIN, phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Directory Tab */}
      {activeTab === 'directory' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredSuppliers.map((sup) => (
            <div key={sup.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 hover:border-slate-700 transition-all">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-emerald-400" />
                    <h3 className="font-bold text-slate-100 text-base">{sup.name}</h3>
                  </div>
                  {sup.kraPin && (
                    <span className="text-[11px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      Tax PIN: {sup.kraPin}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    sup.status === 'Active'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {sup.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-950/60 rounded-xl p-3 border border-slate-800 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Contact Person</span>
                  <p className="font-semibold text-slate-200">{sup.contactPerson || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Phone / Email</span>
                  <p className="font-semibold text-slate-200">{sup.phone}</p>
                  {sup.email && <p className="text-[10px] text-slate-400 truncate">{sup.email}</p>}
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Payment Terms</span>
                  <p className="font-semibold text-slate-200">{sup.paymentTerms || 'Net 14 Days'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Outstanding Balance</span>
                  <p className={`font-mono font-extrabold ${sup.currentBalance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    KES {sup.currentBalance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {sup.address && (
                <p className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                  <span className="text-slate-500 font-bold">Depot/Address:</span> {sup.address}
                </p>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                {canRecordPayment && (
                  <button
                    onClick={() => openPaymentModal(sup)}
                    className="flex-1 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-bold text-xs rounded-xl transition-all border border-emerald-500/30 flex items-center justify-center gap-2"
                  >
                    <CreditCard className="w-4 h-4" />
                    Record Supplier Payout
                  </button>
                )}
                {canManageSuppliers && (
                  <button
                    onClick={() => openEditSupplierModal(sup)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-xl transition-all border border-slate-700"
                  >
                    Edit Account
                  </button>
                )}
                {canDeleteSupplier && <button onClick={() => setSupplierToDelete(sup)} className="px-3 py-2 text-xs font-bold text-rose-300 hover:text-rose-200">Delete</button>}
              </div>
            </div>
          ))}

          {filteredSuppliers.length === 0 && (
            <div className="col-span-full bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
              <Truck className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="text-slate-200 font-bold text-base">No Suppliers Found</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                No oil marketing suppliers match your search criteria. Click 'Register Oil Supplier / OMC' to add suppliers.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Deliveries Tab */}
      {activeTab === 'deliveries' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-400" />
              Logged Wholesale Fuel Deliveries
            </h3>
            <span className="text-xs font-mono text-slate-400">{deliveries.length} Records</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Delivery Note #</th>
                  <th className="py-3 px-4">Supplier / OMC</th>
                  <th className="py-3 px-4">Storage Tank</th>
                  <th className="py-3 px-4 text-right">Liters Delivered</th>
                  <th className="py-3 px-4 text-right">Cost / Liter</th>
                  <th className="py-3 px-4 text-right">Total Cost (KES)</th>
                  <th className="py-3 px-4">Driver / Truck</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {deliveries.map((del) => (
                  <tr key={del.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">{new Date(del.timestamp).toLocaleString()}</td>
                    <td className="py-3 px-4 font-bold text-emerald-400">{del.deliveryNoteNo}</td>
                    <td className="py-3 px-4 font-semibold text-slate-200">{del.supplierName}</td>
                    <td className="py-3 px-4 text-slate-300">{del.tankName}</td>
                    <td className="py-3 px-4 text-right font-bold text-slate-100">{del.litersReceived.toLocaleString()} L</td>
                    <td className="py-3 px-4 text-right text-slate-400">KES {del.costPerLiter.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-400">
                      KES {del.totalCost.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-sans text-[11px]">
                      {del.driverName} ({del.truckPlate})
                    </td>
                  </tr>
                ))}

                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                      No wholesale fuel deliveries recorded yet. Record deliveries in the 'Pumps & Tanks' tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Supplier Register/Edit Modal */}
      {showSupplierModal && (
        <div className="fms-dialog-overlay z-50">
          <div className="fms-dialog w-full max-w-lg overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-slate-100 text-base">
                  {editingSupplier ? 'Edit Supplier Profile' : 'Register Wholesale Fuel Supplier'}
                </h3>
              </div>
              <button onClick={() => setShowSupplierModal(false)} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSupplierSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-bold mb-1">Company / OMC Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vivo Energy Kenya PLC (Shell)"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Key Contact Person</label>
                  <input
                    type="text"
                    placeholder="e.g. Peter Kamau (Key Accounts)"
                    value={supContact}
                    onChange={(e) => setSupContact(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Phone Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="+254700100200"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Tax PIN Number</label>
                  <input
                    type="text"
                    placeholder="P051019284K"
                    value={supKraPin}
                    onChange={(e) => setSupKraPin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Email Address</label>
                  <input
                    type="email"
                    placeholder="orders@vivoenergy.com"
                    value={supEmail}
                    onChange={(e) => setSupEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Payment Credit Terms</label>
                  <select
                    value={supPaymentTerms}
                    onChange={(e) => setSupPaymentTerms(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                  >
                    <option value="Cash on Delivery">Cash on Delivery</option>
                    <option value="Net 7 Days">Net 7 Days</option>
                    <option value="Net 14 Days">Net 14 Days</option>
                    <option value="Net 30 Days">Net 30 Days</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Account Status</label>
                  <select
                    value={supStatus}
                    onChange={(e) => setSupStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Depot / Office Physical Address</label>
                <input
                  type="text"
                  placeholder="e.g. Industrial Area Depot, Enterprise Road, Nairobi"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSup}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all flex items-center gap-2"
                >
                  {isSubmittingSup ? 'Saving...' : 'Save Supplier Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Supplier Payout Modal */}
      {showPaymentModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-slate-100 text-base">Record Supplier Payout: {selectedSupplier.name}</h3>
              </div>
              <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePaymentSubmit} className="p-6 space-y-4 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono">
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Current Outstanding Owed:</span>
                  <span className="text-rose-400 font-bold">
                    KES {selectedSupplier.currentBalance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Payment Amount (KES) *</label>
                <input
                  type="number"
                  min={1}
                  max={selectedSupplier.currentBalance}
                  required
                  value={payAmount}
                  onChange={(e) => {
                    const nextValue = Number(e.target.value) || 0;
                    setPayAmount(Math.min(nextValue, selectedSupplier.currentBalance));
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold text-base focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Payment Method</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                  >
                    <option value="Bank Transfer">Bank Transfer (EFT/RTGS)</option>
                    <option value="M-Pesa">M-Pesa Paybill / Till</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Bank Cheque</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1">Reference / EFT #</label>
                  <input
                    type="text"
                    value={payRefNo}
                    onChange={(e) => setPayRefNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Delivery Note # (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. DN-2026-9921"
                  value={payDeliveryNote}
                  onChange={(e) => setPayDeliveryNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Notes / Remittance Description</label>
                <input
                  type="text"
                  placeholder="Part payment for 30,000L Super Petrol supply"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPay}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all flex items-center gap-2"
                >
                  {isSubmittingPay ? 'Processing...' : 'Confirm Supplier Payout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <AppDialog open={Boolean(supplierToDelete)} kind="delete" title="Delete supplier" message={`Delete ${supplierToDelete?.name || 'this supplier'}? Suppliers with deliveries, payments, or balances are protected.`} busy={deletingSupplier} onClose={() => setSupplierToDelete(null)} onConfirm={deleteSupplier} />
    </div>
  );
};
