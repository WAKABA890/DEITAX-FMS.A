import { sqliteTable, text, real, integer, blob, primaryKey, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ===========================
// USERS & AUTHENTICATION
// ===========================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username'),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull(),
  role: text('role').notNull(),
  pin: text('pin').notNull(),
  employeeId: text('employee_id'),
  department: text('department'),
  jobTitle: text('job_title'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  currentShiftId: text('current_shift_id'),
  assignedPumps: text('assigned_pumps'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  lastLogin: text('last_login'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const userPermissions = sqliteTable('user_permissions', {
  userId: text('user_id').notNull().references(() => users.id),
  permission: text('permission').notNull(),
  grantedBy: text('granted_by').notNull().references(() => users.id),
  grantedAt: text('granted_at').notNull(),
}, (table) => ({
  primaryKey: primaryKey({ columns: [table.userId, table.permission] }),
}));

// ===========================
// FUEL PRODUCTS & INVENTORY
// ===========================
export const fuelProducts = sqliteTable('fuel_products', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  pricePerLiter: real('price_per_liter').notNull(),
  costPerLiter: real('cost_per_liter').notNull(),
  taxRate: real('tax_rate').notNull(),
  taxCode: text('tax_code').notNull().default('B'),
  unit: text('unit').notNull().default('L'),
  color: text('color').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const fuelTanks = sqliteTable('fuel_tanks', {
  id: text('id').primaryKey(),
  tankName: text('tank_name').notNull(),
  fuelProductId: text('fuel_product_id').notNull().references(() => fuelProducts.id),
  fuelName: text('fuel_name').notNull(),
  capacityLiters: real('capacity_liters').notNull(),
  currentLevelLiters: real('current_level_liters').notNull(),
  reorderLevelLiters: real('reorder_level_liters').notNull(),
  lastDipReading: real('last_dip_reading').notNull(),
  lastDipTime: text('last_dip_time'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const pumps = sqliteTable('pumps', {
  id: text('id').primaryKey(),
  pumpNumber: integer('pump_number').notNull().unique(),
  pumpName: text('pump_name').notNull(),
  status: text('status').notNull().default('Active'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const pumpNozzles = sqliteTable('pump_nozzles', {
  id: text('id').primaryKey(),
  // Legacy upgraded databases do not physically enforce this relationship.
  // Validation verifies it until a separately approved table-rebuild migration.
  physicalPumpId: text('physical_pump_id'),
  nozzleNumber: integer('nozzle_number').notNull().default(1),
  nozzleName: text('nozzle_name'),
  pumpNumber: integer('pump_number').notNull(),
  pumpName: text('pump_name').notNull(),
  tankId: text('tank_id').notNull().references(() => fuelTanks.id),
  fuelProductId: text('fuel_product_id').notNull().references(() => fuelProducts.id),
  fuelName: text('fuel_name').notNull(),
  openingMeterReading: real('opening_meter_reading').notNull(),
  currentMeterReading: real('current_meter_reading').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const nozzleReadingHistory = sqliteTable('nozzle_reading_history', {
  id: text('id').primaryKey(),
  nozzleId: text('nozzle_id').notNull().references(() => pumpNozzles.id),
  pumpId: text('pump_id').references(() => pumps.id),
  tankId: text('tank_id').notNull().references(() => fuelTanks.id),
  fuelProductId: text('fuel_product_id').notNull().references(() => fuelProducts.id),
  shiftId: text('shift_id').references(() => shifts.id),
  transactionId: text('transaction_id').references(() => transactions.id),
  previousReading: real('previous_reading').notNull(),
  quantityDispensed: real('quantity_dispensed').notNull().default(0),
  currentReading: real('current_reading').notNull(),
  readingType: text('reading_type').notNull(),
  recordedBy: text('recorded_by').references(() => users.id),
  timestamp: text('timestamp').notNull(),
});

// ===========================
// SHOP INVENTORY
// ===========================
export const shopItems = sqliteTable('shop_items', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  unitPrice: real('unit_price').notNull(),
  price: real('price'),
  costPrice: real('cost_price').notNull(),
  stockQty: integer('stock_qty').notNull(),
  reorderLevel: integer('reorder_level').notNull(),
  requireShiftCount: integer('require_shift_count', { mode: 'boolean' }).notNull(),
  taxCode: text('tax_code'),
  taxType: text('tax_type').default('A'),
  country: text('country').default('KE'),
  currency: text('currency').default('KES'),
  productType: integer('product_type').default(1),
  unit: text('unit').default('Pieces'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// SHIFT MANAGEMENT
// ===========================
export const shifts = sqliteTable('shifts', {
  id: text('id').primaryKey(),
  staffId: text('staff_id').notNull().references(() => users.id),
  staffName: text('staff_name').notNull(),
  staffRole: text('staff_role').notNull(),
  shiftType: text('shift_type').notNull(),
  date: text('date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  status: text('status').notNull(),
  openingCash: real('opening_cash').notNull(),
  closingCash: real('closing_cash'),
  openingPumpReadingsJson: text('opening_pump_readings_json'),
  openingTankDipsJson: text('opening_tank_dips_json'),
  closingPumpReadingsJson: text('closing_pump_readings_json'),
  closingTankDipsJson: text('closing_tank_dips_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const shiftSchedules = sqliteTable('shift_schedules', {
  id: text('id').primaryKey(),
  staffId: text('staff_id').notNull().references(() => users.id),
  staffName: text('staff_name').notNull(),
  role: text('role').notNull(),
  shiftType: text('shift_type').notNull(),
  date: text('date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const shiftPlans = sqliteTable('shift_plans', {
  id: text('id').primaryKey(),
  recurrenceId: text('recurrence_id'),
  name: text('name').notNull(),
  shiftType: text('shift_type').notNull(),
  scheduledStart: text('scheduled_start').notNull(),
  scheduledEnd: text('scheduled_end').notNull(),
  status: text('status').notNull().default('Scheduled'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const shiftRecurrences = sqliteTable('shift_recurrences', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shiftType: text('shift_type').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  weekdaysJson: text('weekdays_json').notNull(),
  status: text('status').notNull().default('Active'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const shiftAssignments = sqliteTable('shift_assignments', {
  id: text('id').primaryKey(),
  shiftPlanId: text('shift_plan_id').notNull().references(() => shiftPlans.id),
  userId: text('user_id').notNull().references(() => users.id),
  status: text('status').notNull().default('Assigned'),
  assignedAt: text('assigned_at').notNull(),
  assignedBy: text('assigned_by').notNull().references(() => users.id),
  removedAt: text('removed_at'),
  removedBy: text('removed_by').references(() => users.id),
  clockInShiftId: text('clock_in_shift_id').references(() => shifts.id),
  clockInTime: text('clock_in_time'),
  clockOutTime: text('clock_out_time'),
  expiredAt: text('expired_at'),
  missedReason: text('missed_reason'),
});

export const readingVariances = sqliteTable('reading_variances', {
  id: text('id').primaryKey(),
  shiftId: text('shift_id').notNull().references(() => shifts.id),
  readingType: text('reading_type').notNull(),
  tankId: text('tank_id').notNull().references(() => fuelTanks.id),
  nozzleId: text('nozzle_id').references(() => pumpNozzles.id),
  reportedValue: real('reported_value').notNull(),
  authoritativeValue: real('authoritative_value').notNull(),
  variance: real('variance').notNull(),
  status: text('status').notNull().default('Review Required'),
  recordedBy: text('recorded_by').notNull().references(() => users.id),
  recordedAt: text('recorded_at').notNull(),
  reviewedBy: text('reviewed_by').references(() => users.id),
  reviewedAt: text('reviewed_at'),
  resolvedBy: text('resolved_by').references(() => users.id),
  resolvedAt: text('resolved_at'),
  resolutionNotes: text('resolution_notes'),
});

// ===========================
// SALES & TRANSACTIONS
// ===========================
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  pumpId: text('pump_id'),
  // Legacy upgraded databases do not physically enforce this relationship.
  // Validation verifies non-null references without rebuilding this core table.
  nozzleId: text('nozzle_id'),
  itemsJson: text('items_json'),
  productId: text('product_id').references(() => fuelProducts.id),
  quantity: real('quantity').notNull(),
  openingLevel: real('opening_level'),
  closingLevel: real('closing_level'),
  unitPrice: real('unit_price').notNull(),
  subtotal: real('subtotal').notNull(),
  tax: real('tax').notNull(),
  totalAmount: real('total_amount').notNull(),
  paymentMethod: text('payment_method').notNull(),
  source: text('source').notNull().default('MANUAL'),
  attendantId: text('attendant_id').references(() => users.id),
  attendantName: text('attendant_name'),
  meterReadingBefore: real('meter_reading_before'),
  meterReadingAfter: real('meter_reading_after'),
  receiptNumber: text('receipt_number').unique(),
  invoiceNumber: text('invoice_number').unique(),
  documentType: text('document_type').notNull().default('Receipt'),
  customerName: text('customer_name'),
  customerPin: text('customer_pin'),
  vehiclePlate: text('vehicle_plate'),
  status: text('status').notNull().default('Completed'),
  shiftId: text('shift_id').references(() => shifts.id),
  dispensedWithoutShift: integer('dispensed_without_shift', { mode: 'boolean' }).notNull().default(false),
  meterReconciliationShiftId: text('meter_reconciliation_shift_id').references(() => shifts.id),
  settlementShiftId: text('settlement_shift_id').references(() => shifts.id),
  settledAt: text('settled_at'),
  customerId: text('customer_id').references(() => customers.id),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const documentCounters = sqliteTable('document_counters', {
  documentType: text('document_type').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// CUSTOMERS & CREDIT
// ===========================
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  businessName: text('business_name').notNull(),
  contactPerson: text('contact_person').notNull(),
  email: text('email'),
  phone: text('phone').notNull(),
  address: text('address'),
  accountType: text('account_type').notNull(),
  creditLimit: real('credit_limit').notNull(),
  currentDebt: real('current_debt').notNull().default(0),
  status: text('status').notNull().default('Active'),
  taxId: text('tax_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, table=>({nameUnique:uniqueIndex('idx_customers_name_unique').on(sql`lower(trim(${table.businessName}))`),taxIdUnique:uniqueIndex('idx_customers_tax_id_unique').on(sql`lower(trim(${table.taxId}))`)}));

export const creditNotes = sqliteTable('credit_notes', {
  id: text('id').primaryKey(),
  creditNoteNo: text('credit_note_no'),
  customerId: text('customer_id').references(() => customers.id),
  customerName: text('customer_name'),
  customerPin: text('customer_pin'),
  vehiclePlate: text('vehicle_plate'),
  amount: real('amount'),
  subtotal: real('subtotal'),
  taxAmount: real('tax_amount'),
  totalAmount: real('total_amount'),
  reason: text('reason'),
  narration: text('narration'),
  status: text('status').notNull(),
  itemsJson: text('items_json'),
  originalTransactionId: text('original_transaction_id'),
  originalDocumentType: text('original_document_type'),
  originalDocumentNo: text('original_document_no'),
  originalInvoiceNo: text('original_invoice_no'),
  originalReceiptNo: text('original_receipt_no'),
  issuedBy: text('issued_by').references(() => users.id),
  issuedByName: text('issued_by_name'),
  approvedBy: text('approved_by').references(() => users.id),
  approvedByName: text('approved_by_name'),
  appliedToTransactionId: text('applied_to_transaction_id'),
  timestamp: text('timestamp'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// SUPPLIERS & PAYMENTS
// ===========================
export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  supplierName: text('supplier_name').notNull(),
  contactPerson: text('contact_person').notNull(),
  email: text('email'),
  phone: text('phone').notNull(),
  address: text('address'),
  paymentTerms: text('payment_terms'),
  accountBalance: real('account_balance').notNull().default(0),
  status: text('status').notNull().default('Active'),
  taxId: text('tax_id'),
  bankName: text('bank_name'),
  bankAccount: text('bank_account'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, table=>({nameUnique:uniqueIndex('idx_suppliers_name_unique').on(sql`lower(trim(${table.supplierName}))`),taxIdUnique:uniqueIndex('idx_suppliers_tax_id_unique').on(sql`lower(trim(${table.taxId}))`)}));

export const supplierPayments = sqliteTable('supplier_payments', {
  id: text('id').primaryKey(),
  supplierId: text('supplier_id').notNull().references(() => suppliers.id),
  amount: real('amount').notNull(),
  paymentMethod: text('payment_method').notNull(),
  referenceNumber: text('reference_number'),
  date: text('date').notNull(),
  approvedBy: text('approved_by').references(() => users.id),
  approvedByName: text('approved_by_name'),
  notes: text('notes'),
  status: text('status').notNull().default('Completed'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// FUEL DELIVERIES & STOCK
// ===========================
export const fuelDeliveries = sqliteTable('fuel_deliveries', {
  id: text('id').primaryKey(),
  supplierId: text('supplier_id').notNull().references(() => suppliers.id),
  supplierName: text('supplier_name').notNull(),
  tankId: text('tank_id').notNull().references(() => fuelTanks.id),
  fuelProductId: text('fuel_product_id').notNull().references(() => fuelProducts.id),
  quantity: real('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  totalCost: real('total_cost').notNull(),
  deliveryDate: text('delivery_date').notNull(),
  deliveryTime: text('delivery_time'),
  invoiceNumber: text('invoice_number'),
  driverName: text('driver_name'),
  driverPhone: text('driver_phone'),
  vehicleReg: text('vehicle_reg'),
  receivedBy: text('received_by').references(() => users.id),
  receivedByName: text('received_by_name'),
  status: text('status').notNull().default('Pending'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const stockAdjustments = sqliteTable('stock_adjustments', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  referenceId: text('reference_id').notNull(),
  referenceName: text('reference_name').notNull(),
  previousQuantity: real('previous_quantity').notNull(),
  adjustmentQuantity: real('adjustment_quantity').notNull(),
  newQuantity: real('new_quantity').notNull(),
  reason: text('reason').notNull(),
  movementType: text('movement_type'),
  source: text('source').default('Manual Adjustment'),
  referenceNumber: text('reference_number'),
  originalDocumentNumber: text('original_document_number'),
  productCode: text('product_code'),
  performedBy: text('performed_by'),
  recordedBy: text('recorded_by').notNull().references(() => users.id),
  recordedByName: text('recorded_by_name').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// FINANCIAL RECORDS
// ===========================
export const cashFlowRecords = sqliteTable('cash_flow_records', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  type: text('type').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  accountingMethod: text('accounting_method').notNull(),
  referenceNo: text('reference_no'), // ✅ ADDED
  relatedTransactionId: text('related_transaction_id'),
  relatedDeliveryId: text('related_delivery_id'),
  relatedPaymentId: text('related_payment_id'),
  recordedBy: text('recorded_by').notNull().references(() => users.id),
  recordedByName: text('recorded_by_name').notNull(),
  approvedBy: text('approved_by').references(() => users.id),
  approvedByName: text('approved_by_name'),
  notes: text('notes'),
  status: text('status').notNull().default('Recorded'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// RECONCILIATION
// ===========================
export const reconciliations = sqliteTable('reconciliations', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  shiftId: text('shift_id').references(() => shifts.id),
  staffId: text('staff_id').notNull().references(() => users.id),
  staffName: text('staff_name').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time'),
  tankDipBefore: real('tank_dip_before'),
  tankDipAfter: real('tank_dip_after'),
  tankExpectedLiters: real('tank_expected_liters'),
  tankActualLiters: real('tank_actual_liters'),
  tankVariance: real('tank_variance'),
  pumpMeterBefore: real('pump_meter_before'),
  pumpMeterAfter: real('pump_meter_after'),
  pumpExpectedLiters: real('pump_expected_liters'),
  pumpActualLiters: real('pump_actual_liters'),
  pumpVariance: real('pump_variance'),
  cashExpected: real('cash_expected'),
  cashActual: real('cash_actual'),
  cashVariance: real('cash_variance'),
  varianceNotes: text('variance_notes'),
  status: text('status').notNull().default('Pending'),
  approvedBy: text('approved_by').references(() => users.id),
  approvedByName: text('approved_by_name'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// APPROVALS & WORKFLOW
// ===========================
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  referenceId: text('reference_id').notNull(),
  description: text('description').notNull(),
  requestedBy: text('requested_by').notNull().references(() => users.id),
  requestedByName: text('requested_by_name').notNull(),
  requestedAt: text('requested_at').default(sql`CURRENT_TIMESTAMP`),
  details: blob('details'),
  status: text('status').notNull().default('Pending'),
  approvedBy: text('approved_by').references(() => users.id),
  approvedByName: text('approved_by_name'),
  approvedAt: text('approved_at'),
  approvalNotes: text('approval_notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// STATION SETTINGS
// ===========================
export const stationSettings = sqliteTable('station_settings', {
  id: text('id').primaryKey().default('station-1'),
  stationName: text('station_name').notNull(),
  tagline: text('tagline'),
  taxPin: text('tax_pin').notNull(),
  cuSerial: text('cu_serial'),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  invoiceTerms: text('invoice_terms'),
  paybillNumber: text('paybill_number'),
  paybillAccountNumber: text('paybill_account_number'),
  tillNumber: text('till_number'),
  showPaybillOnInvoice: integer('show_paybill_on_invoice', { mode: 'boolean' }).notNull().default(true),
  showTillOnInvoice: integer('show_till_on_invoice', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// AUDIT & LOGGING
// ===========================
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull().default(sql`CURRENT_TIMESTAMP`),
  userId: text('user_id').notNull().references(() => users.id),
  userName: text('user_name').notNull(),
  userRole: text('user_role').notNull(),
  action: text('action').notNull(),
  module: text('module').notNull(),
  details: text('details').notNull(),
  ipAddress: text('ip_address').notNull(),
  severity: text('severity').notNull().default('Info'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// =========================================================
// NEW TABLE: MANAGER APPROVALS (added to persist approvals)
// =========================================================
export const managerApprovals = sqliteTable('manager_approvals', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  shiftId: text('shift_id').references(() => shifts.id),
  type: text('type').notNull(),
  requestedBy: text('requested_by').notNull(),
  reason: text('reason').notNull(),
  amountOrQty: text('amount_or_qty').notNull(),
  status: text('status').notNull().default('Pending'),
  managerId: text('manager_id').references(() => users.id),
  managerNotes: text('manager_notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// ===========================
// AUTOMATION FOUNDATION
// Phase 1 only: configuration, mappings, durable inbox, cursors, logs and settings.
// No controller connectivity or equipment commands are implemented here.
// ===========================
export const automationControllers = sqliteTable('automation_controllers', {
  id: text('id').primaryKey(),
  stationId: text('station_id').notNull().references(() => stationSettings.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  name: text('name').notNull(),
  adapterType: text('adapter_type').notNull(),
  host: text('host'),
  port: integer('port'),
  connectionType: text('connection_type').notNull().default('TCP'),
  timeoutMs: integer('timeout_ms').notNull().default(5000),
  credentialRef: text('credential_ref'),
  configurationJson: text('configuration_json'),
  status: text('status').notNull().default('DISABLED'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  lastCommunicationAt: text('last_communication_at'),
  lastSuccessfulConnectionAt: text('last_successful_connection_at'),
  lastError: text('last_error'),
  capabilitiesJson: text('capabilities_json').notNull().default('[]'),
  firmwareVersion: text('firmware_version'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  stationNameUnique: uniqueIndex('idx_automation_controllers_station_name').on(table.stationId, table.name),
  stationEnabledIndex: index('idx_automation_controllers_station_enabled').on(table.stationId, table.enabled),
  statusCheck: check('chk_automation_controllers_status', sql`${table.status} IN ('ONLINE', 'OFFLINE', 'CONNECTING', 'ERROR', 'DISABLED', 'UNKNOWN')`),
  portCheck: check('chk_automation_controllers_port', sql`${table.port} IS NULL OR (${table.port} BETWEEN 1 AND 65535)`),
  timeoutCheck: check('chk_automation_controllers_timeout', sql`${table.timeoutMs} BETWEEN 100 AND 60000`),
}));

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => ({ userExpiryIndex: index('idx_auth_sessions_user_expiry').on(table.userId, table.expiresAt) }));

export const customRoles = sqliteTable('custom_roles', {
  id: text('id').primaryKey(), name: text('name').notNull(), description: text('description').notNull().default(''),
  status: text('status').notNull().default('ACTIVE'), systemRole: integer('system_role', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').references(() => users.id, { onUpdate: 'cascade', onDelete: 'restrict' }),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const customRolePermissions = sqliteTable('custom_role_permissions', {
  roleId: text('role_id').notNull().references(() => customRoles.id, { onUpdate: 'cascade', onDelete: 'restrict' }),
  permission: text('permission').notNull(), grantedBy: text('granted_by').references(() => users.id, { onUpdate: 'cascade', onDelete: 'restrict' }),
  grantedAt: text('granted_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => ({ primaryKey: primaryKey({ columns: [table.roleId, table.permission] }) }));

export const automationDeviceMappings = sqliteTable('automation_device_mappings', {
  id: text('id').primaryKey(),
  controllerId: text('controller_id').notNull().references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  equipmentType: text('equipment_type').notNull(),
  externalParentId: text('external_parent_id').notNull().default(''),
  externalEquipmentId: text('external_equipment_id').notNull(),
  externalName: text('external_name'),
  externalAddress: text('external_address'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  pumpId: text('pump_id').references(() => pumps.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  nozzleId: text('nozzle_id').references(() => pumpNozzles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  tankId: text('tank_id').references(() => fuelTanks.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  productId: text('product_id').references(() => fuelProducts.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  status: text('status').notNull().default('MAPPED'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  lastDiscoveredAt: text('last_discovered_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  externalIdentityUnique: uniqueIndex('idx_automation_mappings_external_identity').on(
    table.controllerId,
    table.equipmentType,
    table.externalParentId,
    table.externalEquipmentId,
  ),
  pumpIndex: index('idx_automation_mappings_pump').on(table.pumpId),
  nozzleIndex: index('idx_automation_mappings_nozzle').on(table.nozzleId),
  tankIndex: index('idx_automation_mappings_tank').on(table.tankId),
  productIndex: index('idx_automation_mappings_product').on(table.productId),
  statusIndex: index('idx_automation_mappings_status').on(table.controllerId, table.status),
  equipmentTypeCheck: check('chk_automation_mappings_equipment_type', sql`${table.equipmentType} IN ('PUMP', 'NOZZLE', 'TANK', 'PRODUCT')`),
  statusCheck: check('chk_automation_mappings_status', sql`${table.status} IN ('MAPPED', 'DISABLED', 'CONFLICT', 'ORPHANED')`),
  targetCheck: check('chk_automation_mappings_target', sql`
    (${table.equipmentType} = 'PUMP' AND ${table.pumpId} IS NOT NULL AND ${table.nozzleId} IS NULL AND ${table.tankId} IS NULL AND ${table.productId} IS NULL)
    OR (${table.equipmentType} = 'NOZZLE' AND ${table.pumpId} IS NULL AND ${table.nozzleId} IS NOT NULL AND ${table.tankId} IS NULL AND ${table.productId} IS NULL)
    OR (${table.equipmentType} = 'TANK' AND ${table.pumpId} IS NULL AND ${table.nozzleId} IS NULL AND ${table.tankId} IS NOT NULL AND ${table.productId} IS NULL)
    OR (${table.equipmentType} = 'PRODUCT' AND ${table.pumpId} IS NULL AND ${table.nozzleId} IS NULL AND ${table.tankId} IS NULL AND ${table.productId} IS NOT NULL)
  `),
}));

export const automationDiscoveredDevices = sqliteTable('automation_discovered_devices', {
  id: text('id').primaryKey(),
  controllerId: text('controller_id').notNull().references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  equipmentType: text('equipment_type').notNull(),
  externalParentId: text('external_parent_id').notNull().default(''),
  externalEquipmentId: text('external_equipment_id').notNull(),
  externalName: text('external_name'),
  externalAddress: text('external_address'),
  productExternalId: text('product_external_id'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  firstDiscoveredAt: text('first_discovered_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastDiscoveredAt: text('last_discovered_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  present: integer('present', { mode: 'boolean' }).notNull().default(true),
});

export const automationMappingHistory = sqliteTable('automation_mapping_history', {
  id: text('id').primaryKey(),
  mappingId: text('mapping_id').notNull().references(() => automationDeviceMappings.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  controllerId: text('controller_id').notNull().references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  action: text('action').notNull(),
  beforeJson: text('before_json'),
  afterJson: text('after_json'),
  changedBy: text('changed_by').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const automationEventInbox = sqliteTable('automation_event_inbox', {
  id: text('id').primaryKey(),
  controllerId: text('controller_id').notNull().references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  externalEventId: text('external_event_id').notNull(),
  eventType: text('event_type').notNull(),
  externalDeviceId: text('external_device_id'),
  deviceType: text('device_type'),
  sourceSequence: text('source_sequence'),
  sourceOccurredAt: text('source_occurred_at').notNull(),
  receivedAt: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  schemaVersion: integer('schema_version').notNull().default(1),
  payloadJson: text('payload_json').notNull(),
  rawPayloadHash: text('raw_payload_hash').notNull(),
  correlationId: text('correlation_id'),
  processingStatus: text('processing_status').notNull().default('RECEIVED'),
  processingAttempts: integer('processing_attempts').notNull().default(0),
  processingStartedAt: text('processing_started_at'),
  processedAt: text('processed_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  controllerEventUnique: uniqueIndex('idx_automation_event_controller_external').on(table.controllerId, table.externalEventId),
  statusReceivedIndex: index('idx_automation_event_status_received').on(table.processingStatus, table.receivedAt),
  controllerSequenceIndex: index('idx_automation_event_controller_sequence').on(table.controllerId, table.sourceSequence),
  correlationIndex: index('idx_automation_event_correlation').on(table.correlationId),
  statusCheck: check('chk_automation_event_processing_status', sql`${table.processingStatus} IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')`),
  attemptsCheck: check('chk_automation_event_attempts', sql`${table.processingAttempts} >= 0`),
  schemaVersionCheck: check('chk_automation_event_schema_version', sql`${table.schemaVersion} >= 1`),
}));

export const automationFuelTransactionProcessing = sqliteTable('automation_fuel_transaction_processing', {
  inboxId: text('inbox_id').primaryKey().references(() => automationEventInbox.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  controllerId: text('controller_id').notNull().references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  externalEventId: text('external_event_id').notNull(),
  transactionId: text('transaction_id').unique().references(() => transactions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  externalDeviceId: text('external_device_id'),
  externalParentId: text('external_parent_id'),
  sourceSequence: text('source_sequence'),
  occurredAt: text('occurred_at').notNull(),
  receivedAt: text('received_at').notNull(),
  processingStatus: text('processing_status').notNull().default('RECEIVED'),
  failureCode: text('failure_code'),
  failureClass: text('failure_class'),
  failureDetail: text('failure_detail'),
  processingAttempts: integer('processing_attempts').notNull().default(0),
  postingStartedAt: text('posting_started_at'),
  postedAt: text('posted_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => ({
  controllerEventUnique: uniqueIndex('idx_automation_fuel_controller_event').on(table.controllerId, table.externalEventId),
  statusIndex: index('idx_automation_fuel_processing_status').on(table.processingStatus, table.updatedAt),
  statusCheck: check('chk_automation_fuel_processing_status', sql`${table.processingStatus} IN ('RECEIVED','VALIDATING','VALIDATED','POSTING','POSTED','REJECTED','FAILED')`),
  failureClassCheck: check('chk_automation_fuel_failure_class', sql`${table.failureClass} IS NULL OR ${table.failureClass} IN ('PERMANENT','TEMPORARY')`),
}));

export const automationMeterReadings = sqliteTable('automation_meter_readings', {
  id:text('id').primaryKey(), inboxId:text('inbox_id').notNull().unique().references(()=>automationEventInbox.id,{onDelete:'restrict',onUpdate:'cascade'}), controllerId:text('controller_id').notNull().references(()=>automationControllers.id,{onDelete:'restrict',onUpdate:'cascade'}), stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}), externalEventId:text('external_event_id').notNull(), externalDeviceId:text('external_device_id').notNull(), externalParentId:text('external_parent_id').notNull(), deviceType:text('device_type').notNull(), pumpId:text('pump_id').notNull().references(()=>pumps.id,{onDelete:'restrict',onUpdate:'cascade'}), nozzleId:text('nozzle_id').notNull().references(()=>pumpNozzles.id,{onDelete:'restrict',onUpdate:'cascade'}), productId:text('product_id').references(()=>fuelProducts.id,{onDelete:'restrict',onUpdate:'cascade'}), readingValue:real('reading_value').notNull(), unit:text('unit').notNull(), sourceSequence:text('source_sequence'), sourceOccurredAt:text('source_occurred_at').notNull(), receivedAt:text('received_at').notNull(), payloadHash:text('payload_hash').notNull(), processingStatus:text('processing_status').notNull(), anomalyClassification:text('anomaly_classification'), previousReadingId:text('previous_reading_id'), previousValue:real('previous_value'), calculatedDelta:real('calculated_delta'), transactionId:text('transaction_id').references(()=>transactions.id,{onDelete:'restrict',onUpdate:'cascade'}), transactionVolume:real('transaction_volume'), correlationStatus:text('correlation_status').notNull().default('NOT_AVAILABLE'), createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
},table=>({controllerEventUnique:uniqueIndex('idx_meter_readings_controller_event').on(table.controllerId,table.externalEventId),deviceTimeIndex:index('idx_meter_readings_device_time').on(table.controllerId,table.externalParentId,table.externalDeviceId,table.sourceOccurredAt),topologyIndex:index('idx_meter_readings_topology').on(table.pumpId,table.nozzleId,table.productId,table.sourceOccurredAt),anomalyIndex:index('idx_meter_readings_anomaly').on(table.anomalyClassification,table.sourceOccurredAt),correlationIndex:index('idx_meter_readings_correlation').on(table.correlationStatus,table.sourceOccurredAt)}));

export const automationMeterProcessing=sqliteTable('automation_meter_processing',{inboxId:text('inbox_id').primaryKey().references(()=>automationEventInbox.id,{onDelete:'restrict',onUpdate:'cascade'}),controllerId:text('controller_id').notNull().references(()=>automationControllers.id,{onDelete:'restrict',onUpdate:'cascade'}),externalEventId:text('external_event_id').notNull(),processingStatus:text('processing_status').notNull().default('RECEIVED'),failureCode:text('failure_code'),failureClass:text('failure_class'),failureDetail:text('failure_detail'),processingAttempts:integer('processing_attempts').notNull().default(0),meterReadingId:text('meter_reading_id').unique().references(()=>automationMeterReadings.id,{onDelete:'restrict',onUpdate:'cascade'}),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)},table=>({controllerEventUnique:uniqueIndex('idx_meter_processing_controller_event').on(table.controllerId,table.externalEventId),statusIndex:index('idx_meter_processing_status').on(table.processingStatus,table.updatedAt)}));

export const automationMeterCurrentState=sqliteTable('automation_meter_current_state',{controllerId:text('controller_id').notNull().references(()=>automationControllers.id,{onDelete:'restrict',onUpdate:'cascade'}),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),externalParentId:text('external_parent_id').notNull(),externalDeviceId:text('external_device_id').notNull(),pumpId:text('pump_id').notNull().references(()=>pumps.id,{onDelete:'restrict',onUpdate:'cascade'}),nozzleId:text('nozzle_id').notNull().references(()=>pumpNozzles.id,{onDelete:'restrict',onUpdate:'cascade'}),productId:text('product_id').references(()=>fuelProducts.id,{onDelete:'restrict',onUpdate:'cascade'}),currentReadingId:text('current_reading_id').notNull().references(()=>automationMeterReadings.id,{onDelete:'restrict',onUpdate:'cascade'}),previousReadingId:text('previous_reading_id').references(()=>automationMeterReadings.id,{onDelete:'restrict',onUpdate:'cascade'}),currentValue:real('current_value').notNull(),previousValue:real('previous_value'),calculatedDelta:real('calculated_delta'),unit:text('unit').notNull(),lastSequence:text('last_sequence'),lastSourceOccurredAt:text('last_source_occurred_at').notNull(),lastReceivedAt:text('last_received_at').notNull(),lastValidReadingAt:text('last_valid_reading_at').notNull(),lastAnomaly:text('last_anomaly'),correlationStatus:text('correlation_status').notNull().default('NOT_AVAILABLE'),transactionId:text('transaction_id').references(()=>transactions.id,{onDelete:'restrict',onUpdate:'cascade'}),updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)},table=>({primaryKey:primaryKey({columns:[table.controllerId,table.externalParentId,table.externalDeviceId]}),topologyIndex:index('idx_meter_current_topology').on(table.pumpId,table.nozzleId),freshnessIndex:index('idx_meter_current_freshness').on(table.lastReceivedAt)}));

export const automationAtgReadings=sqliteTable('automation_atg_readings',{id:text('id').primaryKey(),inboxId:text('inbox_id').notNull().unique().references(()=>automationEventInbox.id,{onDelete:'restrict',onUpdate:'cascade'}),controllerId:text('controller_id').notNull().references(()=>automationControllers.id,{onDelete:'restrict',onUpdate:'cascade'}),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),externalEventId:text('external_event_id').notNull(),externalTankId:text('external_tank_id').notNull(),tankId:text('tank_id').notNull().references(()=>fuelTanks.id,{onDelete:'restrict',onUpdate:'cascade'}),productId:text('product_id').references(()=>fuelProducts.id,{onDelete:'restrict',onUpdate:'cascade'}),levelValue:real('level_value'),levelUnit:text('level_unit'),volumeValue:real('volume_value'),volumeUnit:text('volume_unit'),temperatureValue:real('temperature_value'),temperatureUnit:text('temperature_unit'),waterLevelValue:real('water_level_value'),waterLevelUnit:text('water_level_unit'),sourceSequence:text('source_sequence'),sourceOccurredAt:text('source_occurred_at').notNull(),receivedAt:text('received_at').notNull(),payloadHash:text('payload_hash').notNull(),processingStatus:text('processing_status').notNull(),anomalyClassification:text('anomaly_classification'),previousReadingId:text('previous_reading_id'),sensorReset:integer('sensor_reset',{mode:'boolean'}).notNull().default(false),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({controllerEventUnique:uniqueIndex('idx_atg_readings_controller_event').on(t.controllerId,t.externalEventId),tankTime:index('idx_atg_readings_tank_time').on(t.tankId,t.sourceOccurredAt),controllerTime:index('idx_atg_readings_controller_time').on(t.controllerId,t.sourceOccurredAt),anomaly:index('idx_atg_readings_anomaly').on(t.anomalyClassification,t.sourceOccurredAt)}));
export const automationAtgProcessing=sqliteTable('automation_atg_processing',{inboxId:text('inbox_id').primaryKey().references(()=>automationEventInbox.id,{onDelete:'restrict',onUpdate:'cascade'}),controllerId:text('controller_id').notNull().references(()=>automationControllers.id,{onDelete:'restrict',onUpdate:'cascade'}),externalEventId:text('external_event_id').notNull(),processingStatus:text('processing_status').notNull().default('RECEIVED'),failureCode:text('failure_code'),failureClass:text('failure_class'),failureDetail:text('failure_detail'),processingAttempts:integer('processing_attempts').notNull().default(0),atgReadingId:text('atg_reading_id').unique().references(()=>automationAtgReadings.id,{onDelete:'restrict',onUpdate:'cascade'}),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({controllerEventUnique:uniqueIndex('idx_atg_processing_controller_event').on(t.controllerId,t.externalEventId),status:index('idx_atg_processing_status').on(t.processingStatus,t.updatedAt)}));
export const automationAtgCurrentState=sqliteTable('automation_atg_current_state',{controllerId:text('controller_id').notNull().references(()=>automationControllers.id,{onDelete:'restrict',onUpdate:'cascade'}),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),externalTankId:text('external_tank_id').notNull(),tankId:text('tank_id').notNull().references(()=>fuelTanks.id,{onDelete:'restrict',onUpdate:'cascade'}),productId:text('product_id').references(()=>fuelProducts.id,{onDelete:'restrict',onUpdate:'cascade'}),currentReadingId:text('current_reading_id').notNull().references(()=>automationAtgReadings.id,{onDelete:'restrict',onUpdate:'cascade'}),previousReadingId:text('previous_reading_id').references(()=>automationAtgReadings.id,{onDelete:'restrict',onUpdate:'cascade'}),levelValue:real('level_value'),levelUnit:text('level_unit'),volumeValue:real('volume_value'),volumeUnit:text('volume_unit'),temperatureValue:real('temperature_value'),temperatureUnit:text('temperature_unit'),waterLevelValue:real('water_level_value'),waterLevelUnit:text('water_level_unit'),lastSequence:text('last_sequence'),lastSourceOccurredAt:text('last_source_occurred_at').notNull(),lastReceivedAt:text('last_received_at').notNull(),lastValidReadingAt:text('last_valid_reading_at').notNull(),lastAnomaly:text('last_anomaly'),sensorReset:integer('sensor_reset',{mode:'boolean'}).notNull().default(false),updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({primaryKey:primaryKey({columns:[t.controllerId,t.externalTankId]}),tankUnique:uniqueIndex('idx_atg_current_tank').on(t.tankId),freshness:index('idx_atg_current_freshness').on(t.lastReceivedAt)}));

export const automationReconciliationRuns=sqliteTable('automation_reconciliation_runs',{id:text('id').primaryKey(),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),reconciliationType:text('reconciliation_type').notNull(),scopeType:text('scope_type').notNull(),scopeId:text('scope_id').notNull().default(''),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),configurationJson:text('configuration_json').notNull(),configurationVersion:integer('configuration_version').notNull().default(1),scopeKey:text('scope_key').notNull().unique(),status:text('status').notNull().default('PENDING'),result:text('result'),totalVariance:real('total_variance'),tolerance:real('tolerance'),createdBy:text('created_by').references(()=>users.id,{onDelete:'restrict',onUpdate:'cascade'}),executionSource:text('execution_source').notNull(),notes:text('notes'),failureDetail:text('failure_detail'),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),startedAt:text('started_at'),completedAt:text('completed_at'),updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({stationPeriod:index('idx_auto_recon_station_period').on(t.stationId,t.periodStart,t.periodEnd),stationResult:index('idx_auto_recon_station_result').on(t.stationId,t.result,t.createdAt),scope:index('idx_auto_recon_scope').on(t.stationId,t.reconciliationType,t.scopeType,t.scopeId)}));
export const automationReconciliationItems=sqliteTable('automation_reconciliation_items',{id:text('id').primaryKey(),reconciliationRunId:text('reconciliation_run_id').notNull().references(()=>automationReconciliationRuns.id,{onDelete:'cascade',onUpdate:'cascade'}),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),productId:text('product_id').references(()=>fuelProducts.id,{onDelete:'restrict',onUpdate:'cascade'}),tankId:text('tank_id').references(()=>fuelTanks.id,{onDelete:'restrict',onUpdate:'cascade'}),physicalPumpId:text('physical_pump_id').references(()=>pumps.id,{onDelete:'restrict',onUpdate:'cascade'}),nozzleId:text('nozzle_id').references(()=>pumpNozzles.id,{onDelete:'restrict',onUpdate:'cascade'}),shiftId:text('shift_id').references(()=>shifts.id,{onDelete:'restrict',onUpdate:'cascade'}),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),openingTotalizer:real('opening_totalizer'),closingTotalizer:real('closing_totalizer'),totalizerDelta:real('totalizer_delta'),automatedTransactionQuantity:real('automated_transaction_quantity'),manualTransactionQuantity:real('manual_transaction_quantity'),dispenserVariance:real('dispenser_variance'),openingAtgVolume:real('opening_atg_volume'),closingAtgVolume:real('closing_atg_volume'),deliveries:real('deliveries'),transfers:real('transfers'),adjustments:real('adjustments'),expectedTankChange:real('expected_tank_change'),actualAtgChange:real('actual_atg_change'),atgVariance:real('atg_variance'),tolerance:real('tolerance').notNull(),absoluteVariance:real('absolute_variance'),percentageVariance:real('percentage_variance'),result:text('result').notNull(),dataQualityStatus:text('data_quality_status').notNull(),explanation:text('explanation').notNull(),evidenceRefsJson:text('evidence_refs_json').notNull().default('{}'),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({run:index('idx_auto_recon_items_run').on(t.reconciliationRunId),topology:index('idx_auto_recon_items_topology').on(t.stationId,t.tankId,t.physicalPumpId,t.nozzleId,t.productId),result:index('idx_auto_recon_items_result').on(t.stationId,t.result,t.createdAt)}));

export const automationAlertRules=sqliteTable('automation_alert_rules',{id:text('id').primaryKey(),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),ruleCode:text('rule_code').notNull(),name:text('name').notNull(),description:text('description').notNull().default(''),enabled:integer('enabled',{mode:'boolean'}).notNull().default(true),severity:text('severity').notNull(),threshold:real('threshold'),durationSeconds:integer('duration_seconds'),cooldownSeconds:integer('cooldown_seconds').notNull().default(300),repeatIntervalSeconds:integer('repeat_interval_seconds'),createdBy:text('created_by').references(()=>users.id,{onDelete:'restrict',onUpdate:'cascade'}),updatedBy:text('updated_by').references(()=>users.id,{onDelete:'restrict',onUpdate:'cascade'}),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({stationRule:uniqueIndex('idx_alert_rules_station_rule').on(t.stationId,t.ruleCode),stationEnabled:index('idx_alert_rules_station_enabled').on(t.stationId,t.enabled)}));
export const automationAlerts=sqliteTable('automation_alerts',{id:text('id').primaryKey(),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),ruleId:text('rule_id').references(()=>automationAlertRules.id,{onDelete:'restrict',onUpdate:'cascade'}),alertType:text('alert_type').notNull(),severity:text('severity').notNull(),status:text('status').notNull().default('OPEN'),sourceDomain:text('source_domain').notNull(),sourceId:text('source_id'),sourceReference:text('source_reference'),title:text('title').notNull(),message:text('message').notNull(),detailsJson:text('details_json').notNull().default('{}'),detectedAt:text('detected_at').notNull(),firstDetectedAt:text('first_detected_at').notNull(),lastDetectedAt:text('last_detected_at').notNull(),acknowledgedAt:text('acknowledged_at'),acknowledgedBy:text('acknowledged_by').references(()=>users.id,{onDelete:'restrict',onUpdate:'cascade'}),resolvedAt:text('resolved_at'),resolvedBy:text('resolved_by').references(()=>users.id,{onDelete:'restrict',onUpdate:'cascade'}),resolutionNote:text('resolution_note'),occurrenceCount:integer('occurrence_count').notNull().default(1),deduplicationKey:text('deduplication_key').notNull(),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({stationDedup:uniqueIndex('idx_alerts_station_dedup').on(t.stationId,t.deduplicationKey),stationStatus:index('idx_alerts_station_status').on(t.stationId,t.status,t.severity,t.lastDetectedAt),source:index('idx_alerts_source').on(t.stationId,t.sourceDomain,t.sourceId),typeTime:index('idx_alerts_type_time').on(t.stationId,t.alertType,t.lastDetectedAt)}));
export const automationNotifications=sqliteTable('automation_notifications',{id:text('id').primaryKey(),alertId:text('alert_id').notNull().references(()=>automationAlerts.id,{onDelete:'cascade',onUpdate:'cascade'}),stationId:text('station_id').notNull().references(()=>stationSettings.id,{onDelete:'restrict',onUpdate:'cascade'}),channel:text('channel').notNull(),recipient:text('recipient'),status:text('status').notNull().default('PENDING'),attemptedAt:text('attempted_at'),deliveredAt:text('delivered_at'),failureReason:text('failure_reason'),retryCount:integer('retry_count').notNull().default(0),createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)},t=>({alertChannelRecipient:uniqueIndex('idx_notifications_alert_channel_recipient').on(t.alertId,t.channel,t.recipient),stationStatus:index('idx_notifications_station_status').on(t.stationId,t.status,t.createdAt),alert:index('idx_notifications_alert').on(t.alertId,t.createdAt)}));

export const automationSyncCursors = sqliteTable('automation_sync_cursors', {
  id: text('id').primaryKey(),
  controllerId: text('controller_id').notNull().references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  streamName: text('stream_name').notNull(),
  cursorValue: text('cursor_value'),
  sourceSequence: text('source_sequence'),
  lastEventAt: text('last_event_at'),
  synchronizedAt: text('synchronized_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  controllerStreamUnique: uniqueIndex('idx_automation_sync_controller_stream').on(table.controllerId, table.streamName),
}));

export const automationLogs = sqliteTable('automation_logs', {
  id: text('id').primaryKey(),
  controllerId: text('controller_id').references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  eventId: text('event_id').references(() => automationEventInbox.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  timestamp: text('timestamp').notNull().default(sql`CURRENT_TIMESTAMP`),
  level: text('level').notNull().default('INFO'),
  category: text('category').notNull(),
  message: text('message').notNull(),
  detailsJson: text('details_json'),
  correlationId: text('correlation_id'),
}, (table) => ({
  controllerTimestampIndex: index('idx_automation_logs_controller_timestamp').on(table.controllerId, table.timestamp),
  levelTimestampIndex: index('idx_automation_logs_level_timestamp').on(table.level, table.timestamp),
  eventIndex: index('idx_automation_logs_event').on(table.eventId),
  levelCheck: check('chk_automation_logs_level', sql`${table.level} IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')`),
}));

export const automationSettings = sqliteTable('automation_settings', {
  id: text('id').primaryKey(),
  stationId: text('station_id').notNull().references(() => stationSettings.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  settingKey: text('setting_key').notNull(),
  settingValueJson: text('setting_value_json').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  stationKeyUnique: uniqueIndex('idx_automation_settings_station_key').on(table.stationId, table.settingKey),
}));

export const automationLiveForecourtState = sqliteTable('automation_live_forecourt_state', {
  controllerId: text('controller_id').notNull().references(() => automationControllers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  deviceType: text('device_type').notNull(),
  externalParentId: text('external_parent_id').notNull().default(''),
  externalDeviceId: text('external_device_id').notNull().default(''),
  operationalState: text('operational_state').notNull().default('UNKNOWN'),
  activityJson: text('activity_json').notNull().default('{}'),
  lastEventType: text('last_event_type').notNull(),
  lastEventId: text('last_event_id').notNull(),
  sourceOccurredAt: text('source_occurred_at').notNull(),
  receivedAt: text('received_at').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => ({
  primaryKey: primaryKey({ columns: [table.controllerId,table.deviceType,table.externalParentId,table.externalDeviceId] }),
  freshnessIndex: index('idx_live_forecourt_state_freshness').on(table.receivedAt),
  controllerTypeIndex: index('idx_live_forecourt_state_controller_type').on(table.controllerId,table.deviceType),
  deviceTypeCheck: check('chk_live_forecourt_device_type', sql`${table.deviceType} IN ('CONTROLLER','PUMP','NOZZLE')`),
  operationalStateCheck: check('chk_live_forecourt_operational_state', sql`${table.operationalState} IN ('ONLINE','OFFLINE','IDLE','AUTHORIZED','DISPENSING','STOPPED','ERROR','UNKNOWN')`),
}));
