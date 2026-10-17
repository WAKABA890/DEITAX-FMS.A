import React, { useState, useMemo } from 'react';
import {
  Landmark,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  CreditCard,
  Building2,
  Wallet,
  Receipt,
  Search,
  Filter,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { CashFlowRecord, User, Transaction, CreditNote } from '../types';
import { PaginationControls, usePagination } from './PaginationControls';
import { usePermissions } from '../hooks/usePermissions';

interface CashFlowLedgerProps {
  cashFlow: CashFlowRecord[];
  transactions?: Transaction[];
  creditNotes?: CreditNote[];
  currentUser: User;
  onRecordCashFlow: (data: any) => Promise<any>;
}

const resolveDocumentKind = (tx: Pick<Transaction, 'documentType' | 'taxInvoiceNo' | 'receiptNo'>) => {
  if (tx.documentType === 'Invoice') return 'Invoice';
  if (tx.documentType === 'Receipt') return 'Receipt';
  if (tx.taxInvoiceNo) return 'Invoice';
  if (tx.receiptNo) return 'Receipt';
  return 'Receipt';
};

export const CashFlowLedger: React.FC<CashFlowLedgerProps> = ({
  cashFlow = [],
  transactions = [],
  creditNotes = [],
  currentUser,
  onRecordCashFlow,
}) => {
  const { hasPermission } = usePermissions(currentUser);
  const canManageCashFlow = hasPermission('MANAGE_CASH_FLOW');

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Inflow' | 'Outflow'>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'Inflow' | 'Outflow'>('Outflow');
  const [amount, setAmount] = useState<number>(0);
  const [category, setCategory] = useState<string>('Station Maintenance');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'M-Pesa' | 'Bank Transfer' | 'Card'>('Cash');
  const [referenceNo, setReferenceNo] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ----- 1. Helper: convert credit note to a CashFlowRecord (OUTFLOW) -----
  const creditNoteToCashFlow = (cn: CreditNote): CashFlowRecord => ({
    id: cn.id,
    timestamp: cn.timestamp,
    type: 'Outflow',
    category: 'Credit Note',
    amount: cn.totalAmount,
    paymentMethod: 'Credit',
    referenceNo: cn.creditNoteNo,
    description: cn.reason || `Credit note issued against ${cn.originalDocumentNo || 'unknown document'}`,
    recordedBy: cn.issuedBy || 'System',
  });

  // ----- 2. Merge manual cashFlow + credit notes (exclude voided) -----
  const allRecords = useMemo(() => {
    const manual = cashFlow.filter(Boolean);
    const creditRecords = creditNotes
      .filter((cn) => cn.status !== 'Voided')
      .map(creditNoteToCashFlow);
    return [...manual, ...creditRecords];
  }, [cashFlow, creditNotes]);

  // ----- 3. Categories for filter – include 'Credit Note' if any exist -----
  const categories = useMemo(() => {
    const base = Array.from(new Set(cashFlow.map((c) => c.category).filter(Boolean)));
    if (creditNotes.some((cn) => cn.status !== 'Voided')) {
      return [...base, 'Credit Note'];
    }
    return base;
  }, [cashFlow, creditNotes]);

  // ----- 4. Financial Summary (unchanged; creditNotes are already included in totalOutflows) -----
  const creditNoteOutflow = creditNotes
    .filter((note) => note.status !== 'Voided')
    .reduce((sum, note) => sum + (note.totalAmount || 0), 0);

  const manualInflows = cashFlow
    .filter((c) => c.type === 'Inflow')
    .reduce((sum, c) => sum + (c.amount || 0), 0);

  const manualOutflows = cashFlow
    .filter((c) => c.type === 'Outflow')
    .reduce((sum, c) => sum + (c.amount || 0), 0);

  const totalInflows = manualInflows;
  const totalOutflows = manualOutflows + creditNoteOutflow;
  const netCashFlow = totalInflows - totalOutflows;

  // Channel breakdown (unchanged)
  const cashIn = cashFlow.filter((c) => c.type === 'Inflow' && c.paymentMethod === 'Cash').reduce((s, c) => s + c.amount, 0);
  const mpesaIn = cashFlow.filter((c) => c.type === 'Inflow' && c.paymentMethod === 'M-Pesa').reduce((s, c) => s + c.amount, 0);
  const bankIn = cashFlow.filter((c) => c.type === 'Inflow' && c.paymentMethod === 'Bank Transfer').reduce((s, c) => s + c.amount, 0);
  const cardIn = cashFlow.filter((c) => c.type === 'Inflow' && c.paymentMethod === 'Card').reduce((s, c) => s + c.amount, 0);

  // ----- 5. Filter and paginate using allRecords (now includes credit notes) -----
  const filteredRecords = allRecords.filter((rec) => {
    const matchesSearch =
      (rec.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.referenceNo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.category || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.recordedBy || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = typeFilter === 'All' || rec.type === typeFilter;
    const matchesCategory = categoryFilter === 'All' || rec.category === categoryFilter;

    return matchesSearch && matchesType && matchesCategory;
  });

  const cashFlowPagination = usePagination(
    filteredRecords,
    `${searchTerm}|${typeFilter}|${categoryFilter}`
  );

  // ----- 6. Form submission handler (unchanged) -----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0 || !description) return;
    setIsSubmitting(true);
    try {
      await onRecordCashFlow({
        type: modalType,
        category,
        amount,
        paymentMethod,
        referenceNo: referenceNo || `REF-${Math.floor(100000 + Math.random() * 900000)}`,
        description,
      });
      setShowModal(false);
      setAmount(0);
      setDescription('');
      setReferenceNo('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ----- 7. Render (table now uses cashFlowPagination.pageItems) -----
  return (
    <div className="space-y-6 pb-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-emerald-400" />
            Cash Flow & Accounts
          </h2>
          <p className="text-xs text-slate-400">
            Real-time tracking of fuel/shop revenues, customer credit repayments, fuel tanker payments, and operational expenses.
          </p>
        </div>

        {canManageCashFlow && (
          <button
            onClick={() => {
              setModalType('Outflow');
              setShowModal(true);
            }}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Log Inflow / Expense Entry
          </button>
        )}
      </div>

      {/* KPI Cards (unchanged) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Total Cash Inflow</span>
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            KES {totalInflows.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-400">Invoices / receipts + cash inflow entries</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Total Cash Outflow</span>
            <div className="p-2 bg-rose-500/10 text-rose-400 rounded-xl">
              <ArrowDownRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-rose-400 font-mono">
            KES {totalOutflows.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-400">Credit notes + operational outflows</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Net Cash Position</span>
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-2xl font-black font-mono ${netCashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            KES {netCashFlow.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-400">Net surplus logged in system</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Inflows Channel Breakdown</span>
            <div className="p-2 bg-purple-500/10 text-purple-400 rounded-xl">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between text-slate-300">
              <span className="text-slate-400">Cash:</span>
              <span className="font-bold">KES {cashIn.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span className="text-slate-400">M-Pesa:</span>
              <span className="font-bold">KES {mpesaIn.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-blue-400">
              <span className="text-slate-400">Bank / Card:</span>
              <span className="font-bold">KES {(bankIn + cardIn).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cash Flow Ledger Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        {/* Filters and Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Search reference, description, staff..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
              {(['All', 'Inflow', 'Outflow'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    typeFilter === t ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="All">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3.5">Timestamp</th>
                <th className="p-3.5">Flow Type</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5">Amount (KES)</th>
                <th className="p-3.5">Method</th>
                <th className="p-3.5">Reference No</th>
                <th className="p-3.5">Description</th>
                <th className="p-3.5">Logged By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
              {cashFlowPagination.pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 italic">
                    No cash flow records found matching criteria.
                  </td>
                </tr>
              ) : (
                cashFlowPagination.pageItems.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3.5 text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(rec.timestamp).toLocaleString('en-KE')}
                    </td>
                    <td className="p-3.5 font-sans">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          rec.type === 'Inflow'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {rec.type === 'Inflow' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {rec.type}
                      </span>
                    </td>
                    <td className="p-3.5 font-semibold text-slate-300 font-sans">{rec.category}</td>
                    <td className={`p-3.5 font-bold text-sm ${rec.type === 'Inflow' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {rec.type === 'Inflow' ? '+' : '-'} KES {(rec.amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 font-sans text-slate-300">{rec.paymentMethod}</td>
                    <td className="p-3.5 text-slate-400 font-bold text-[11px]">{rec.referenceNo || '—'}</td>
                    <td className="p-3.5 font-sans text-slate-300 max-w-xs truncate" title={rec.description}>
                      {rec.description}
                    </td>
                    <td className="p-3.5 font-sans text-slate-400">{rec.recordedBy}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={cashFlowPagination.currentPage}
          totalPages={cashFlowPagination.totalPages}
          itemCount={filteredRecords.length}
          onPageChange={cashFlowPagination.setCurrentPage}
        />
      </div>

      {/* New Cash Flow Modal (unchanged) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Landmark className="w-5 h-5 text-emerald-400" />
                Record Cash Flow Transaction
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Transaction Type</label>
                  <select
                    value={modalType}
                    onChange={(e) => setModalType(e.target.value as 'Inflow' | 'Outflow')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-semibold focus:outline-none"
                  >
                    <option value="Inflow">Inflow (Money Received)</option>
                    <option value="Outflow">Outflow (Expense / Payment)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-semibold focus:outline-none"
                  >
                    <option value="Cash">Cash</option>
                    <option value="M-Pesa">M-Pesa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Card">Card POS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-semibold focus:outline-none"
                >
                  {modalType === 'Outflow' ? (
                    <>
                      <option value="Station Maintenance">Station Maintenance & Repairs</option>
                      <option value="Electricity & Water">Electricity & Utility Bills</option>
                      <option value="Generator Diesel">Generator Diesel Fuel</option>
                      <option value="Staff Expenses">Staff Expenses & Petty Cash</option>
                      <option value="Bank Cash Drop">Bank Cash Drop / Deposit</option>
                      <option value="Supplier Payment">Supplier Payment</option>
                      <option value="Other Expense">Other Expense</option>
                    </>
                  ) : (
                    <>
                      <option value="Debt Repayment">Customer Debt Repayment</option>
                      <option value="Fuel Sales">Fuel Sales Inflow</option>
                      <option value="Shop Sales">Shop Sales Inflow</option>
                      <option value="Misc Receipt">Misc Cash Receipt</option>
                    </>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Amount (KES)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={amount || ''}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 font-mono text-sm font-bold text-emerald-400 focus:outline-none"
                    placeholder="e.g. 5000"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Ref / Receipt No</label>
                  <input
                    type="text"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
                    placeholder="e.g. MP92019X / BK-881"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Description / Notes</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  placeholder="e.g. Paid KPLC tokens for station pumps"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl disabled:opacity-50"
                >
                  {isSubmitting ? 'Recording...' : 'Save Cash Flow Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};