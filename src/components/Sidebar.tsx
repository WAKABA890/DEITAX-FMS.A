import React, { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Clock,
  Gauge,
  Scale,
  ShieldCheck,
  Package,
  FileSpreadsheet,
  BarChart3,
  Receipt,
  Settings,
  Menu,
  X,
  Landmark,
  Truck,
  Users,
  Cable,
  GitMerge,
  RadioTower,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { User as UserType } from '../types';
import { usePermissions } from '../hooks/usePermissions';
import logo from '../assets/deities-logo.svg';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserType;
  activeShiftsCount: number;
  pendingApprovalsCount: number;
  todaySalesTotal: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  activeShiftsCount = 0,
  pendingApprovalsCount = 0,
  todaySalesTotal = 0,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const {
    canViewUsers,
    canViewInvoices,
    canViewShop,
    canViewStock,
    canViewPumps,
    canViewApprovals,
    canViewSettings,
    canViewSuppliers,
    canViewCashFlow,
    canViewThreeWayLedger,
    canViewAudit,
    canViewReports,
    canViewShiftUsers,
    canViewAutomation,
    canViewDeviceMappings,
    hasPermission,
  } = usePermissions(currentUser);

  const displayName = currentUser?.name?.trim() || 'Unknown User';
  const displayRole = currentUser?.role || 'Admin';
  const displayInitial = displayName.charAt(0).toUpperCase() || 'U';
  const formatCurrency = (value: number | null | undefined) => {
    const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('en-KE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeValue);
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'pos', label: 'Point of Sale (POS)', icon: ShoppingCart },
    ...(canViewShiftUsers
      ? [
          {
            id: 'shifts',
            label: 'Shift & Clock-In',
            icon: Clock,
            badge: activeShiftsCount > 0 ? activeShiftsCount : undefined,
            badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
          },
        ]
      : []),
    ...(canViewInvoices ? [{ id: 'invoices', label: 'Invoices, Receipts & Debt', icon: Receipt }] : []),
    ...(canViewCashFlow ? [{ id: 'cashflow', label: 'Cash Flow & Accounts', icon: Landmark }] : []),
    ...(canViewSuppliers ? [{ id: 'suppliers', label: 'Suppliers & OMCs', icon: Truck }] : []),
    ...(canViewStock ? [{ id: 'stock', label: 'Stock & Inventory Audit', icon: Package }] : []),
    ...(canViewPumps ? [{ id: 'pumps', label: 'Pumps & Tanks', icon: Gauge }] : []),
    ...(canViewAutomation ? [{ id: 'controllers', label: 'Controllers & Integrations', icon: Cable }] : []),
    ...(canViewAutomation ? [{ id: 'live-forecourt', label: 'Live Forecourt', icon: RadioTower }] : []),
    ...(canViewAutomation ? [{ id: 'meters', label: 'Meters & Totalizers', icon: Activity }] : []),
    ...(hasPermission('VIEW_ATG_TANK_MONITORING') ? [{ id: 'atg', label: 'ATG & Tank Monitoring', icon: Gauge }] : []),
    ...(hasPermission('VIEW_RECONCILIATION') ? [{ id: 'automation-reconciliation', label: 'Automation Reconciliation', icon: Scale }] : []),
    ...(hasPermission('VIEW_ALERTS') ? [{ id: 'alerts', label: 'Alerts', icon: AlertTriangle }] : []),
    ...(canViewDeviceMappings ? [{ id: 'device-mappings', label: 'Device Mappings', icon: GitMerge }] : []),
    ...(canViewThreeWayLedger ? [{ id: 'reconciliation', label: '3-Way Match Ledger', icon: Scale }] : []),
    ...(canViewApprovals
      ? [
          {
            id: 'approvals',
            label: 'Manager Approvals',
            icon: ShieldCheck,
            badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
            badgeColor: 'bg-rose-500 text-white font-bold animate-pulse',
          },
        ]
      : []),
    ...(canViewShop ? [{ id: 'shop', label: 'Shop Retail Items', icon: Package }] : []),
    ...(canViewUsers ? [{ id: 'users', label: 'Users', icon: Users }] : []),
    ...(canViewSettings ? [{ id: 'settings', label: 'Invoice Headers & Settings', icon: Settings }] : []),
    ...(canViewAudit ? [{ id: 'audit', label: 'Audit Trail & Logs', icon: FileSpreadsheet }] : []),
    ...(canViewReports ? [{ id: 'reports', label: 'Reports & Analytics', icon: BarChart3 }] : []),
  ];

  return (
    <>
      {/* Mobile Top Header */}
      <div className="md:hidden bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between text-slate-100 sticky top-0 z-30 shadow-lg">
        <div className="flex h-[48px] w-[140px] items-center justify-center">
          <img src={logo} alt="DEITAX FMS.A" className="block h-full w-full object-contain" />
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700"
          aria-label="Toggle Sidebar Navigation"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Backdrop overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Main Left Navigation Sidebar */}
      <aside
        className={`fms-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col justify-between border-r transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } shadow-[0_20px_60px_rgba(59,130,246,0.15)] md:shadow-none h-screen backdrop-blur-md`}
      >
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Brand Header */}
          <div className="fms-sidebar-brand px-3 py-4 border-b">
            <div className="flex items-center justify-start gap-3 pl-2">
              <img src={logo} alt="DEITAX FMS.A" className="block h-12 w-12 object-contain flex-shrink-0" />
              <div className="leading-none">
                <div className="text-[15px] font-black tracking-tight text-slate-100">DEITAX</div>
                <div className="text-[13px] font-semibold tracking-[0.18em] text-slate-300 uppercase">FMS.A</div>
              </div>
            </div>
          </div>

          {/* Active User Context */}
          <div className="fms-sidebar-user-context p-4 border-b">
            <div className="space-y-3">
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Active Terminal User
              </label>

              <div className="fms-sidebar-user-card flex flex-col gap-2.5 p-3 rounded-xl border transition-colors w-full">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="fms-sidebar-avatar w-9 h-9 rounded-lg border flex items-center justify-center font-bold text-xs flex-shrink-0">
                    {displayInitial}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-200 truncate whitespace-nowrap overflow-hidden">
                      {displayName}
                    </p>
                    <p className="text-[10px] text-slate-400 capitalize flex items-center gap-1 truncate whitespace-nowrap overflow-hidden min-w-0">
                      <span className="truncate whitespace-nowrap overflow-hidden">{displayRole}</span>
                      {currentUser?.currentShiftId && (
                        <span className="text-red-300 font-medium flex-shrink-0">● Shift Active</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="fms-sidebar-nav p-3 space-y-1 flex-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-500 tracking-wider">
              Main Modules
            </div>

            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsOpen(false);
                  }}
                  className={`fms-sidebar-item w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                    isActive
                      ? 'fms-sidebar-active border font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-300' : 'text-slate-400'}`} />
                    <span className="truncate">{tab.label}</span>
                  </div>

                  {tab.badge !== undefined && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        tab.badgeColor || 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Bottom Station Status Widget */}
          <div className="fms-sidebar-footer p-4 border-t space-y-3">
            <div className="bg-slate-900 p-3 rounded-xl border border-slate-800/90 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Today's Sales</span>
                <span className="font-bold text-blue-300">KES {formatCurrency(todaySalesTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Staff On Shift</span>
                <span className="font-bold text-red-300">{Number(activeShiftsCount ?? 0)} Active</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
