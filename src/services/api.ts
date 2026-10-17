import {
  User,
  ShopItem,
  ShiftSession,
  Transaction,
  ThreeWayReconciliation,
  AuditLog,
  ShiftSchedule,
  ShiftPlan,
  StationSettings,
  CustomerAccount,
  CashFlowRecord,
  CreditNote,
  SupplierAccount,
  SupplierPayment,
  StockAdjustment,
  Permission,
} from '../types';
import type { DashboardSalesSummary } from '../utils/sales-summary';
import { fetchApi } from '../shared/api/http-client';
import { managerApprovalsApi } from '../features/manager-approvals/api/manager-approvals.api';
import { pumpsAndTanksApi } from '../features/pumps-tanks/api/pumps-and-tanks.api';
import {
  INITIAL_USERS,
  INITIAL_SHOP_ITEMS,
  INITIAL_SHIFTS,
  INITIAL_SCHEDULES,
  INITIAL_TRANSACTIONS,
  INITIAL_AUDIT_LOGS,
  INITIAL_STATION_SETTINGS,
  INITIAL_CREDIT_NOTES,
  INITIAL_CUSTOMERS,
  INITIAL_CASH_FLOW,
  INITIAL_SUPPLIERS,
  INITIAL_STOCK_ADJUSTMENTS,
} from '../data/initialData';

export const api = {
  // Compatibility facade: physical asset code imports pumpsAndTanksApi directly.
  getTankEvidence: pumpsAndTanksApi.getTankEvidence,
  createManualDip: pumpsAndTanksApi.createManualDip,
  getBootstrapStatus: () => fetchApi<{ hasUsers: boolean }>('/api/auth/bootstrap-status'),

  getStatus: () => fetchApi<{ status: string; activeShiftsCount: number; pendingApprovalsCount: number; totalSalesToday: number }>('/api/status'),

  getDashboardSummary: () => fetchApi<DashboardSalesSummary>('/api/dashboard-summary'),

  verifyPin: (identifier: string, pin: string, requiredRoles?: string[]) =>
    fetchApi<{ success: boolean; user: User }>('/api/auth/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ identifier, pin, requiredRoles }),
    }),

  logout: () => fetchApi<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  getCurrentUser: () =>
  fetchApi<{ authenticated: boolean; user?: User }>('/api/auth/me'),

  changePin: (currentPin: string, newPin: string) => fetchApi<{ success: boolean }>('/api/auth/change-pin', {
    method: 'POST',
    body: JSON.stringify({ currentPin, newPin }),
  }),

  getUsers: (actorUserId?: string, actorRole?: string) => {
    const qs = new URLSearchParams();
    if (actorUserId) qs.set('actorUserId', actorUserId);
    if (actorRole) qs.set('actorRole', actorRole);
    return fetchApi<User[]>(`/api/users${qs.toString() ? `?${qs.toString()}` : ''}`, undefined, INITIAL_USERS);
  },

  createUser: (user: Partial<User>, actorUserId?: string, actorRole?: string) =>
    fetchApi<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ ...user, actorUserId, actorRole }),
    }),

  updateUser: (userId: string, user: Partial<User>, actorUserId?: string, actorRole?: string) =>
    fetchApi<User>(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...user, actorUserId, actorRole }),
    }),

  resetUserPin: (userId: string, newPin: string, actorUserId?: string, actorRole?: string) =>
    fetchApi<User>(`/api/users/${userId}/reset-pin`, {
      method: 'POST',
      body: JSON.stringify({ newPin, actorUserId, actorRole }),
    }),

  toggleUserStatus: (userId: string, status: 'Active' | 'Inactive' | 'Suspended', actorUserId?: string, actorRole?: string) =>
    fetchApi<User>(`/api/users/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, actorUserId, actorRole }),
    }),

  deleteUser: (userId: string, actorUserId?: string, actorRole?: string) =>
    fetchApi<{ success: boolean }>(`/api/users/${userId}`, {
      method: 'DELETE',
      body: JSON.stringify({ actorUserId, actorRole }),
    }),

  getUserPermissions: (userId: string) =>
    fetchApi<{ userId: string; permissions: Permission[] }>(`/api/users/${userId}/permissions`),

  updateUserPermissions: (userId: string, permissions: Permission[]) =>
    fetchApi<{ userId: string; permissions: Permission[] }>(`/api/users/${userId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
  getRoles: () => fetchApi<any[]>('/api/roles'),
  createRole: (role: { name:string;description:string;permissions:Permission[] }) => fetchApi<any>('/api/roles',{method:'POST',body:JSON.stringify(role)}),
  updateRole: (id:string,role:{name:string;description:string;status:'ACTIVE'|'INACTIVE';permissions:Permission[]}) => fetchApi<any>(`/api/roles/${id}`,{method:'PUT',body:JSON.stringify(role)}),
  deleteRole: (id:string) => fetchApi<{success:boolean}>(`/api/roles/${id}`,{method:'DELETE'}),

  // Compatibility facade: callers migrate to pumpsAndTanksApi by feature.
  getTanks: pumpsAndTanksApi.getTanks,
  registerTank: (tankData: any, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.registerTank(tankData, { userId, userName, userRole }),
  deleteTank: (tankId: string, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.deleteTank(tankId, { userId, userName, userRole }),
  recordDip: (tankId: string, dipReadingLiters: number, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.recordInitialDip(tankId, dipReadingLiters, { userId, userName, userRole }),
  getDeliveries: pumpsAndTanksApi.getDeliveries,
  addDelivery: pumpsAndTanksApi.addDelivery,
  getPumps: pumpsAndTanksApi.getPumps,
  getPumpUnits: pumpsAndTanksApi.getPumpUnits,
  registerPump: (pumpData: any, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.registerPump(pumpData, { userId, userName, userRole }),
  deletePump: (pumpId: string, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.deletePump(pumpId, { userId, userName, userRole }),
  deletePumpUnit: (pumpUnitId: string, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.deletePumpUnit(pumpUnitId, { userId, userName, userRole }),
  getProducts: pumpsAndTanksApi.getProducts,
  updateProductPrice: (productId: string, newPrice: number, taxCode?: string, productName?: string, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.updateProductPrice(productId, newPrice, taxCode, productName, { userId, userName, userRole }),
  updateFuelProduct: (productId: string, productData: any, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.updateFuelProduct(productId, productData, { userId, userName, userRole }),
  deleteFuelProduct: (productId: string, userId?: string, userName?: string, userRole?: string) => pumpsAndTanksApi.deleteFuelProduct(productId, { userId, userName, userRole }),
  getSettings: () => fetchApi<StationSettings>('/api/settings', undefined, INITIAL_STATION_SETTINGS),

  updateSettings: (settings: Partial<StationSettings>, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<StationSettings>('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings, userId, userName, userRole }),
    }),

  getCustomers: () => fetchApi<CustomerAccount[]>('/api/customers', undefined, INITIAL_CUSTOMERS),

  saveCustomer: (customerData: any, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<CustomerAccount>('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ ...customerData, userId, userName, userRole }),
    }),
  deleteCustomer: (customerId: string) => fetchApi<{ success: boolean }>(`/api/customers/${customerId}`, { method: 'DELETE' }),

  recordDebtRepayment: (repaymentData: any, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<{ customer: CustomerAccount; cashFlow: CashFlowRecord }>('/api/customers/repayment', {
      method: 'POST',
      body: JSON.stringify({ ...repaymentData, userId, userName, userRole }),
    }),

  getCashFlow: () => fetchApi<CashFlowRecord[]>('/api/cash-flow', undefined, INITIAL_CASH_FLOW),

  recordCashFlow: (data: any, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<CashFlowRecord>('/api/cash-flow', {
      method: 'POST',
      body: JSON.stringify({ ...data, userId, userName, userRole }),
    }),

  getCreditNotes: () => fetchApi<CreditNote[]>('/api/credit-notes', undefined, INITIAL_CREDIT_NOTES),

  issueCreditNote: (data: any) =>
    fetchApi<CreditNote>('/api/credit-notes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getShopItems: () => fetchApi<ShopItem[]>('/api/shop', undefined, INITIAL_SHOP_ITEMS),

  registerShopItem: (itemData: any, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<ShopItem>('/api/shop', {
      method: 'POST',
      body: JSON.stringify({ ...itemData, userId, userName, userRole }),
    }),

  updateShopItem: (itemId: string, itemData: Partial<ShopItem>, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<ShopItem>(`/api/shop/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...itemData, userId, userName, userRole }),
    }),

  deleteShopItem: (itemId: string, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<{ success: boolean; deletedItem: ShopItem }>(`/api/shop/${itemId}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId, userName, userRole }),
    }),

  uploadShopItemsBulk: (items: any[], userId?: string, userName?: string, userRole?: string) =>
    fetchApi<{ message: string; items: ShopItem[] }>('/api/shop/bulk', {
      method: 'POST',
      body: JSON.stringify({ items, userId, userName, userRole }),
    }),

  adjustShopStock: (itemId: string, newQty: number, reason: string, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<ShopItem>('/api/shop/adjust', {
      method: 'POST',
      body: JSON.stringify({ itemId, newQty, reason, userId, userName, userRole }),
    }),

  getSales: () => fetchApi<Transaction[]>('/api/sales', undefined, []),

  settleAutomationSale: (transactionId: string, paymentMethod: string, paymentReference?: string) =>
    fetchApi<Transaction>(`/api/sales/${transactionId}/settle`, {
      method: 'POST',
      body: JSON.stringify({ paymentMethod, paymentReference }),
    }),

  processSale: (saleData: any) =>
    fetchApi<Transaction>('/api/sales', {
      method: 'POST',
      body: JSON.stringify(saleData),
    }),

  getShifts: () => fetchApi<ShiftSession[]>('/api/shifts', undefined, []),

  getSchedules: () => fetchApi<ShiftSchedule[]>('/api/schedules', undefined, INITIAL_SCHEDULES),

  getShiftPlans: () => fetchApi<ShiftPlan[]>('/api/shift-plans', undefined, []),

  createShiftPlan: (data: { name: string; shiftType: string; scheduledStart?: string; scheduledEnd?: string; userIds: string[]; scheduleType?: 'one-time' | 'recurring'; recurrenceStartDate?: string; recurrenceEndDate?: string; recurrenceWeekdays?: number[]; startTime?: string; endTime?: string }) =>
    fetchApi<ShiftPlan>('/api/shift-plans', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  assignShiftPlanUser: (shiftPlanId: string, userId: string) =>
    fetchApi<ShiftPlan>(`/api/shift-plans/${shiftPlanId}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  removeShiftPlanUser: (shiftPlanId: string, userId: string) =>
    fetchApi<ShiftPlan>(`/api/shift-plans/${shiftPlanId}/assignments/${userId}`, {
      method: 'DELETE',
    }),

  assignSchedule: (scheduleData: any) =>
    fetchApi<ShiftSchedule>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    }),

  deleteSchedule: (scheduleId: string) =>
    fetchApi<{ success: boolean }>('/api/schedules/' + scheduleId, {
      method: 'DELETE',
    }),

  clockIn: (
    userId: string,
    pin: string,
    shiftType: string,
    openingCash: number,
    openingPumpReadings?: any[],
    openingTankDips?: any[],
    shiftPlanId?: string
  ) =>
    fetchApi<ShiftSession>('/api/shifts/clock-in', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        pin,
        shiftType,
        openingCash,
        openingPumpReadings,
        openingTankDips,
        shiftPlanId,
      }),
    }),

  getReconciliations: () => fetchApi<ThreeWayReconciliation[]>('/api/reconciliations', undefined, []),

  submitReconciliation: (data: any) =>
    fetchApi<{ reconciliation: ThreeWayReconciliation; shift: ShiftSession }>('/api/reconciliations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Compatibility facade: feature-owned code imports managerApprovalsApi directly.
  getApprovals: managerApprovalsApi.getAll,
  resolveApproval: managerApprovalsApi.resolve,
  resolveApprovals: managerApprovalsApi.resolveMany,

  getAuditLogs: async () => {
    const page = await fetchApi<{ records: AuditLog[] }>('/api/audit-logs?page=1&pageSize=100', undefined, { records: INITIAL_AUDIT_LOGS });
    return page.records;
  },

  getAuditLogPage: (page = 1, pageSize = 15, filters?: { search?: string; module?: string; severity?: string }) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters?.search) query.set('search', filters.search);
    if (filters?.module && filters.module !== 'All') query.set('module', filters.module);
    if (filters?.severity && filters.severity !== 'All') query.set('severity', filters.severity);
    return fetchApi<{ records: AuditLog[]; page: number; pageSize: number; total: number; totalPages: number }>(`/api/audit-logs?${query}`);
  },

  getSuppliers: () => fetchApi<SupplierAccount[]>('/api/suppliers', undefined, INITIAL_SUPPLIERS),

  saveSupplier: (supplierData: any, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<SupplierAccount>('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify({ ...supplierData, userId, userName, userRole }),
    }),
  deleteSupplier: (supplierId: string) => fetchApi<{ success: boolean }>(`/api/suppliers/${supplierId}`, { method: 'DELETE' }),

  recordSupplierPayment: (paymentData: any, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<{ supplier: SupplierAccount; payment: SupplierPayment; cashFlow: CashFlowRecord }>('/api/suppliers/payment', {
      method: 'POST',
      body: JSON.stringify({ ...paymentData, userId, userName, userRole }),
    }),

  getStockAdjustments: async () => {
    const page = await fetchApi<{ records: StockAdjustment[] }>('/api/stock/adjustments?page=1&pageSize=100', undefined, { records: INITIAL_STOCK_ADJUSTMENTS });
    return page.records;
  },

  getStockAdjustmentPage: (page = 1, pageSize = 15) =>
    fetchApi<{ records: StockAdjustment[]; page: number; pageSize: number; total: number; totalPages: number }>(`/api/stock/adjustments?page=${page}&pageSize=${pageSize}`),

  recordStockAdjustment: (adjustmentData: any, userId?: string, userName?: string, userRole?: string) =>
    fetchApi<StockAdjustment>('/api/stock/adjustments', {
      method: 'POST',
      body: JSON.stringify({ ...adjustmentData, userId, userName, userRole }),
    }),

};
