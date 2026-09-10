import React from 'react';
import {
  Fuel,
  LayoutDashboard,
  ShoppingCart,
  Clock,
  Gauge,
  Scale,
  ShieldCheck,
  Package,
  FileSpreadsheet,
  BarChart3,
  UserCheck,
  Lock,
  Flame,
  CheckCircle2,
  LogOut,
} from 'lucide-react';
import { User } from '../types';
import logo from '../assets/deities-logo.svg';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  activeShiftsCount: number;
  pendingApprovalsCount: number;
  todaySalesTotal: number;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  activeShiftsCount = 0,
  pendingApprovalsCount = 0,
  todaySalesTotal,
  onLogout,
}) => {
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false);

  const cancelLogout = () => setShowLogoutConfirm(false);

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'pos', label: 'Point of Sale (POS)', icon: ShoppingCart },
    { id: 'shifts', label: 'Shift & Clock-In', icon: Clock, badge: activeShiftsCount > 0 ? activeShiftsCount : undefined },
    { id: 'pumps', label: 'Pumps & Tanks', icon: Gauge },
    { id: 'reconciliation', label: '3-Way Match', icon: Scale },
    { id: 'approvals', label: 'Manager Approvals', icon: ShieldCheck, badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined, badgeColor: 'bg-rose-500' },
    { id: 'shop', label: 'Shop Inventory', icon: Package },
    { id: 'audit', label: 'Audit Trail & Logs', icon: FileSpreadsheet },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
  ];

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-40 shadow-xl">
      {/* Top Banner Ticker */}
      <div className="bg-slate-950 px-4 py-1.5 border-b border-slate-800/80 text-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-slate-400">
          <div className="flex items-center gap-2 font-bold text-emerald-400 tracking-wider">
            <Fuel className="w-4 h-4 text-emerald-500 animate-pulse" />
            <span>Deitax FMS 2.0</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 text-[11px]">
            <CheckCircle2 className="w-3 h-3" />
            <span></span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="text-slate-500">TODAY'S SALES:</span>
            <span className="font-bold text-emerald-400">KES {todaySalesTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="text-slate-500">ACTIVE STAFF:</span>
            <span className="font-bold text-amber-400">{activeShiftsCount} On Shift</span>
          </div>
          {pendingApprovalsCount > 0 && (
            <div className="flex items-center gap-1.5 bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/30 animate-pulse">
              <span className="font-bold">{pendingApprovalsCount} Approvals Pending</span>
            </div>
          )}

        </div>
      </div>

      {/* Main Bar */}
      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Brand Title */}
        <div className="flex items-center gap-3 justify-start">
          <img
            src={logo}
            alt="Deitax FMS 2.0"
            className="block h-[48px] w-[48px] object-contain"
          />
          <div className="leading-none">
            <div className="text-base font-black tracking-tight text-slate-100">Deitax</div>
            <div className="text-[12px] font-semibold tracking-[0.22em] text-slate-300 uppercase">FMS 2.0</div>
          </div>
        </div>

        {/* Authenticated User */}
        <div className="flex items-center gap-3 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800 self-start md:self-auto">
          <div className="flex items-center gap-2 px-2.5 py-1">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs">
              {currentUser.name.charAt(0)}
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <span>{currentUser.name}</span>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                <span className="capitalize">{currentUser.role}</span>
                {currentUser.currentShiftId && (
                  <span className="text-amber-400 font-medium">● Clocked In</span>
                )}
              </div>
            </div>

            <button
              onClick={() => setShowLogoutConfirm(true)}
              title="Logout"
              aria-label="Logout"
              className="ml-2 p-1.5 rounded-lg text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

      {/* Module Tabs Nav */}
      <div className="px-4 border-t border-slate-800/60 overflow-x-auto scrollbar-none flex gap-1 pt-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition-all rounded-t-lg ${
                isActive
                  ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>{t.label}</span>
              {t.badge && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold text-white shadow-sm ${
                    t.badgeColor || 'bg-emerald-600'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancelLogout();
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">

            <h2 id="logout-confirm-title" className="text-xl font-bold text-gray-900">
              Confirm Logout
            </h2>

            <p className="mt-3 text-gray-600">
              Are you sure you want to logout, {currentUser.name}?
            </p>

            <div className="mt-6 flex justify-end gap-3">

              <button
                onClick={cancelLogout}
                autoFocus
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition hover:bg-gray-100"
              >
                Cancel
              </button>

              <button
                onClick={confirmLogout}
                className="rounded-lg bg-red-600 px-4 py-2 text-white transition hover:bg-red-700"
              >
                Logout
              </button>

            </div>
          </div>
        </div>
      )}
    </header>
  );
};