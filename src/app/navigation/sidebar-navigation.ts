import type { ElementType } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cable,
  Clock,
  FileSpreadsheet,
  Gauge,
  GitMerge,
  Landmark,
  Package,
  RadioTower,
  Receipt,
  Scale,
  ShieldCheck,
  ShoppingCart,
  LayoutDashboard,
  Settings,
  Truck,
  Users,
} from 'lucide-react';

export interface SidebarNavigationCapabilities {
  canViewUsers: boolean;
  canViewInvoices: boolean;
  canViewShop: boolean;
  canViewStock: boolean;
  canViewPumps: boolean;
  canViewApprovals: boolean;
  canViewSettings: boolean;
  canViewSuppliers: boolean;
  canViewCashFlow: boolean;
  canViewThreeWayLedger: boolean;
  canViewAudit: boolean;
  canViewReports: boolean;
  canViewShiftUsers: boolean;
  canViewAutomation: boolean;
  canViewDeviceMappings: boolean;
  hasPermission: (permission: string) => boolean;
}

export interface SidebarNavigationMetrics {
  activeShiftsCount: number;
  pendingApprovalsCount: number;
}

export interface SidebarTab {
  id: string;
  label: string;
  icon: ElementType;
  badge?: number;
  badgeColor?: string;
}

export interface SidebarGroup {
  label: string;
  tabs: SidebarTab[];
}

/**
 * The single module order and label source for the sidebar.
 * Permission checks stay in the caller so this metadata remains view-only.
 */
export function createSidebarNavigationGroups(
  capabilities: SidebarNavigationCapabilities,
  metrics: SidebarNavigationMetrics
): SidebarGroup[] {
  const {
    canViewUsers, canViewInvoices, canViewShop, canViewStock, canViewPumps,
    canViewApprovals, canViewSettings, canViewSuppliers, canViewCashFlow,
    canViewThreeWayLedger, canViewAudit, canViewReports, canViewShiftUsers,
    canViewAutomation, canViewDeviceMappings, hasPermission,
  } = capabilities;
  const { activeShiftsCount, pendingApprovalsCount } = metrics;

  return [
    {
      label: 'OPERATIONS',
      tabs: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'pos', label: 'Point of Sale (POS)', icon: ShoppingCart },
        ...(canViewShiftUsers ? [{
          id: 'shifts', label: 'Shift & Clock-In', icon: Clock,
          badge: activeShiftsCount > 0 ? activeShiftsCount : undefined,
          badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        }] : []),
        ...(canViewPumps ? [{ id: 'pumps', label: 'Pumps & Tanks', icon: Gauge }] : []),
        ...(canViewShop ? [{ id: 'shop', label: 'Shop Retail Items', icon: Package }] : []),
        ...(canViewInvoices ? [{ id: 'invoices', label: 'Invoices & Receipts', icon: Receipt }] : []),
      ],
    },
    {
      label: 'FINANCE & RECONCILIATION',
      tabs: [
        ...(canViewCashFlow ? [{ id: 'cashflow', label: 'Cash Flow & Accounts', icon: Landmark }] : []),
        ...(canViewSuppliers ? [{ id: 'suppliers', label: 'Suppliers & OMCs', icon: Truck }] : []),
        ...(canViewInvoices ? [{ id: 'customers', label: 'Customers', icon: Users }] : []),
        ...(canViewThreeWayLedger ? [{ id: 'reconciliation', label: '3-Way Match Ledger', icon: Scale }] : []),
        ...(hasPermission('VIEW_RECONCILIATION') ? [{ id: 'automation-reconciliation', label: 'Automation Reconciliation', icon: Scale }] : []),
        ...(canViewApprovals ? [{
          id: 'approvals', label: 'Manager Approvals', icon: ShieldCheck,
          badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
          badgeColor: 'bg-rose-500 text-white font-bold animate-pulse',
        }] : []),
      ],
    },
    {
      label: 'AUTOMATION & INTEGRATIONS',
      tabs: [
        ...(canViewAutomation ? [{ id: 'controllers', label: 'Controllers & Integrations', icon: Cable }] : []),
        ...(canViewAutomation ? [{ id: 'live-forecourt', label: 'Live Forecourt', icon: RadioTower }] : []),
        ...(canViewAutomation ? [{ id: 'meters', label: 'Meters & Totalizers', icon: Activity }] : []),
        ...(canViewDeviceMappings ? [{ id: 'device-mappings', label: 'Device Mappings', icon: GitMerge }] : []),
        ...(hasPermission('VIEW_ALERTS') ? [{ id: 'alerts', label: 'Alerts', icon: AlertTriangle }] : []),
      ],
    },
    {
      label: 'INVENTORY',
      tabs: [...(canViewStock ? [{ id: 'stock', label: 'Stock & Inventory Audit', icon: Package }] : [])],
    },
    {
      label: 'REPORTING & CONTROL',
      tabs: [
        ...(canViewReports ? [{ id: 'reports', label: 'Reports & Analytics', icon: BarChart3 }] : []),
        ...(canViewAudit ? [{ id: 'audit', label: 'Audit Trail & Logs', icon: FileSpreadsheet }] : []),
      ],
    },
    {
      label: 'ADMINISTRATION',
      tabs: [
        ...(canViewUsers ? [{ id: 'users', label: 'Users', icon: Users }] : []),
        ...(canViewSettings ? [{ id: 'settings', label: 'Invoice Headers & Settings', icon: Settings }] : []),
      ],
    },
  ];
}
