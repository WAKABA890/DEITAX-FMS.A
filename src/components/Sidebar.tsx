import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { User as UserType } from '../types';
import { usePermissions } from '../hooks/usePermissions';
import { createSidebarNavigationGroups } from '../app/navigation/sidebar-navigation';
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

  const navigationGroups = createSidebarNavigationGroups(
    {
      canViewUsers, canViewInvoices, canViewShop, canViewStock, canViewPumps,
      canViewApprovals, canViewSettings, canViewSuppliers, canViewCashFlow,
      canViewThreeWayLedger, canViewAudit, canViewReports, canViewShiftUsers,
      canViewAutomation, canViewDeviceMappings, hasPermission,
    },
    { activeShiftsCount, pendingApprovalsCount }
  );

  const sidebarClass = 'fms-sidebar fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col justify-between border-r shadow-[0_20px_60px_rgba(59,130,246,0.15)] backdrop-blur-md transition-transform duration-300 ease-in-out md:shadow-none ' +
    (isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0');

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900 p-4 text-slate-100 shadow-lg md:hidden">
        <div className="flex h-[48px] w-[140px] items-center justify-center">
          <img src={logo} alt="DEITAX FMS.A" className="block h-full w-full object-contain" />
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white"
          aria-label="Toggle Sidebar Navigation"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside className={sidebarClass}>
        <div className="flex h-full flex-col overflow-y-auto">
          <div className="fms-sidebar-brand border-b px-3 py-4">
            <div className="flex items-center justify-start gap-3 pl-2">
              <img src={logo} alt="DEITAX FMS.A" className="block h-12 w-12 shrink-0 object-contain" />
              <div className="leading-none">
                <div className="text-[15px] font-black tracking-tight text-slate-100">DEITAX</div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.18em] text-slate-300">FMS.A</div>
              </div>
            </div>
          </div>

          <div className="fms-sidebar-user-context border-b p-4">
            <div className="space-y-3">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Active Terminal User
              </label>
              <div className="fms-sidebar-user-card flex w-full flex-col gap-2.5 rounded-xl border p-3 transition-colors">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="fms-sidebar-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-bold">
                    {displayInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate whitespace-nowrap overflow-hidden text-xs font-semibold text-slate-200">
                      {displayName}
                    </p>
                    <p className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap overflow-hidden text-[10px] capitalize text-slate-400">
                      <span className="truncate whitespace-nowrap overflow-hidden">{displayRole}</span>
                      {currentUser?.currentShiftId && <span className="shrink-0 font-medium text-red-300">* Shift Active</span>}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <nav className="fms-sidebar-nav flex-1 space-y-1 p-3" aria-label="Primary navigation">
            {navigationGroups.map((group) => (
              group.tabs.length > 0 ? (
                <section key={group.label} className="space-y-1 pb-3">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </div>
                  {group.tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setIsOpen(false);
                        }}
                        className={'fms-sidebar-item flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-xs font-medium transition-all ' +
                          (isActive ? 'fms-sidebar-active border font-semibold' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white')}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Icon className={'h-4 w-4 shrink-0 ' + (isActive ? 'text-blue-300' : 'text-slate-400')} />
                          <span className="truncate">{tab.label}</span>
                        </div>
                        {tab.badge !== undefined && (
                          <span className={'rounded-full border px-2 py-0.5 text-[10px] font-semibold ' +
                            (tab.badgeColor || 'border-amber-500/30 bg-amber-500/20 text-amber-300')}>
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </section>
              ) : null
            ))}
          </nav>

          <div className="fms-sidebar-footer space-y-3 border-t p-4">
            <div className="space-y-2 rounded-xl border border-slate-800/90 bg-slate-900 p-3">
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
};
