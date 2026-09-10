import { TAX_RATE_MAP, type TaxCode, TAX_CODES, TAX_CODE_LABELS, normalizeTaxCode } from './constants/tax.ts';

// Role is now a string to support custom roles
export type Role = string;

export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  STATION_MANAGER: 'Station Manager',
  AUDITOR: 'Auditor',
  FUEL_ATTENDANT: 'Fuel Attendant',
  SHOP_ATTENDANT: 'Shop Attendant',
  CASHIER: 'Cashier',
  NORMAL_USER: 'Normal User',
  STANDARD_USER: 'Standard User',
} as const;

export { TAX_RATE_MAP as TAX_RATE_BY_TYPE, TAX_CODES, TAX_CODE_LABELS, normalizeTaxCode, type TaxCode };

export const ADMIN_ROLES: readonly Role[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN];
export const SENSITIVE_ADMIN_ROLES: readonly Role[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN];
export const OPERATIONAL_ROLES: readonly Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.STATION_MANAGER,
  ROLES.AUDITOR,
  ROLES.FUEL_ATTENDANT,
  ROLES.SHOP_ATTENDANT,
  ROLES.CASHIER,
  ROLES.NORMAL_USER,
  ROLES.STANDARD_USER,
];
export const STANDARD_USER_ROLES: readonly Role[] = [ROLES.NORMAL_USER, ROLES.STANDARD_USER];

// ============================================================
// PERMISSIONS – includes all granular shop actions
// ============================================================
export const PERMISSIONS = [
  // View permissions
  'VIEW_USERS',
  'VIEW_INVOICES',
  'VIEW_SHOP',
  'VIEW_STOCK',
  'VIEW_PUMPS',
  'VIEW_APPROVALS',
  'VIEW_SETTINGS',
  'VIEW_SUPPLIERS',
  'VIEW_CASH_FLOW',
  'VIEW_THREE_WAY_LEDGER',
  'VIEW_AUDIT_TRAIL',
  'VIEW_REPORTS',
  'VIEW_SHIFT_USERS',
  'VIEW_DIP_VARIANCE',
  'VIEW_AUTOMATION',
  'VIEW_AUTOMATION_LOGS',
  'VIEW_DEVICE_MAPPINGS',
  'VIEW_ATG_TANK_MONITORING',
  'VIEW_RECONCILIATION',
  'RUN_RECONCILIATION',
  'MANAGE_RECONCILIATION_SETTINGS',
  'VIEW_ALERTS','ACKNOWLEDGE_ALERTS','RESOLVE_ALERTS','MANAGE_ALERT_RULES','MANAGE_NOTIFICATION_SETTINGS',

  // Action permissions
  'CREATE_SHIFT',
  'EDIT_SHIFT',
  'ASSIGN_SHIFT_USERS',
  'REMOVE_SHIFT_USERS',
  'CLOCK_IN_OTHER_USERS',
  'CREATE_USER',
  'MANAGE_USERS',
  'RESET_USER_PASSWORD',

  // Legacy shop permission (kept for backward compatibility)
  'MANAGE_SHOP_ITEMS',

  // Granular shop inventory permissions (used in ShopInventory)
  'CREATE_SHOP_ITEM',
  'UPDATE_SHOP_ITEM',
  'DELETE_SHOP_ITEM',
  'BULK_UPLOAD_SHOP_ITEMS',
  'ADJUST_STOCK',

  // Other action permissions
  'EDIT_PRICE',
  'MANAGE_PUMPS',
  'DELETE_PUMP',
  'REVIEW_DIP_VARIANCE',
  'RESOLVE_DIP_VARIANCE',
  'MANAGE_SUPPLIERS',
  'RECORD_SUPPLIER_PAYOUT',
  'MANAGE_CASH_FLOW',
  'MANAGE_THREE_WAY_LEDGER',
  'CREATE_CREDIT_NOTE',
  'MANAGE_CREDIT_CUSTOMERS',
  'DELETE_CUSTOMER',
  'RECORD_CREDIT_PAYMENT',
  'DELETE_SUPPLIER',
  'MANAGE_APPROVALS',
  'MANAGE_SETTINGS',
  'MANAGE_CONTROLLERS',
  'MANAGE_DEVICE_MAPPINGS',
] as const;

export type Permission = typeof PERMISSIONS[number];

export const normalizeRole = (role?: string | null): Role => {
  const candidate = String(role || '').trim();
  if (candidate === 'super-admin' || candidate === 'Super Admin') return ROLES.SUPER_ADMIN;
  if (candidate === 'admin' || candidate === 'Admin') return ROLES.ADMIN;
  if (candidate === 'station-manager' || candidate === 'Station Manager') return ROLES.STATION_MANAGER;
  if (candidate === 'auditor' || candidate === 'Auditor') return ROLES.AUDITOR;
  if (candidate === 'fuel-attendant' || candidate === 'Fuel Attendant') return ROLES.FUEL_ATTENDANT;
  if (candidate === 'shop-attendant' || candidate === 'Shop Attendant') return ROLES.SHOP_ATTENDANT;
  if (candidate === 'cashier' || candidate === 'Cashier') return ROLES.CASHIER;
  if (candidate === 'normal-user' || candidate === 'Normal User') return ROLES.NORMAL_USER;
  if (candidate === 'standard-user' || candidate === 'Standard User') return ROLES.STANDARD_USER;
  // Preserve custom role names rather than silently demoting them.
  return candidate || ROLES.NORMAL_USER;
};

export const isSuperAdmin = (role?: string | null) => normalizeRole(role) === ROLES.SUPER_ADMIN;
export const isAdmin = (role?: string | null) => isSuperAdmin(role) || normalizeRole(role) === ROLES.ADMIN;
export const isStandardUser = (role?: string | null) => STANDARD_USER_ROLES.includes(normalizeRole(role) as typeof STANDARD_USER_ROLES[number]);

export const canAccessModule = (moduleId: string, role?: string | null, permissions?: Permission[]): boolean => {
  // Only Super Admin bypasses; Admin and others must have the View permission explicitly.
  const hasPermission = (perm: Permission) =>
    isSuperAdmin(role) || (permissions?.includes(perm) ?? false);

  const moduleViewPermissions: Record<string, Permission> = {
    users: 'VIEW_USERS',
    settings: 'VIEW_SETTINGS',
    audit: 'VIEW_AUDIT_TRAIL',
    stock: 'VIEW_STOCK',
    pumps: 'VIEW_PUMPS',
    shop: 'VIEW_SHOP',
    reports: 'VIEW_REPORTS',
    cashflow: 'VIEW_CASH_FLOW',
    suppliers: 'VIEW_SUPPLIERS',
    reconciliation: 'VIEW_THREE_WAY_LEDGER',
    approvals: 'VIEW_APPROVALS',
    invoices: 'VIEW_INVOICES',
    shifts: 'VIEW_SHIFT_USERS',
    controllers: 'VIEW_AUTOMATION',
    meters: 'VIEW_AUTOMATION',
    atg: 'VIEW_ATG_TANK_MONITORING',
    'automation-reconciliation': 'VIEW_RECONCILIATION',
    alerts: 'VIEW_ALERTS',
    'device-mappings': 'VIEW_DEVICE_MAPPINGS',
  };

  const required = moduleViewPermissions[moduleId];
  if (!required) return true;
  return hasPermission(required);
};

// ============================================================
// USER & OTHER TYPES (unchanged)
// ============================================================

export interface User {
  id: string;
  name: string;
  username?: string;
  email: string;
  phone: string;
  role: Role;
  pin: string;
  active: boolean;
  status?: 'Active' | 'Inactive' | 'Suspended';
  currentShiftId?: string | null;
  assignedPumps?: string[];
  createdAt?: string;
  lastLogin?: string;
  employeeId?: string;
  department?: string;
  jobTitle?: string;
  permissions?: Permission[];
  mustChangePassword?: boolean;
}

export type ItemCountry = 'KE' | 'UG' | 'TZ' | 'US' | 'UK' | 'EU' | 'NG' | 'ZA';
export type ItemCurrency = 'KES' | 'UGX' | 'TZS' | 'USD' | 'GBP' | 'EUR' | 'NGN' | 'ZAR';
export type ItemProductType = 1 | 2 | 3;
export type ItemUnit = 'Pieces' | 'KG' | 'Litre' | 'Box' | 'Carton' | 'Bag' | 'Bottle' | 'Pack' | 'Set' | 'Roll' | 'Can';

export const ITEM_COUNTRIES: readonly ItemCountry[] = ['KE', 'UG', 'TZ', 'US', 'UK', 'EU', 'NG', 'ZA'];
export const ITEM_CURRENCIES: readonly ItemCurrency[] = ['KES', 'UGX', 'TZS', 'USD', 'GBP', 'EUR', 'NGN', 'ZAR'];
export const ITEM_UNITS: readonly ItemUnit[] = ['Pieces', 'KG', 'Litre', 'Box', 'Carton', 'Bag', 'Bottle', 'Pack', 'Set', 'Roll', 'Can'];
export const ITEM_TAX_TYPES: readonly TaxCode[] = ['A', 'B', 'C', 'D', 'E'];

export interface FuelProduct {
  id: string;
  code: string;
  name: string;
  pricePerLiter: number;
  costPerLiter: number;
  taxRate: number;
  taxCode?: TaxCode;
  unit: string;
  color: string;
}

export interface FuelTank {
  id: string;
  tankName: string;
  fuelProductId: string;
  fuelName: string;
  capacityLiters: number;
  currentLevelLiters: number;
  reorderLevelLiters: number;
  lastDipReading: number;
  lastDipTime: string;
}

export interface FuelPump {
  id: string;
  pumpNumber: number;
  pumpName: string;
  status: 'Active' | 'Inactive' | 'Maintenance';
}

export interface PumpNozzle {
  id: string;
  physicalPumpId?: string | null;
  nozzleNumber?: number;
  nozzleName?: string;
  pumpNumber: number;
  pumpName: string;
  tankId: string;
  fuelProductId: string;
  fuelName: string;
  openingMeterReading: number;
  currentMeterReading: number;
  meterSource?: 'PTS2' | 'MANUAL';
  previousClosingMeter?: number;
  previousShiftEnd?: string;
  status: 'Active' | 'Inactive' | 'Maintenance' | 'Offline';
}

export interface NozzleReading {
  id: string;
  nozzleId: string;
  pumpId?: string | null;
  tankId: string;
  fuelProductId: string;
  shiftId?: string | null;
  transactionId?: string | null;
  previousReading: number;
  quantityDispensed: number;
  currentReading: number;
  readingType: 'Opening' | 'Sale' | 'Closing' | 'Adjustment' | 'Observation';
  recordedBy?: string | null;
  timestamp: string;
}

export interface ShopItem {
  id: string;
  code: string;
  name: string;
  category: string;
  unitPrice: number;
  price?: number;
  costPrice: number;
  stockQty: number;
  reorderLevel: number;
  requireShiftCount: boolean;
  taxCode?: TaxCode;
  taxType?: TaxCode;
  country?: ItemCountry;
  currency?: ItemCurrency;
  productType?: ItemProductType;
  unit?: ItemUnit;
}

export interface ShiftSchedule {
  id: string;
  assignmentId?: string;
  shiftPlanId?: string;
  recurrenceId?: string | null;
  staffId: string;
  staffName: string;
  role: Role;
  shiftType: 'Morning' | 'Evening' | 'Night';
  shiftName?: string;
  date: string;
  startTime: string;
  endTime: string;
  actualClockIn?: string | null;
  actualClockOut?: string | null;
  expiredAt?: string | null;
  missedReason?: string | null;
  status: 'Upcoming' | 'Due' | 'In Progress' | 'Completed' | 'Stale' | 'Cancelled';
}

export interface ShiftAssignment {
  id: string;
  shiftPlanId: string;
  userId: string;
  userName: string;
  userRole: Role;
  status: 'Assigned' | 'Upcoming' | 'Due' | 'In Progress' | 'Completed' | 'Stale' | 'Cancelled' | 'Removed From Assignment';
  assignedAt: string;
  assignedBy: string;
  removedAt?: string | null;
  removedBy?: string | null;
  clockInShiftId?: string | null;
  clockInTime?: string | null;
  clockOutTime?: string | null;
  expiredAt?: string | null;
  missedReason?: string | null;
}

export interface ShiftPlan {
  id: string;
  recurrenceId?: string | null;
  name: string;
  shiftType: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: 'Scheduled' | 'Active' | 'Completed' | 'Closed';
  createdBy: string;
  createdAt: string;
  assignments: ShiftAssignment[];
}

export interface OpeningPumpReading {
  pumpId: string;
  pumpName: string;
  fuelName: string;
  openingMeter: number;
  reportedOpeningMeter?: number;
  authoritativeOpeningMeter?: number;
  previousShiftId?: string;
  previousShiftEnd?: string;
  unattendedMeterLiters?: number;
  unattendedSalesLiters?: number;
  unattendedVarianceLiters?: number;
  unattendedTransactionIds?: string[];
  variance?: number;
}

export interface OpeningTankDip {
  tankId: string;
  tankName: string;
  fuelName: string;
  openingDip: number;
  reportedOpeningDip?: number;
  authoritativeQuantity?: number;
  variance?: number;
}

export interface ReadingVariance {
  id: string;
  shiftId: string;
  readingType: 'Tank Dip' | 'Nozzle Meter';
  tankId: string;
  nozzleId?: string | null;
  reportedValue: number;
  authoritativeValue: number;
  variance: number;
  status: 'Review Required' | 'Reviewed' | 'Resolved';
  recordedBy: string;
  recordedAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolutionNotes?: string | null;
}

export interface StationSettings {
  id?: string;
  stationName: string;
  tagline: string;
  taxPin: string;
  address: string;
  phone: string;
  email: string;
  invoiceTerms: string;
  paybillNumber: string;
  paybillAccountNumber: string;
  tillNumber: string;
  showPaybillOnInvoice: boolean;
  showTillOnInvoice: boolean;
}

export interface CustomerAccount {
  id: string;
  name: string;
  kraPin?: string;
  phone: string;
  email?: string;
  address?: string;
  creditLimit: number;
  currentBalance: number;
  vehicles: string[];
  status: 'Active' | 'Suspended' | 'Blocked';
  createdAt: string;
}

export interface CashFlowRecord {
  id: string;
  timestamp: string;
  type: 'Inflow' | 'Outflow';
  category: 'Fuel Sales' | 'Shop Sales' | 'Debt Repayment' | 'Fuel Delivery Payment' | 'Supplier Payment' | 'Operating Expense' | 'Bank Drop' | 'Credit Note' | 'Other';
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNo?: string;
  description: string;
  recordedBy: string;
}

export interface CreditNoteItem {
  itemId: string;
  originalItemId?: string;
  name: string;
  type: 'Fuel' | 'Shop';
  qty: number;
  quantity?: number;
  unitPrice: number;
  totalPrice: number;
  totalAmount?: number;
  taxAmount: number;
  taxRate?: number;
  taxableAmount?: number;
  taxCode?: TaxCode;
}

export interface CreditNote {
  id: string;
  creditNoteNo: string;
  originalTransactionId?: string;
  originalDocumentType?: 'invoice' | 'receipt';
  originalDocumentNo?: string;
  originalInvoiceNo: string;
  originalReceiptNo?: string;
  timestamp: string;
  customerName: string;
  customerPin?: string;
  vehiclePlate?: string;
  items: CreditNoteItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  totalTaxAmount?: number;
  reason: string;
  issuedBy: string;
  issuedByName?: string;
  status: 'Issued' | 'Voided';
}

export interface ShiftSession {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: Role;
  shiftType: 'Morning' | 'Evening' | 'Night';
  startTime: string;
  endTime?: string | null;
  status: 'Active' | 'Reconciling' | 'Completed' | 'Pending Approval' | 'Flagged';
  openingCash: number;
  openingPumpReadings?: OpeningPumpReading[];
  openingTankDips?: OpeningTankDip[];
  closingPumpReadings?: PumpReconciliationReading[];
  closingTankDips?: TankReconciliationDip[];
  totalFuelSales: number;
  totalShopSales: number;
  totalExpectedCash: number;
  actualCashCount?: number | null;
  cashVariance?: number | null;
  fuelVarianceLiters?: number | null;
  tankVarianceLiters?: number | null;
  isLate?: boolean;
  approvalStatus?: 'Approved' | 'Pending' | 'Rejected' | 'Overridden';
  managerNotes?: string;
}

export interface SaleItem {
  itemId: string;
  pumpId?: string;
  nozzleId?: string;
  name: string;
  type: 'Fuel' | 'Shop';
  qty: number;
  unitPrice: number;
  totalPrice: number;
  totalAmount?: number;
  taxAmount: number;
  taxRate?: number;
  taxableAmount?: number;
  taxCode: TaxCode;
}

export type PaymentMethod = 'Cash' | 'M-Pesa' | 'Card' | 'Credit' | 'Bank Transfer' | 'Unassigned';
export type SaleCategory = 'FUEL' | 'SHOP' | 'OTHER';

export interface Transaction {
  id: string;
  receiptNo: string;
  taxInvoiceNo?: string;
  originalDocumentNo?: string;
  originalDocumentType?: 'invoice' | 'receipt';
  originalInvoiceNo?: string;
  originalReceiptNo?: string;
  documentType?: 'Receipt' | 'Invoice' | 'Credit Note' | 'Automation Capture';
  source?: 'MANUAL' | 'AUTOMATION';
  qrCodeUrl?: string;
  timestamp: string;
  shiftId: string;
  dispensedWithoutShift?: boolean;
  meterReconciliationShiftId?: string;
  settlementShiftId?: string;
  settledAt?: string;
  staffId: string;
  staffName: string;
  type: 'Fuel' | 'Shop' | 'Combined';
  saleCategory?: SaleCategory;
  items: SaleItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentRef?: string;
  customerName?: string;
  vehiclePlate?: string;
  customerPin?: string;
  status: 'Completed' | 'Voided' | 'Payment Pending';
}

export interface PumpReconciliationReading {
  pumpId: string;
  pumpName: string;
  fuelName: string;
  openingMeter: number;
  closingMeter: number;
  meterSalesLiters: number;
  posSalesLiters: number;
  varianceLiters: number;
  reportedClosingMeter?: number | null;
  authoritativeClosingMeter?: number;
  reportedVarianceLiters?: number | null;
  unattendedMeterLiters?: number;
  unattendedSalesLiters?: number;
  staffedMeterLiters?: number;
}

export interface TankReconciliationDip {
  tankId: string;
  tankName: string;
  fuelName: string;
  openingDip: number;
  closingDip: number;
  calculatedUsage: number;
  actualSales: number;
  varianceLiters: number;
}

export interface ThreeWayReconciliation {
  id: string;
  shiftId: string;
  staffId: string;
  staffName: string;
  timestamp: string;
  expectedCash: number;
  cashCount: {
    notes1000: number;
    notes500: number;
    notes200: number;
    notes100: number;
    notes50: number;
    coins: number;
    mpesaDirect: number;
    cardDirect: number;
    creditDirect: number;
  };
  totalActualCash: number;
  cashVariance: number;
  pumpReadings: PumpReconciliationReading[];
  totalPumpVarianceLiters: number;
  tankDips: TankReconciliationDip[];
  totalTankVarianceLiters: number;
  status: 'Auto-Approved' | 'Warning' | 'Pending Approval' | 'Approved' | 'Rejected' | 'Overridden';
  managerId?: string;
  managerNotes?: string;
}

export interface FuelDelivery {
  id: string;
  supplierId?: string;
  timestamp: string;
  tankId: string;
  tankName: string;
  supplierName: string;
  deliveryNoteNo: string;
  litersReceived: number;
  costPerLiter: number;
  totalCost: number;
  openingLevel: number;
  closingLevel: number;
  driverName: string;
  truckPlate: string;
  receivedBy: string;
}

export interface ManagerApproval {
  id: string;
  timestamp: string;
  shiftId?: string;
  type: 'Cash Variance' | 'Fuel Discrepancy' | 'Price Override' | 'Shift Cancellation' | 'Nozzle Reading Variance' | 'Unattended Sales Variance';
  reviewScope?: 'READING';
  readingVarianceId?: string;
  requestedBy: string;
  reason: string;
  amountOrQty: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  managerId?: string;
  managerNotes?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: Role;
  action: string;
  module: 'Auth' | 'Sales' | 'Shifts' | 'Reconciliation' | 'Tanks' | 'Shop' | 'Approvals' | 'Settings' | 'Suppliers' | 'Stock' | 'Automation';
  details: string;
  ipAddress: string;
  severity: 'Info' | 'Warning' | 'Critical';
}

export interface SupplierAccount {
  id: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  kraPin?: string;
  currentBalance: number;
  paymentTerms?: string;
  status: 'Active' | 'Inactive';
  createdAt: string;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  timestamp: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNo?: string;
  deliveryNoteNo?: string;
  notes?: string;
  recordedBy: string;
}

export interface StockAdjustment {
  id: string;
  timestamp: string;
  type: 'Fuel' | 'Shop';
  itemId: string;
  itemName: string;
  itemCode?: string;
  previousQty: number;
  adjustedQty: number;
  differenceQty: number;
  reason: 'Damage/Spill' | 'Stock Take Audit' | 'Calibration' | 'Theft/Loss' | 'Initial Count' | 'Restock' | 'Other' | string;
  movementType?: 'Stock Increase' | 'Stock Decrease' | 'Stock Return' | 'Restock' | 'Manual Adjustment' | 'Legacy Adjustment' | string;
  source?: 'Manual Adjustment' | 'Credit Note' | 'Restock' | 'Legacy Adjustment' | 'System' | string;
  referenceNumber?: string;
  originalDocumentNumber?: string;
  performedBy?: string;
  notes?: string;
  recordedBy: string;
}
