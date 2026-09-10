import { eq, desc, and, gt, lt, gte, lte, like, inArray } from 'drizzle-orm';
import { getDatabase } from './db.js';
import * as schema from './schema.js';
import { User, Transaction, AuditLog } from '../types.js';

/**
 * User queries
 */
export const userQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.users).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  },

  byEmail: (email: string) => {
    const db = getDatabase();
    return db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  },

  active: () => {
    const db = getDatabase();
    return db.select().from(schema.users).where(eq(schema.users.active, true)).all();
  },

  create: (user: Partial<User>) => {
    const db = getDatabase();
    return db.insert(schema.users).values(user as any).run();
  },

  update: (id: string, data: Partial<User>) => {
    const db = getDatabase();
    return (db.update(schema.users) as any).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.users.id, id)).run();
  },

  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.users).where(eq(schema.users.id, id)).run();
  },
};

/**
 * Fuel Product queries
 */
export const productQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.fuelProducts).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.fuelProducts).where(eq(schema.fuelProducts.id, id)).get();
  },

  byCode: (code: string) => {
    const db = getDatabase();
    return db.select().from(schema.fuelProducts).where(eq(schema.fuelProducts.code, code)).get();
  },

  create: (product: typeof schema.fuelProducts.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.fuelProducts).values(product).run();
  },

  update: (id: string, data: Partial<typeof schema.fuelProducts.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.fuelProducts).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.fuelProducts.id, id)).run();
  },

  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.fuelProducts).where(eq(schema.fuelProducts.id, id)).run();
  },
};

/**
 * Fuel Tank queries
 */
export const tankQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.fuelTanks).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.fuelTanks).where(eq(schema.fuelTanks.id, id)).get();
  },

  create: (tank: typeof schema.fuelTanks.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.fuelTanks).values(tank).run();
  },

  update: (id: string, data: Partial<typeof schema.fuelTanks.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.fuelTanks).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.fuelTanks.id, id)).run();
  },

  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.fuelTanks).where(eq(schema.fuelTanks.id, id)).run();
  },
};

/**
 * Pump queries
 */
export const pumpQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.pumpNozzles).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.pumpNozzles).where(eq(schema.pumpNozzles.id, id)).get();
  },

  byTankId: (tankId: string) => {
    const db = getDatabase();
    return db.select().from(schema.pumpNozzles).where(eq(schema.pumpNozzles.tankId, tankId)).all();
  },

  findByPhysicalPumpAndNumber: (physicalPumpId: string, nozzleNumber: number) => {
    const db = getDatabase();
    return db.select().from(schema.pumpNozzles).where(and(
      eq(schema.pumpNozzles.physicalPumpId, physicalPumpId),
      eq(schema.pumpNozzles.nozzleNumber, nozzleNumber)
    )).get();
  },

  create: (pump: typeof schema.pumpNozzles.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.pumpNozzles).values(pump).run();
  },

  update: (id: string, data: Partial<typeof schema.pumpNozzles.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.pumpNozzles).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.pumpNozzles.id, id)).run();
  },

  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.pumpNozzles).where(eq(schema.pumpNozzles.id, id)).run();
  },
};

export const nozzleReadingQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.nozzleReadingHistory).orderBy(desc(schema.nozzleReadingHistory.timestamp)).all();
  },

  byNozzleId: (nozzleId: string) => {
    const db = getDatabase();
    return db.select().from(schema.nozzleReadingHistory).where(eq(schema.nozzleReadingHistory.nozzleId, nozzleId)).orderBy(desc(schema.nozzleReadingHistory.timestamp)).all();
  },

  create: (record: typeof schema.nozzleReadingHistory.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.nozzleReadingHistory).values(record).run();
  },
};

/**
 * Shop Item queries
 */
export const shopItemQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.shopItems).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.shopItems).where(eq(schema.shopItems.id, id)).get();
  },

  byCode: (code: string) => {
    const db = getDatabase();
    return db.select().from(schema.shopItems).where(eq(schema.shopItems.code, code)).get();
  },

  byCategory: (category: string) => {
    const db = getDatabase();
    return db.select().from(schema.shopItems).where(eq(schema.shopItems.category, category)).all();
  },

  create: (item: typeof schema.shopItems.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.shopItems).values(item).run();
  },

  update: (id: string, data: Partial<typeof schema.shopItems.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.shopItems).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.shopItems.id, id)).run();
  },

  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.shopItems).where(eq(schema.shopItems.id, id)).run();
  },
};

/**
 * Shift queries
 */
export const shiftQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.shifts).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).get();
  },

  byStaffId: (staffId: string) => {
    const db = getDatabase();
    return db.select().from(schema.shifts).where(eq(schema.shifts.staffId, staffId)).all();
  },

  active: () => {
    const db = getDatabase();
    return db.select().from(schema.shifts).where(eq(schema.shifts.status, 'Active')).all();
  },

  byDate: (date: string) => {
    const db = getDatabase();
    return db.select().from(schema.shifts).where(eq(schema.shifts.date, date)).all();
  },

  create: (shift: typeof schema.shifts.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.shifts).values(shift).run();
  },

  update: (id: string, data: Partial<typeof schema.shifts.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.shifts).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.shifts.id, id)).run();
  },
};

/**
 * Transaction queries
 */
export const transactionQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.transactions).orderBy(desc(schema.transactions.createdAt)).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
  },

  byReceiptNumber: (receiptNumber: string) => {
    const db = getDatabase();
    return db.select().from(schema.transactions).where(eq(schema.transactions.receiptNumber, receiptNumber)).get();
  },

  byDate: (date: string) => {
    const db = getDatabase();
    return db.select().from(schema.transactions).where(eq(schema.transactions.date, date)).all();
  },

  byShiftId: (shiftId: string) => {
    const db = getDatabase();
    return db.select().from(schema.transactions).where(eq(schema.transactions.shiftId, shiftId)).all();
  },

  byCustomerId: (customerId: string) => {
    const db = getDatabase();
    return db.select().from(schema.transactions).where(eq(schema.transactions.customerId, customerId)).all();
  },

  completed: () => {
    const db = getDatabase();
    return db.select().from(schema.transactions).where(eq(schema.transactions.status, 'Completed')).all();
  },

  create: (transaction: typeof schema.transactions.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.transactions).values(transaction).run();
  },

  update: (id: string, data: Partial<typeof schema.transactions.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.transactions).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.transactions.id, id)).run();
  },
};

/**
 * Customer queries
 */
export const customerQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.customers).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
  },

  active: () => {
    const db = getDatabase();
    return db.select().from(schema.customers).where(eq(schema.customers.status, 'Active')).all();
  },

  create: (customer: typeof schema.customers.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.customers).values(customer).run();
  },

  update: (id: string, data: Partial<typeof schema.customers.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.customers).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.customers.id, id)).run();
  },
  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.customers).where(eq(schema.customers.id, id)).run();
  },
};

/**
 * Supplier queries
 */
export const supplierQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.suppliers).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id)).get();
  },

  active: () => {
    const db = getDatabase();
    return db.select().from(schema.suppliers).where(eq(schema.suppliers.status, 'Active')).all();
  },

  create: (supplier: typeof schema.suppliers.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.suppliers).values(supplier).run();
  },

  update: (id: string, data: Partial<typeof schema.suppliers.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.suppliers).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.suppliers.id, id)).run();
  },
  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.suppliers).where(eq(schema.suppliers.id, id)).run();
  },
};

/**
 * Fuel Delivery queries
 */
export const deliveryQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.fuelDeliveries).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.fuelDeliveries).where(eq(schema.fuelDeliveries.id, id)).get();
  },

  bySupplierId: (supplierId: string) => {
    const db = getDatabase();
    return db.select().from(schema.fuelDeliveries).where(eq(schema.fuelDeliveries.supplierId, supplierId)).all();
  },

  byTankId: (tankId: string) => {
    const db = getDatabase();
    return db.select().from(schema.fuelDeliveries).where(eq(schema.fuelDeliveries.tankId, tankId)).all();
  },

  create: (delivery: typeof schema.fuelDeliveries.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.fuelDeliveries).values(delivery).run();
  },

  update: (id: string, data: Partial<typeof schema.fuelDeliveries.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.fuelDeliveries).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.fuelDeliveries.id, id)).run();
  },
};

/**
 * Stock Adjustment queries
 */
export const stockAdjustmentQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.stockAdjustments).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.stockAdjustments).where(eq(schema.stockAdjustments.id, id)).get();
  },

  byReferenceId: (referenceId: string) => {
    const db = getDatabase();
    return db.select().from(schema.stockAdjustments).where(eq(schema.stockAdjustments.referenceId, referenceId)).all();
  },

  create: (adjustment: typeof schema.stockAdjustments.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.stockAdjustments).values(adjustment).run();
  },
};

/**
 * Cash Flow queries
 */
export const cashFlowQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.cashFlowRecords).orderBy(desc(schema.cashFlowRecords.date)).all();
  },

  byDate: (date: string) => {
    const db = getDatabase();
    return db.select().from(schema.cashFlowRecords).where(eq(schema.cashFlowRecords.date, date)).all();
  },

  byType: (type: string) => {
    const db = getDatabase();
    return db.select().from(schema.cashFlowRecords).where(eq(schema.cashFlowRecords.type, type)).all();
  },

  create: (record: typeof schema.cashFlowRecords.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.cashFlowRecords).values(record).run();
  },

  update: (id: string, data: Partial<typeof schema.cashFlowRecords.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.cashFlowRecords).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.cashFlowRecords.id, id)).run();
  },
};

/**
 * Reconciliation queries
 */
export const reconciliationQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.reconciliations).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.reconciliations).where(eq(schema.reconciliations.id, id)).get();
  },

  byShiftId: (shiftId: string) => {
    const db = getDatabase();
    return db.select().from(schema.reconciliations).where(eq(schema.reconciliations.shiftId, shiftId)).get();
  },

  create: (reconciliation: typeof schema.reconciliations.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.reconciliations).values(reconciliation).run();
  },

  update: (id: string, data: Partial<typeof schema.reconciliations.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.reconciliations).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.reconciliations.id, id)).run();
  },
};

/**
 * Approval queries
 */
export const approvalQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.approvals).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.approvals).where(eq(schema.approvals.id, id)).get();
  },

  pending: () => {
    const db = getDatabase();
    return db.select().from(schema.approvals).where(eq(schema.approvals.status, 'Pending')).all();
  },

  create: (approval: typeof schema.approvals.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.approvals).values(approval).run();
  },

  update: (id: string, data: Partial<typeof schema.approvals.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.approvals).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.approvals.id, id)).run();
  },
};

/**
 * Station Settings queries
 */
export const settingsQueries = {
  get: () => {
    const db = getDatabase();
    return db.select().from(schema.stationSettings).where(eq(schema.stationSettings.id, 'station-1')).get();
  },

  update: (data: Partial<typeof schema.stationSettings.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.stationSettings).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.stationSettings.id, 'station-1')).run();
  },
};

/**
 * Audit Log queries
 */
export const auditLogQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.timestamp)).all();
  },

  byUserId: (userId: string) => {
    const db = getDatabase();
    return db.select().from(schema.auditLogs).where(eq(schema.auditLogs.userId, userId)).orderBy(desc(schema.auditLogs.timestamp)).all();
  },

  byModule: (module: string) => {
    const db = getDatabase();
    return db.select().from(schema.auditLogs).where(eq(schema.auditLogs.module, module)).orderBy(desc(schema.auditLogs.timestamp)).all();
  },

  critical: () => {
    const db = getDatabase();
    return db.select().from(schema.auditLogs).where(eq(schema.auditLogs.severity, 'Critical')).orderBy(desc(schema.auditLogs.timestamp)).all();
  },

  create: (log: typeof schema.auditLogs.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.auditLogs).values(log).run();
  },
};

/**
 * Credit Note queries
 */
export const creditNoteQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.creditNotes).all();
  },

  byCustomerId: (customerId: string) => {
    const db = getDatabase();
    return db.select().from(schema.creditNotes).where(eq(schema.creditNotes.customerId, customerId)).all();
  },

  create: (note: typeof schema.creditNotes.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.creditNotes).values(note).run();
  },

  update: (id: string, data: Partial<typeof schema.creditNotes.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.creditNotes).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.creditNotes.id, id)).run();
  },
};

/**
 * Supplier Payment queries
 */
export const supplierPaymentQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.supplierPayments).all();
  },

  bySupplierId: (supplierId: string) => {
    const db = getDatabase();
    return db.select().from(schema.supplierPayments).where(eq(schema.supplierPayments.supplierId, supplierId)).all();
  },

  create: (payment: typeof schema.supplierPayments.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.supplierPayments).values(payment).run();
  },
};

/**
 * Shift Schedule queries
 */
export const scheduleQueries = {
  all: () => {
    const db = getDatabase();
    return db.select().from(schema.shiftSchedules).all();
  },

  byId: (id: string) => {
    const db = getDatabase();
    return db.select().from(schema.shiftSchedules).where(eq(schema.shiftSchedules.id, id)).get();
  },

  byStaffId: (staffId: string) => {
    const db = getDatabase();
    return db.select().from(schema.shiftSchedules).where(eq(schema.shiftSchedules.staffId, staffId)).all();
  },

  byDate: (date: string) => {
    const db = getDatabase();
    return db.select().from(schema.shiftSchedules).where(eq(schema.shiftSchedules.date, date)).all();
  },

  create: (schedule: typeof schema.shiftSchedules.$inferInsert) => {
    const db = getDatabase();
    return db.insert(schema.shiftSchedules).values(schedule).run();
  },

  update: (id: string, data: Partial<typeof schema.shiftSchedules.$inferInsert>) => {
    const db = getDatabase();
    return db.update(schema.shiftSchedules).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.shiftSchedules.id, id)).run();
  },

  delete: (id: string) => {
    const db = getDatabase();
    return db.delete(schema.shiftSchedules).where(eq(schema.shiftSchedules.id, id)).run();
  },
};
