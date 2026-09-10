import {
  User,
  FuelProduct,
  FuelTank,
  PumpNozzle,
  ShopItem,
  ShiftSession,
  Transaction,
  ThreeWayReconciliation,
  FuelDelivery,
  ManagerApproval,
  AuditLog,
  ShiftSchedule,
  StationSettings,
  CreditNote,
  CustomerAccount,
  CashFlowRecord,
  SupplierAccount,
  StockAdjustment,
} from '../types';

export const INITIAL_USERS: User[] = [];

export const INITIAL_PRODUCTS: FuelProduct[] = [];

export const INITIAL_TANKS: FuelTank[] = [];

export const INITIAL_PUMPS: PumpNozzle[] = [];

export const INITIAL_SHOP_ITEMS: ShopItem[] = [];

export const INITIAL_SHIFTS: ShiftSession[] = [];

export const INITIAL_SCHEDULES: ShiftSchedule[] = [];

export const INITIAL_TRANSACTIONS: Transaction[] = [];

export const INITIAL_DELIVERIES: FuelDelivery[] = [];

export const INITIAL_APPROVALS: ManagerApproval[] = [];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [];

export const INITIAL_STATION_SETTINGS: StationSettings = {
  stationName: 'DT-FMS Station',
  tagline: 'Fuel management with full accountability',
  taxPin: '',
  address: '',
  phone: '',
  email: '',
  invoiceTerms: '',
  paybillNumber: '',
  paybillAccountNumber: '',
  tillNumber: '',
  showPaybillOnInvoice: true,
  showTillOnInvoice: false,
};

export const INITIAL_CREDIT_NOTES: CreditNote[] = [];

export const INITIAL_CUSTOMERS: CustomerAccount[] = [];

export const INITIAL_CASH_FLOW: CashFlowRecord[] = [];

export const INITIAL_SUPPLIERS: SupplierAccount[] = [];

export const INITIAL_STOCK_ADJUSTMENTS: StockAdjustment[] = [];


