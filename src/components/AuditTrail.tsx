import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, Search, Download, ShieldCheck, AlertTriangle } from 'lucide-react';
import { AuditLog } from '../types';
import { PaginationControls } from './PaginationControls';
import { api } from '../services/api';

interface AuditTrailProps {
  logs: AuditLog[];
}

export const AuditTrail: React.FC<AuditTrailProps> = ({ logs = [] }) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('All');
  const [moduleFilter, setModuleFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [remoteLogs, setRemoteLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(logs.length);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    api.getAuditLogPage(page, 15, { search: searchTerm.trim(), module: moduleFilter, severity: severityFilter })
      .then((result) => {
        if (cancelled) return;
        setRemoteLogs(result.records);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setRemoteLogs([]);
          setTotal(0);
          setTotalPages(0);
          setLoadError(error.message || 'Unable to load audit logs.');
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [page, searchTerm, severityFilter, moduleFilter]);

  useEffect(() => { setPage(1); }, [searchTerm, severityFilter, moduleFilter]);

  const filteredLogs = remoteLogs;

  const exportCSV = () => {
    const headers = ['Timestamp', 'User', 'Role', 'Action', 'Module', 'Severity', 'Details'];
    const rows = filteredLogs.map((l) => [
      l.timestamp,
      `"${l.userName}"`,
      l.userRole,
      l.action,
      l.module,
      l.severity,
      `"${l.details.replace(/"/g, '""')}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `dtfms_audit_log_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `dtfms_audit_log_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
            Universal Immutable Audit Trail & System Logs
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Complete tamper-proof record of every sale, clock-in, price change, dip reading, and manager approval.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all border border-slate-700 flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            Export CSV
          </button>
          <button
            onClick={exportJSON}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all border border-slate-700 flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-blue-400" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search audit details, staff name, or action keyword..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 focus:outline-none"
          />
        </div>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
        >
          <option value="All">All Severities</option>
          <option value="Info">Info</option>
          <option value="Warning">Warning</option>
          <option value="Critical">Critical</option>
        </select>

        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
        >
          <option value="All">All Modules</option>
          <option value="Sales">Sales</option>
          <option value="Shifts">Shifts</option>
          <option value="Reconciliation">Reconciliation</option>
          <option value="Tanks">Tanks</option>
          <option value="Shop">Shop</option>
          <option value="Approvals">Approvals</option>
          <option value="Settings">Settings</option>
          <option value="Automation">Automation</option>
        </select>
      </div>

      {/* Audit Log Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Module</th>
                <th className="py-3 px-4">Details</th>
                <th className="py-3 px-4 text-center">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {!isLoading && !loadError && filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-850/50">
                  <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-200 whitespace-nowrap">
                    <div>{log.userName}</div>
                    <div className="text-[10px] text-slate-500 font-sans">{log.userRole}</div>
                  </td>
                  <td className="py-3 px-4 font-bold text-emerald-400 whitespace-nowrap">{log.action}</td>
                  <td className="py-3 px-4 text-slate-400 whitespace-nowrap">{log.module}</td>
                  <td className="py-3 px-4 text-slate-200 font-sans max-w-md">{log.details}</td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                        log.severity === 'Critical'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : log.severity === 'Warning'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/10 text-emerald-400'
                      }`}
                    >
                      {log.severity}
                    </span>
                  </td>
                </tr>
              ))}
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center font-sans text-slate-400">Loading logs...</td></tr>
              )}
              {loadError && (
                <tr><td colSpan={6} className="px-4 py-8 text-center font-sans text-rose-300">Unable to load audit logs.</td></tr>
              )}
              {!isLoading && !loadError && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-sans text-slate-500">
                    No audit records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          itemCount={total}
          pageSize={15}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
};
