import { useMemo } from 'react';
import { User, Permission, isAdmin, isSuperAdmin } from '../types';

export const usePermissions = (user: User | null) => {
  return useMemo(() => {
    const defaultResult = {
      hasPermission: (_permission: Permission): boolean => false,

      isSuperAdmin: false,
      isAdmin: false,

      // ============================================================
      // VIEW PERMISSIONS
      // ============================================================

      canViewUsers: false,
      canViewInvoices: false,
      canViewShop: false,
      canViewStock: false,
      canViewPumps: false,
      canViewApprovals: false,
      canViewSettings: false,
      canViewSuppliers: false,
      canViewCashFlow: false,
      canViewThreeWayLedger: false,
      canViewAudit: false,
      canViewReports: false,
      canViewShiftUsers: false,
      canViewDipVariance: false,
      canViewAutomation: false,
      canViewAutomationLogs: false,
      canViewDeviceMappings: false,

      // ============================================================
      // SHIFT ACTIONS
      // ============================================================

      canCreateShift: false,
      canEditShift: false,
      canAssignShiftUsers: false,
      canRemoveShiftUsers: false,
      canClockInOtherUsers: false,
      canManageShift: false,

      // ============================================================
      // USER ACTIONS
      // ============================================================

      canCreateUser: false,
      canManageUsers: false,
      canResetUserPassword: false,

      // ============================================================
      // SHOP / STOCK – GRANULAR PERMISSIONS
      // ============================================================

      canCreateShopItem: false,        // for Register Item
      canUpdateShopItem: false,        // for Edit
      canDeleteShopItem: false,        // for Delete
      canBulkUploadShopItems: false,   // for Upload Excel
      canAdjustStock: false,           // for Adjust Stock
      canEditPrice: false,
      canManageStock: false,           // composite (adjust + edit price)

      // Composite for any shop‑related action (legacy support)
      canManageShop: false,

      // ============================================================
      // PUMPS / TANKS
      // ============================================================

      canManagePumps: false,
      canManageTanks: false,
      canDeletePump: false,

      // ============================================================
      // DIP VARIANCE
      // ============================================================

      canReviewDipVariance: false,
      canResolveDipVariance: false,

      // ============================================================
      // SUPPLIERS
      // ============================================================

      canManageSuppliers: false,
      canRecordSupplierPayout: false,

      // ============================================================
      // CASH FLOW / RECONCILIATION
      // ============================================================

      canManageCashFlow: false,
      canManageThreeWayLedger: false,

      // ============================================================
      // CREDIT
      // ============================================================

      canCreateCreditNote: false,
      canManageCreditCustomers: false,
      canRecordCreditPayment: false,

      // ============================================================
      // ADMINISTRATION
      // ============================================================

      canManageApprovals: false,
      canManageSettings: false,
      canManageControllers: false,
      canManageDeviceMappings: false,
    };

    if (!user) {
      return defaultResult;
    }

    const superAdmin = isSuperAdmin(user.role);
    const admin = isAdmin(user.role);

    const permissions = user.permissions ?? [];

    /**
     * Only Super Admin bypasses permissions. Admin/custom roles require grants,
     * matching server-side authorization exactly.
     */
    const hasPermission = (permission: Permission): boolean => {
      if (superAdmin) {
        return true;
      }
      return permissions.includes(permission);
    };

    return {
      hasPermission,

      isSuperAdmin: superAdmin,
      isAdmin: admin,

      // ============================================================
      // VIEW PERMISSIONS
      // ============================================================

      canViewUsers: hasPermission('VIEW_USERS'),
      canViewInvoices: hasPermission('VIEW_INVOICES'),
      canViewShop: hasPermission('VIEW_SHOP'),
      canViewStock: hasPermission('VIEW_STOCK'),
      canViewPumps: hasPermission('VIEW_PUMPS'),
      canViewApprovals: hasPermission('VIEW_APPROVALS'),
      canViewSettings: hasPermission('VIEW_SETTINGS'),
      canViewSuppliers: hasPermission('VIEW_SUPPLIERS'),
      canViewCashFlow: hasPermission('VIEW_CASH_FLOW'),
      canViewThreeWayLedger: hasPermission('VIEW_THREE_WAY_LEDGER'),
      canViewAudit: hasPermission('VIEW_AUDIT_TRAIL'),
      canViewReports: hasPermission('VIEW_REPORTS'),
      canViewShiftUsers: hasPermission('VIEW_SHIFT_USERS'),
      canViewDipVariance: hasPermission('VIEW_DIP_VARIANCE'),
      canViewAutomation: hasPermission('VIEW_AUTOMATION'),
      canViewAutomationLogs: hasPermission('VIEW_AUTOMATION_LOGS'),
      canViewDeviceMappings: hasPermission('VIEW_DEVICE_MAPPINGS'),

      // ============================================================
      // SHIFT ACTIONS
      // ============================================================

      canCreateShift: hasPermission('CREATE_SHIFT'),
      canEditShift: hasPermission('EDIT_SHIFT'),
      canAssignShiftUsers: hasPermission('ASSIGN_SHIFT_USERS'),
      canRemoveShiftUsers: hasPermission('REMOVE_SHIFT_USERS'),
      canClockInOtherUsers: hasPermission('CLOCK_IN_OTHER_USERS'),

      canManageShift:
        hasPermission('CREATE_SHIFT') ||
        hasPermission('EDIT_SHIFT') ||
        hasPermission('ASSIGN_SHIFT_USERS') ||
        hasPermission('REMOVE_SHIFT_USERS') ||
        hasPermission('CLOCK_IN_OTHER_USERS'),

      // ============================================================
      // USER ACTIONS
      // ============================================================

      canCreateUser: hasPermission('CREATE_USER'),
      canManageUsers: hasPermission('MANAGE_USERS'),
      canResetUserPassword: hasPermission('RESET_USER_PASSWORD'),

      // ============================================================
      // SHOP / STOCK – GRANULAR PERMISSIONS
      // ============================================================

      canCreateShopItem: hasPermission('CREATE_SHOP_ITEM'),
      canUpdateShopItem: hasPermission('UPDATE_SHOP_ITEM'),
      canDeleteShopItem: hasPermission('DELETE_SHOP_ITEM'),
      canBulkUploadShopItems: hasPermission('BULK_UPLOAD_SHOP_ITEMS'),
      canAdjustStock: hasPermission('ADJUST_STOCK'),
      canEditPrice: hasPermission('EDIT_PRICE'),

      canManageStock:
        hasPermission('ADJUST_STOCK') ||
        hasPermission('EDIT_PRICE'),

      // Composite: true if the user has ANY granular shop action
      canManageShop:
        hasPermission('CREATE_SHOP_ITEM') ||
        hasPermission('UPDATE_SHOP_ITEM') ||
        hasPermission('DELETE_SHOP_ITEM') ||
        hasPermission('BULK_UPLOAD_SHOP_ITEMS') ||
        hasPermission('MANAGE_SHOP_ITEMS') ||   // legacy fallback
        hasPermission('ADJUST_STOCK'),          // stock adjustment is also a shop action

      // ============================================================
      // PUMPS / TANKS
      // ============================================================

      canManagePumps: hasPermission('MANAGE_PUMPS'),
      canManageTanks: hasPermission('MANAGE_PUMPS'), // linked until separate permission is added
      canDeletePump: hasPermission('DELETE_PUMP'),

      // ============================================================
      // DIP VARIANCE
      // ============================================================

      canReviewDipVariance: hasPermission('REVIEW_DIP_VARIANCE'),
      canResolveDipVariance: hasPermission('RESOLVE_DIP_VARIANCE'),

      // ============================================================
      // SUPPLIERS
      // ============================================================

      canManageSuppliers: hasPermission('MANAGE_SUPPLIERS'),
      canRecordSupplierPayout: hasPermission('RECORD_SUPPLIER_PAYOUT'),

      // ============================================================
      // CASH FLOW / RECONCILIATION
      // ============================================================

      canManageCashFlow: hasPermission('MANAGE_CASH_FLOW'),
      canManageThreeWayLedger: hasPermission('MANAGE_THREE_WAY_LEDGER'),

      // ============================================================
      // CREDIT
      // ============================================================

      canCreateCreditNote: hasPermission('CREATE_CREDIT_NOTE'),
      canManageCreditCustomers: hasPermission('MANAGE_CREDIT_CUSTOMERS'),
      canRecordCreditPayment: hasPermission('RECORD_CREDIT_PAYMENT'),

      // ============================================================
      // ADMINISTRATION
      // ============================================================

      canManageApprovals: hasPermission('MANAGE_APPROVALS'),
      canManageSettings: hasPermission('MANAGE_SETTINGS'),
      canManageControllers: hasPermission('MANAGE_CONTROLLERS'),
      canManageDeviceMappings: hasPermission('MANAGE_DEVICE_MAPPINGS'),
    };
  }, [user]);
};
