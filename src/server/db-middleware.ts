/**
 * Database integration middleware for Express server
 * Converts all API endpoints to use persistent database storage
 */

import {
  userQueries,
  productQueries,
  tankQueries,
  pumpQueries,
  nozzleReadingQueries,
  shopItemQueries,
  shiftQueries,
  transactionQueries,
  customerQueries,
  supplierQueries,
  deliveryQueries,
  stockAdjustmentQueries,
  cashFlowQueries,
  reconciliationQueries,
  approvalQueries,
  settingsQueries,
  auditLogQueries,
  creditNoteQueries,
  supplierPaymentQueries,
  scheduleQueries,
  initializeDatabaseIfNeeded,
} from '../database/index.js';

import type {
  User,
  FuelProduct,
  FuelTank,
  PumpNozzle,
  ShopItem,
  ShiftSession,
  Transaction,
  AuditLog,
} from '../types.js';

/**
 * Initialize database and return functions to access data
 */
export function initializeDatabaseMiddleware() {
  // Initialize database on startup
  initializeDatabaseIfNeeded();

  return {
    userQueries,
    productQueries,
    tankQueries,
    pumpQueries,
    nozzleReadingQueries,
    shopItemQueries,
    shiftQueries,
    transactionQueries,
    customerQueries,
    supplierQueries,
    deliveryQueries,
    stockAdjustmentQueries,
    cashFlowQueries,
    reconciliationQueries,
    approvalQueries,
    settingsQueries,
    auditLogQueries,
    creditNoteQueries,
    supplierPaymentQueries,
    scheduleQueries,

    /**
     * Helper to add audit logs
     */
    addAuditLog: (
      userId: string,
      userName: string,
      userRole: string,
      action: string,
      module: 'Auth' | 'Sales' | 'Shifts' | 'Reconciliation' | 'Tanks' | 'Shop' | 'Approvals' | 'Settings' | 'Suppliers' | 'Stock' | 'Automation',
      details: string,
      severity: 'Info' | 'Warning' | 'Critical' = 'Info'
    ) => {
      if (!action.trim()) throw new Error('Audit action is required.');
      if (!details.trim()) throw new Error(`Audit details are required for ${action}.`);

      const validUserIds = new Set((userQueries.all() ?? []).map((user) => user.id));
      const safeUserId = userId && validUserIds.has(userId) ? userId : null;
      const log = {
        id: 'log-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        userId: safeUserId,
        userName: userName || 'System',
        userRole: userRole || 'Admin',
        action,
        module,
        details,
        ipAddress: '127.0.0.1',
        severity,
      };
      auditLogQueries.create(log as any);
      return log;
    },

    /**
     * Get all data (for API response)
     */
    getAllData: () => {
      return {
        users: userQueries.all(),
        products: productQueries.all(),
        tanks: tankQueries.all(),
        pumps: pumpQueries.all(),
        nozzleReadings: nozzleReadingQueries.all(),
        shopItems: shopItemQueries.all(),
        shifts: shiftQueries.all(),
        schedules: scheduleQueries.all(),
        transactions: transactionQueries.all(),
        customers: customerQueries.all(),
        suppliers: supplierQueries.all(),
        supplierPayments: supplierPaymentQueries.all(),
        deliveries: deliveryQueries.all(),
        creditNotes: creditNoteQueries.all(),
        cashFlow: cashFlowQueries.all(),
        reconciliations: reconciliationQueries.all(),
        approvals: approvalQueries.all(),
        auditLogs: auditLogQueries.all(),
        stockAdjustments: stockAdjustmentQueries.all(),
        settings: settingsQueries.get(),
      };
    },
  };
}

export type DatabaseMiddleware = ReturnType<typeof initializeDatabaseMiddleware>;
