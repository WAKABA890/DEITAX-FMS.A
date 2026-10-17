import { recordManualTankDip } from './src/automation/tank-stock.js';
import { nextDocumentSequence } from './src/utils/document-sequence.ts';
import { previousNozzleClosings, recordMeterReview } from './src/automation/meters/shift-meter-records.ts';
import { buildOpeningNozzleReadings, buildClosingNozzleReadings, hasMeterVariance } from './src/utils/shift-meter-readings.ts';
import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { closeGlobalDatabase, getSqlite } from './src/database/db.js';
import {
  deleteProductAndLinkedRecords,
  deletePumpNozzleAndLinkedRecords,
  deleteTankAndLinkedRecords,
  ensurePumpRecord,
} from './src/database/cleanup.js';
import { initializeDatabaseMiddleware } from './src/server/db-middleware.js';
import {
  INITIAL_USERS,
  INITIAL_PRODUCTS,
  INITIAL_TANKS,
  INITIAL_PUMPS,
  INITIAL_SHOP_ITEMS,
  INITIAL_SHIFTS,
  INITIAL_SCHEDULES,
  INITIAL_TRANSACTIONS,
  INITIAL_DELIVERIES,
  INITIAL_APPROVALS,
  INITIAL_AUDIT_LOGS,
  INITIAL_CUSTOMERS,
  INITIAL_CASH_FLOW,
  INITIAL_SUPPLIERS,
  INITIAL_STOCK_ADJUSTMENTS,
  INITIAL_CREDIT_NOTES,
  INITIAL_STATION_SETTINGS,
} from './src/data/initialData.js';
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
  SupplierPayment,
  StockAdjustment,
  TaxCode,
  PERMISSIONS,
} from './src/types.js';
import { TAX_RATE_MAP, normalizeTaxCode as normalizeTaxCodeValue } from './src/constants/tax.ts';
import { computeDocumentTotals } from './src/utils/documentTotals.ts';
import { normalizeStockAdjustmentsFromDatabase, rebuildShiftSummaries } from './src/utils/shift-summary.ts';
import { buildDashboardSalesSummary } from './src/utils/sales-summary.ts';
import { initializeAutomationFoundation } from './src/automation/initialize.ts';
import { createControllerRouter } from './src/automation/api/controller-router.ts';
import { createMappingRouter } from './src/automation/api/mapping-router.ts';
import { AdapterManager } from './src/automation/adapters/adapter-manager.ts';
import { createRuntimeRouter } from './src/automation/api/runtime-router.ts';
import { createLiveForecourtRouter } from './src/automation/api/live-forecourt-router.ts';
import { createMeterRouter } from './src/automation/api/meter-router.ts';
import { createAtgRouter } from './src/automation/api/atg-router.ts';
import { createAutomationReconciliationRouter } from './src/automation/api/reconciliation-router.ts';
import { createAlertRouter } from './src/automation/api/alert-router.ts';
import { RecoveryCoordinator } from './src/automation/recovery/recovery-coordinator.ts';
import { createRecoveryRouter } from './src/automation/api/recovery-router.ts';
import { createPts2PriceRouter } from './src/automation/api/pts2-price-router.ts';
import { createApprovalRouter } from './src/server/modules/approvals/approval-router.ts';

const VITE_HMR_PORT = 5173;

export interface StartServerOptions {
  port?: number;
  staticDir?: string;
}

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {}
): Promise<StartedServer> {
  const app = express();

  const staticDir =
    options.staticDir ||
    process.env.FMS_STATIC_DIR ||
    path.dirname(fileURLToPath(import.meta.url));

  const PORT =
    options.port ??
    (process.env.PORT ? Number(process.env.PORT) : 0);

  if (!Number.isFinite(PORT) || PORT < 0 || PORT > 65535) {
    throw new Error(`Invalid server port: ${PORT}`);
  }

  let shuttingDown = false;
  let viteDevServer: any = null;
  let adapterManager: AdapterManager | null = null;
  let recoveryCoordinator: RecoveryCoordinator | null = null;

  const closeServer = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (adapterManager) await Promise.race([adapterManager.shutdown(),new Promise<void>(resolve=>setTimeout(resolve,5000))]);

    if (viteDevServer && typeof viteDevServer.close === 'function') {
      await Promise.resolve(viteDevServer.close());
      viteDevServer = null;
    }

    if (server && server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    closeGlobalDatabase();
  };

  const shutdown = async () => {
    console.log('\nShutting down development server...');
    try {
      await closeServer();
      console.log('Development server stopped.');
      process.exit(0);
    } catch (error) {
      console.error('Error shutting down development server:', error);
      process.exit(1);
    }
  };

  const server = app.listen(PORT, '127.0.0.1');

  const startup = new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n❌ Development port ${PORT} is already in use.`);
      return;
    }
    console.error('Server startup error:', error);
  });

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  app.use(express.json({ limit: '10mb' }));

  const db = initializeDatabaseMiddleware();
  console.log('✅ Database initialized');

  // Phase 1 performs a read-only foundation check only. This initializer owns
  // no sockets or device lifecycle and degrades safely without blocking core FMS.
  const automationFoundation = initializeAutomationFoundation(getSqlite());
  console.log(`[Automation] ${automationFoundation.message}`);
  recoveryCoordinator = new RecoveryCoordinator(getSqlite());
  try { recoveryCoordinator.recoverStartup(); } catch (error) { console.warn(`[Recovery] Startup recovery degraded safely: ${error instanceof Error ? error.message : error}`); }
  adapterManager = new AdapterManager(getSqlite());
  if (automationFoundation.enabled) void adapterManager.loadEnabled().catch((error) => console.warn(`[Automation] Adapter startup isolated: ${error instanceof Error ? error.message : error}`));

  const normalizeSupplierRecord = (supplier: any) => ({
    ...supplier,
    id: supplier.id || supplier.supplierId || 'sup-' + Date.now(),
    name: supplier.name || supplier.supplierName || 'Unnamed Supplier',
    contactPerson: supplier.contactPerson ?? supplier.contact_person ?? '',
    phone: supplier.phone || supplier.contactPhone || '',
    email: supplier.email ?? null,
    address: supplier.address ?? null,
    kraPin: supplier.kraPin ?? supplier.taxId ?? null,
    currentBalance: Number(supplier.currentBalance ?? supplier.accountBalance ?? 0),
    paymentTerms: supplier.paymentTerms ?? supplier.payment_terms ?? 'Net 14 Days',
    status: supplier.status || 'Active',
    createdAt: supplier.createdAt || new Date().toISOString(),
  });

  const normalizeCustomerRecord = (customer: any) => ({
    ...customer,
    id: customer.id || customer.customerId || 'cust-' + Date.now(),
    name: customer.name || customer.businessName || 'Unnamed Customer',
    kraPin: customer.kraPin ?? customer.taxId ?? '',
    phone: customer.phone || customer.contactPhone || '',
    email: customer.email ?? '',
    address: customer.address ?? '',
    creditLimit: Number(customer.creditLimit ?? customer.credit_limit ?? 0),
    currentBalance: Number(customer.currentBalance ?? customer.currentDebt ?? 0),
    vehicles: Array.isArray(customer.vehicles)
      ? customer.vehicles
      : Array.isArray(customer.vehiclePlates)
        ? customer.vehiclePlates
        : [],
    status: customer.status || 'Active',
    createdAt: customer.createdAt || new Date().toISOString(),
  });

  const persistentData = db.getAllData() as any;
  const hasPersistedDocumentRecords = (Array.isArray(persistentData.transactions) && persistentData.transactions.length > 0)
    || (Array.isArray(persistentData.creditNotes) && persistentData.creditNotes.length > 0)
    || (Array.isArray(persistentData.deliveries) && persistentData.deliveries.length > 0)
    || (Array.isArray(persistentData.cashFlow) && persistentData.cashFlow.length > 0);

  const allData = persistentData;
  let users: User[] = (allData.users as User[]) ?? [];
  let products: FuelProduct[] = (allData.products as FuelProduct[]) ?? [];

  const normalizeRoleName = (value?: string | null) => {
    const candidate = String(value || '').trim();
    if (!candidate) return 'Normal User';
    const normalized = candidate.toLowerCase().replace(/[^a-z]+/g, '-');
    if (normalized === 'super-admin' || candidate === 'Super Admin') return 'Super Admin';
    if (normalized === 'admin' || candidate === 'Admin') return 'Admin';
    if (normalized === 'station-manager' || candidate === 'Station Manager') return 'Station Manager';
    if (normalized === 'auditor' || candidate === 'Auditor') return 'Auditor';
    if (normalized === 'fuel-attendant' || candidate === 'Fuel Attendant') return 'Fuel Attendant';
    if (normalized === 'shop-attendant' || candidate === 'Shop Attendant') return 'Shop Attendant';
    if (normalized === 'cashier' || candidate === 'Cashier') return 'Cashier';
    if (normalized === 'normal-user' || candidate === 'Normal User') return 'Normal User';
    if (normalized === 'standard-user' || candidate === 'Standard User') return 'Standard User';
    return candidate || 'Normal User';
  };

  const isSuperAdminRole = (role?: string | null) => normalizeRoleName(role) === 'Super Admin';
  const isAdminRole = (role?: string | null) => isSuperAdminRole(role) || normalizeRoleName(role) === 'Admin';
  const isStandardUserRole = (role?: string | null) => ['Normal User', 'Standard User'].includes(normalizeRoleName(role));
  type Permission = import('./src/types.js').Permission;
  const getPermissions = (userId: string): Permission[] => getSqlite().prepare(`
    SELECT permission FROM user_permissions WHERE user_id = ?
    UNION
    SELECT rp.permission FROM users u JOIN custom_roles r ON lower(r.name)=lower(u.role)
    JOIN custom_role_permissions rp ON rp.role_id=r.id WHERE u.id=? AND r.status='ACTIVE'
    ORDER BY permission
  `).all(userId,userId).map((row: any) => row.permission as Permission);
  const getUserById = (userId: string): User | undefined => db.userQueries.byId(userId) as any;
  const hasPermission = (user: User | undefined, permission: Permission) => {
    if (!user) return false;
    // Every role except Super Admin requires an explicit permission grant.
    if (isSuperAdminRole(user.role)) return true;
    const stationManagerVariancePermission = normalizeRoleName(user.role) === 'Station Manager'
      && ['VIEW_DIP_VARIANCE', 'REVIEW_DIP_VARIANCE', 'RESOLVE_DIP_VARIANCE'].includes(permission);
    return stationManagerVariancePermission || getPermissions(user.id).includes(permission);
  };
  const isValidPin = (value: unknown) => /^\d{4,6}$/.test(String(value ?? ''));
  const hashPin = (pin: string) => {
    const salt = randomBytes(16).toString('base64');
    const derivedKey = scryptSync(pin, salt, 64).toString('base64');
    return `scrypt$${salt}$${derivedKey}`;
  };
  const verifyStoredPin = (storedValue: unknown, submittedPin: unknown) => {
    const storedPin = String(storedValue ?? '');
    const candidatePin = String(submittedPin ?? '');
    if (!isValidPin(candidatePin)) return { valid: false, legacy: false };
    if (!storedPin.startsWith('scrypt$')) {
      const sameLength = Buffer.byteLength(storedPin) === Buffer.byteLength(candidatePin);
      return { valid: sameLength && timingSafeEqual(Buffer.from(storedPin), Buffer.from(candidatePin)), legacy: true };
    }
    const [, salt, encodedKey] = storedPin.split('$');
    if (!salt || !encodedKey) return { valid: false, legacy: false };
    const expected = Buffer.from(encodedKey, 'base64');
    const actual = scryptSync(candidatePin, salt, expected.length);
    return { valid: expected.length === actual.length && timingSafeEqual(expected, actual), legacy: false };
  };
  const toAuthenticatedUser = (user: User): User => ({ ...user, pin: undefined as any, permissions: getPermissions(user.id) });
  const requirePermission = (req: any, res: any, permission: Permission, action: string) => {
    if (hasPermission(req.authUser, permission)) return null;
    if (req.authUser) addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'PERMISSION_DENIED', 'Auth', `Blocked ${action}; requires ${permission}.`, 'Warning');
    return res.status(403).json({ success: false, message: `Permission required: ${permission}.` });
  };
  const delegatedPermissionForMutation = (method: string, path: string): Permission | null => {
    if (method === 'POST' && path === '/shift-plans') return 'CREATE_SHIFT';
    if (method === 'POST' && /^\/shift-plans\/[^/]+\/assignments$/.test(path)) return 'ASSIGN_SHIFT_USERS';
    if (method === 'DELETE' && /^\/shift-plans\/[^/]+\/assignments\/[^/]+$/.test(path)) return 'REMOVE_SHIFT_USERS';
    if (method === 'POST' && path === '/users') return 'CREATE_USER';
    if (method === 'PUT' && /^\/users\/[^/]+\/permissions$/.test(path)) return 'MANAGE_USERS';
    if (method === 'POST' && /^\/users\/[^/]+\/reset-pin$/.test(path)) return 'RESET_USER_PASSWORD';
    if (method === 'POST' && /^\/reading-variances\/[^/]+\/review$/.test(path)) return 'REVIEW_DIP_VARIANCE';
    if (method === 'POST' && /^\/reading-variances\/[^/]+\/resolve$/.test(path)) return 'RESOLVE_DIP_VARIANCE';
    return null;
  };
  const restrictedPermissions = new Set<Permission>(['MANAGE_USERS', 'MANAGE_SETTINGS', 'DELETE_PUMP']);
  // requireRole function has been removed – we use requirePermission everywhere.

  const normalizeTaxCode = (value: string | undefined): TaxCode => {
    try {
      return normalizeTaxCodeValue(value ?? 'B');
    } catch {
      return 'B';
    }
  };

  const getTaxRateByCode = (taxCode: string | undefined) => {
    const normalized = normalizeTaxCode(taxCode);
    return TAX_RATE_MAP[normalized] ?? 0;
  };

  const inferFuelProductCost = (name: string) => {
    const normalized = String(name || '').toLowerCase();
    if (/(diesel|ago|gasoil)/.test(normalized)) return 145;
    if (/(petrol|gasoline|premium|unl|super)/.test(normalized)) return 170;
    return 150;
  };

  products = products.map((product) => {
    const safeCost = Number(product.costPerLiter ?? 0);
    const safePrice = Number(product.pricePerLiter ?? 0);
    const resolvedCost = safeCost > 0 ? safeCost : inferFuelProductCost(product.name);
    const resolvedPrice = safePrice > 0 ? safePrice : resolvedCost + 20;
    const taxCode = normalizeTaxCode((product as any).taxCode || (product as any).taxType || (
      Number(product.taxRate ?? 0) === 0.08 ? 'E' : Number(product.taxRate ?? 0) === 0.16 ? 'B' : 'A'
    ));
    const taxRate = Number(product.taxRate ?? getTaxRateByCode(taxCode));

    return {
      ...product,
      costPerLiter: resolvedCost,
      pricePerLiter: resolvedPrice,
      taxCode,
      taxRate,
    };
  });

  products.forEach((product) => {
    try {
      db.productQueries.update(product.id, {
        code: product.code,
        name: product.name,
        pricePerLiter: Number(product.pricePerLiter ?? product.costPerLiter ?? 0),
        costPerLiter: Number(product.costPerLiter ?? product.pricePerLiter ?? 0),
        taxRate: Number(product.taxRate ?? 0.16),
        taxCode: String(product.taxCode ?? 'B').toUpperCase(),
        unit: product.unit ?? 'L',
        color: product.color ?? '#10b981',
      } as any);
    } catch (error) {
      console.warn('Failed to normalize product cost:', product.name, error);
    }
  });

  let tanks: FuelTank[] = (allData.tanks as FuelTank[]) ?? [];
  app.use('/api',(_req,_res,next)=>{tanks=db.tankQueries.all() as FuelTank[];next();});
  let pumps: PumpNozzle[] = (allData.pumps as PumpNozzle[]) ?? [];
  let shopItems: ShopItem[] = (allData.shopItems as ShopItem[]) ?? [];
  const parseReadingList = (value: unknown) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  let shifts: ShiftSession[] = ((allData.shifts as ShiftSession[]) ?? []).map((shift: any) => ({
    ...shift,
    openingPumpReadings: parseReadingList(shift.openingPumpReadingsJson),
    openingTankDips: parseReadingList(shift.openingTankDipsJson),
    closingPumpReadings: parseReadingList(shift.closingPumpReadingsJson),
    closingTankDips: parseReadingList(shift.closingTankDipsJson),
  }));
  shifts = shifts.map((shift) => ({
    ...shift,
    status: shift.status === 'Active' ? 'Active' : shift.status,
    endTime: shift.status === 'Active' ? null : shift.endTime ?? null,
    approvalStatus: shift.status === 'Active' ? undefined : shift.approvalStatus,
  }));
  let schedules: ShiftSchedule[] = (allData.schedules as ShiftSchedule[]) ?? [];

  const normalizeDocumentNumber = (value: string | undefined, prefix: 'Rcpt' | 'Inv' | 'Cn') => {
    const raw = String(value ?? '').trim();
    const currentYear = new Date().getFullYear();

    if (!raw) {
      return `${prefix}-${currentYear}-0000`;
    }

    const yearMatch = raw.match(/-(\d{4})-/);
    const sequenceMatch = raw.match(/-(\d+)$/);

    const year = yearMatch ? yearMatch[1] : currentYear;
    const sequenceNumber = sequenceMatch ? Number(sequenceMatch[1]) : 0;

    return `${prefix}-${year}-${String(sequenceNumber).padStart(4, '0')}`;
  };

  const normalizeStoredTransaction = (tx: any): Transaction => {
    const normalizedReceiptNo = String(tx?.receiptNo ?? tx?.receiptNumber ?? tx?.receipt_number ?? '').trim();
    const normalizedInvoiceNo = String(tx?.taxInvoiceNo ?? tx?.invoiceNumber ?? tx?.invoice_number ?? '').trim();
    const rawDocumentType = String(
      tx?.documentType ?? tx?.document_type ?? (normalizedInvoiceNo ? 'Invoice' : 'Receipt')
    ).trim();
    const normalizedDocumentType = rawDocumentType.toLowerCase();
    const resolvedDocumentType = normalizedDocumentType === 'automation capture'
      ? 'Automation Capture'
      : normalizedDocumentType === 'invoice'
      ? 'Invoice'
      : normalizedDocumentType === 'credit note' || normalizedDocumentType === 'credit-note'
        ? 'Credit Note'
        : 'Receipt';
    const rawSaleType = String(tx?.type ?? '').trim().toLowerCase();
    const resolvedSaleType = rawSaleType === 'shop'
      ? 'Shop'
      : rawSaleType === 'fuel'
        ? 'Fuel'
        : (tx?.pumpId ?? tx?.pump_id ?? tx?.productId ?? tx?.product_id) ? 'Fuel' : 'Shop';

    let storedItems: any[] = Array.isArray(tx?.items) ? tx.items : [];
    const serializedItems = tx?.itemsJson ?? tx?.items_json;
    if (storedItems.length === 0 && typeof serializedItems === 'string') {
      try {
        storedItems = JSON.parse(serializedItems);
      } catch {
        storedItems = [];
      }
    }

    return {
      ...tx,
      id: String(tx?.id || 'tx-unknown'),
      receiptNo: normalizedReceiptNo ? normalizeDocumentNumber(normalizedReceiptNo, 'Rcpt') : '',
      taxInvoiceNo: normalizedInvoiceNo ? normalizeDocumentNumber(normalizedInvoiceNo, 'Inv') : undefined,
      documentType: resolvedDocumentType,
      customerName: tx?.customerName ?? tx?.customer_name ?? 'Walk-in Customer',
      customerPin: tx?.customerPin ?? tx?.customer_pin ?? undefined,
      vehiclePlate: tx?.vehiclePlate ?? tx?.vehicle_plate ?? undefined,
      paymentMethod: tx?.paymentMethod ?? tx?.payment_method ?? 'Cash',
      source: tx?.source ?? 'MANUAL',
      status: tx?.status ?? 'Completed',
      timestamp: tx?.timestamp ?? (tx?.date ? `${tx.date}T${tx.time || '00:00:00'}.000Z` : new Date().toISOString()),
      shiftId: tx?.shiftId ?? tx?.shift_id ?? 'unknown-shift',
      dispensedWithoutShift:Boolean(tx?.dispensedWithoutShift??tx?.dispensed_without_shift),
      meterReconciliationShiftId:tx?.meterReconciliationShiftId??tx?.meter_reconciliation_shift_id??undefined,
      settlementShiftId:tx?.settlementShiftId??tx?.settlement_shift_id??undefined,
      settledAt:tx?.settledAt??tx?.settled_at??undefined,
      staffId: tx?.staffId ?? tx?.staff_id ?? tx?.attendantId ?? tx?.attendant_id ?? 'unknown-staff',
      staffName: tx?.staffName ?? tx?.staff_name ?? tx?.attendantName ?? tx?.attendant_name ?? 'Cashier',
      pumpId: tx?.pumpId ?? tx?.pump_id ?? undefined,
      nozzleId: tx?.nozzleId ?? tx?.nozzle_id ?? undefined,
      productId: tx?.productId ?? tx?.product_id ?? undefined,
      quantity: Number(tx?.quantity ?? 0),
      unitPrice: Number(tx?.unitPrice ?? tx?.unit_price ?? 0),
      type: resolvedSaleType,
      items: storedItems,
      subtotal: Number(tx?.subtotal ?? 0),
      taxAmount: Number(tx?.taxAmount ?? tx?.tax ?? 0),
      totalAmount: Number(tx?.totalAmount ?? tx?.total_amount ?? 0),
    } as Transaction;
  };

  const normalizeStoredReconciliation = (record: any): ThreeWayReconciliation => {
    let details: any = {};
    try {
      details = record?.varianceNotes ? JSON.parse(record.varianceNotes) : {};
    } catch {
      details = {};
    }

    return {
      id: String(record?.id || ''),
      shiftId: String(record?.shiftId ?? record?.shift_id ?? ''),
      staffId: String(record?.staffId ?? record?.staff_id ?? ''),
      staffName: String(record?.staffName ?? record?.staff_name ?? ''),
      timestamp: String(details.timestamp ?? record?.date ?? record?.createdAt ?? new Date().toISOString()),
      expectedCash: Number(record?.cashExpected ?? record?.cash_expected ?? 0),
      cashCount: details.cashCount ?? {},
      totalActualCash: Number(record?.cashActual ?? record?.cash_actual ?? 0),
      cashVariance: Number(record?.cashVariance ?? record?.cash_variance ?? 0),
      pumpReadings: details.pumpReadings ?? [],
      totalPumpVarianceLiters: record?.pumpVariance ?? record?.pump_variance ?? null,
      tankDips: details.tankDips ?? [],
      totalTankVarianceLiters: Number(record?.tankVariance ?? record?.tank_variance ?? 0),
      status: record?.status ?? 'Pending Approval',
      managerId: record?.approvedBy ?? record?.approved_by ?? undefined,
      managerNotes: details.managerNotes ?? undefined,
    } as ThreeWayReconciliation;
  };

  const normalizeStoredDelivery = (delivery: any): FuelDelivery => {
    const tankId = String(delivery?.tankId ?? delivery?.tank_id ?? '');
    const tank = tanks.find((t) => t.id === tankId);

    return {
      ...delivery,
      id: String(delivery?.id || ''),
      timestamp: String(delivery?.timestamp ?? `${delivery?.deliveryDate ?? new Date().toISOString().slice(0, 10)}T${delivery?.deliveryTime ?? '00:00:00'}`),
      tankId,
      tankName: String(delivery?.tankName ?? delivery?.tank_name ?? tank?.tankName ?? ''),
      supplierName: String(delivery?.supplierName ?? delivery?.supplier_name ?? ''),
      deliveryNoteNo: String(delivery?.deliveryNoteNo ?? delivery?.invoiceNumber ?? delivery?.invoice_number ?? ''),
      litersReceived: Number(delivery?.litersReceived ?? delivery?.quantity ?? 0),
      costPerLiter: Number(delivery?.costPerLiter ?? delivery?.unitPrice ?? delivery?.unit_price ?? 0),
      totalCost: Number(delivery?.totalCost ?? delivery?.total_cost ?? 0),
      openingLevel: Number(delivery?.openingLevel ?? delivery?.opening_level ?? 0),
      closingLevel: Number(delivery?.closingLevel ?? delivery?.closing_level ?? 0),
      driverName: String(delivery?.driverName ?? delivery?.driver_name ?? 'Driver'),
      truckPlate: String(delivery?.truckPlate ?? delivery?.vehicleReg ?? delivery?.vehicle_reg ?? ''),
      receivedBy: String(delivery?.receivedByName ?? delivery?.received_by_name ?? 'Station Staff'),
    };
  };

  const normalizeStoredCashFlow = (record: any): CashFlowRecord => ({
    ...record,
    id: String(record?.id || ''),
    timestamp: String(record?.timestamp ?? `${record?.date ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
    type: record?.type === 'Expense' ? 'Outflow' : (record?.type === 'Outflow' ? 'Outflow' : 'Inflow'),
    category: record?.category ?? 'Other',
    amount: Number(record?.amount ?? 0),
    paymentMethod: record?.paymentMethod ?? record?.accountingMethod ?? record?.accounting_method ?? 'Cash',
    referenceNo: record?.referenceNo ?? record?.reference_no ?? record?.notes ?? undefined,
    description: record?.description ?? '',
    recordedBy: record?.recordedByName ?? record?.recorded_by_name ?? record?.recordedBy ?? 'Station Staff',
  } as CashFlowRecord);

  const normalizeStoredCreditNote = (cn: any) => {
    const rawStoredItems = cn.itemsJson ?? cn.items_json ?? cn.items;
    let parsedItems: any[] = [];
    try {
      parsedItems = Array.isArray(rawStoredItems)
        ? rawStoredItems
        : typeof rawStoredItems === 'string' && rawStoredItems.trim()
          ? JSON.parse(rawStoredItems)
          : Array.isArray(cn.items)
            ? cn.items
            : [];
    } catch (error) {
      parsedItems = Array.isArray(cn.items) ? cn.items : [];
    }

    const inferredOriginalDocumentType = cn.originalDocumentType ||
      (cn.originalInvoiceNo ? 'invoice' : cn.originalReceiptNo ? 'receipt' : undefined);

    const inferredOriginalDocumentNo = String(
      cn.originalDocumentNo ||
      (inferredOriginalDocumentType === 'invoice'
        ? cn.originalInvoiceNo
        : inferredOriginalDocumentType === 'receipt'
          ? cn.originalReceiptNo
          : '') || ''
    ).trim();

    return {
      ...cn,
      items: Array.isArray(parsedItems) ? parsedItems.map((item: any) => ({
        ...item,
        qty: Number(item.qty ?? 1),
        unitPrice: Number(item.unitPrice ?? item.unit_price ?? 0),
        totalPrice: Number(item.totalPrice ?? item.total_price ?? ((Number(item.qty ?? 1) * Number(item.unitPrice ?? item.unit_price ?? 0)))),
        taxAmount: Number(item.taxAmount ?? item.tax_amount ?? 0),
        taxCode: item.taxCode || item.tax_type || 'A',
      })) : [],
      subtotal: Number(cn.subtotal ?? 0),
      taxAmount: Number(cn.taxAmount ?? cn.tax_amount ?? 0),
      totalAmount: Number(cn.totalAmount ?? cn.total_amount ?? (cn.subtotal ?? 0) + (cn.taxAmount ?? cn.tax_amount ?? 0)),
      creditNoteNo: normalizeDocumentNumber(cn.creditNoteNo, 'Cn'),
      originalDocumentType: inferredOriginalDocumentType,
      originalDocumentNo: inferredOriginalDocumentNo || undefined,
      originalInvoiceNo: String(cn.originalInvoiceNo || (inferredOriginalDocumentType === 'invoice' ? inferredOriginalDocumentNo : '') || '').trim(),
      originalReceiptNo: String(cn.originalReceiptNo || (inferredOriginalDocumentType === 'receipt' ? inferredOriginalDocumentNo : '') || '').trim(),
    } as CreditNote;
  };

  const repairLegacyCreditNoteReferences = () => {
    const repaired = creditNotes.map((cn) => {
      const resolvedOriginalDocumentType = cn.originalDocumentType ||
        (cn.originalInvoiceNo ? 'invoice' : cn.originalReceiptNo ? 'receipt' : undefined);

      const resolvedOriginalDocumentNo = String(
        cn.originalDocumentNo ||
        (resolvedOriginalDocumentType === 'invoice'
          ? cn.originalInvoiceNo
          : resolvedOriginalDocumentType === 'receipt'
            ? cn.originalReceiptNo
            : '') || ''
      ).trim();

      if (!resolvedOriginalDocumentNo && cn.originalTransactionId) {
        const originalTx = transactions.find((tx) => tx.id === cn.originalTransactionId);
        if (originalTx) {
          const recoveredNo = resolvedOriginalDocumentType === 'invoice'
            ? originalTx.taxInvoiceNo
            : resolvedOriginalDocumentType === 'receipt'
              ? originalTx.receiptNo
              : originalTx.taxInvoiceNo || originalTx.receiptNo;

          if (recoveredNo) {
            return {
              ...cn,
              originalDocumentType: resolvedOriginalDocumentType,
              originalDocumentNo: recoveredNo,
              originalInvoiceNo: resolvedOriginalDocumentType === 'invoice' ? recoveredNo : '',
              originalReceiptNo: resolvedOriginalDocumentType === 'receipt' ? recoveredNo : '',
            };
          }
        }
      }

      if (!resolvedOriginalDocumentNo) {
        return cn;
      }

      return {
        ...cn,
        originalDocumentType: resolvedOriginalDocumentType,
        originalDocumentNo: resolvedOriginalDocumentNo,
        originalInvoiceNo: resolvedOriginalDocumentType === 'invoice' ? resolvedOriginalDocumentNo : (cn.originalInvoiceNo || ''),
        originalReceiptNo: resolvedOriginalDocumentType === 'receipt' ? resolvedOriginalDocumentNo : (cn.originalReceiptNo || ''),
      };
    });

    creditNotes = repaired;

    repaired.forEach((cn) => {
      if (!cn.originalDocumentNo && !cn.originalInvoiceNo && !cn.originalReceiptNo && !cn.originalTransactionId) return;
      const hasCanonical = !!cn.originalDocumentNo;
      const needsWriteBack = !hasCanonical || !cn.originalDocumentType;

      if (needsWriteBack) {
        try {
          db.creditNoteQueries.update(cn.id, {
            itemsJson: JSON.stringify(cn.items || []),
            originalDocumentType: cn.originalDocumentType || undefined,
            originalDocumentNo: cn.originalDocumentNo || undefined,
            originalInvoiceNo: cn.originalInvoiceNo || undefined,
            originalReceiptNo: cn.originalReceiptNo || undefined,
            originalTransactionId: cn.originalTransactionId || undefined,
            subtotal: Number(cn.subtotal ?? 0),
            taxAmount: Number(cn.taxAmount ?? 0),
            totalAmount: Number(cn.totalAmount ?? (cn.subtotal ?? 0) + (cn.taxAmount ?? 0)),
          } as any);
        } catch (error) {
          console.warn('Failed to repair legacy credit note reference:', error);
        }
      }
    });
  };

  let transactions: Transaction[] = ((allData.transactions as Transaction[]) ?? []).map(normalizeStoredTransaction);
  const hydrateShiftSummaries = () => {
    shifts = rebuildShiftSummaries(shifts, transactions);
    shifts = shifts.map((shift) => {
      const reconciliation = reconciliations?.find((record) => record.shiftId === shift.id);
      const actualCashCount = Number(reconciliation?.totalActualCash ?? shift.actualCashCount ?? (shift as any).closingCash ?? 0);
      const cashVariance = Number(reconciliation?.cashVariance ?? shift.cashVariance ?? (actualCashCount - Number(shift.totalExpectedCash || 0)));
      return { ...shift, actualCashCount, cashVariance };
    });
    const activeShiftIds = new Set(shifts.filter((shift) => shift.status === 'Active').map((shift) => shift.id));
    users = users.map((user) => ({
      ...user,
      currentShiftId: activeShiftIds.has(user.currentShiftId ?? '') ? user.currentShiftId : null,
    }));
    return shifts;
  };
  let reconciliations: ThreeWayReconciliation[] = ((allData.reconciliations as any[]) ?? []).map(normalizeStoredReconciliation);
  let deliveries: FuelDelivery[] = ((allData.deliveries as any[]) ?? []).map(normalizeStoredDelivery);

  const readPersistedManagerApprovals = (): ManagerApproval[] => {
    try {
      const rows = getSqlite().prepare('SELECT * FROM manager_approvals ORDER BY created_at DESC, id DESC').all() as any[];
      return rows.map((row: any) => ({
        id: String(row.id),
        timestamp: String(row.timestamp),
        shiftId: row.shift_id ?? undefined,
        readingVarianceId: row.reading_variance_id ?? undefined,
        reviewScope: row.review_scope === 'SHIFT' || row.review_scope === 'READING' ? row.review_scope : undefined,
        type: row.type,
        requestedBy: row.requested_by,
        reason: row.reason,
        amountOrQty: row.amount_or_qty,
        status: row.status,
        managerId: row.manager_id ?? undefined,
        managerNotes: row.manager_notes ?? undefined,
      })) as ManagerApproval[];
    } catch {
      return [];
    }
  };

  // Manager Approvals always come from the dedicated persisted table. The generic
  // approvals table is used by unrelated workflows and must not feed this tab.
  let approvals: ManagerApproval[] = readPersistedManagerApprovals();

  let auditLogs: AuditLog[] = (allData.auditLogs as AuditLog[]) ?? [];
  const normalizeStationSettings = (value: Partial<StationSettings> | null | undefined): StationSettings => ({
    stationName: String(value?.stationName ?? 'DEITAX FMS.A Station'),
    tagline: String(value?.tagline ?? ''),
    taxPin: String(value?.taxPin ?? ''),
    address: String(value?.address ?? ''),
    phone: String(value?.phone ?? ''),
    email: String(value?.email ?? ''),
    invoiceTerms: String(value?.invoiceTerms ?? ''),
    paybillNumber: String(value?.paybillNumber ?? ''),
    paybillAccountNumber: String(value?.paybillAccountNumber ?? ''),
    tillNumber: String(value?.tillNumber ?? ''),
    showPaybillOnInvoice: value?.showPaybillOnInvoice ?? true,
    showTillOnInvoice: value?.showTillOnInvoice ?? false,
  });

  let stationSettings: StationSettings = normalizeStationSettings(allData.settings as Partial<StationSettings> | null | undefined);
  let creditNotes: CreditNote[] = ((allData.creditNotes as CreditNote[]) ?? []).map(normalizeStoredCreditNote);
  repairLegacyCreditNoteReferences();
  let customers: CustomerAccount[] = ((allData.customers as CustomerAccount[]) ?? []).map(normalizeCustomerRecord);
  let cashFlow: CashFlowRecord[] = ((allData.cashFlow as any[]) ?? []).map(normalizeStoredCashFlow);
  let suppliers: SupplierAccount[] = ((allData.suppliers as SupplierAccount[]) ?? []).map(normalizeSupplierRecord);
  let supplierPayments: SupplierPayment[] = (allData.supplierPayments as SupplierPayment[]) ?? [];
  let stockAdjustments: StockAdjustment[] = normalizeStockAdjustmentsFromDatabase(allData.stockAdjustments as any[]);

  const restoreActiveShiftState = () => {
    const activeShifts = shifts.filter((shift) => shift.status === 'Active');

    for (const user of users) {
      const activeShift = activeShifts.find((shift) => shift.staffId === user.id);
      user.currentShiftId = activeShift ? activeShift.id : null;

      try {
        db.userQueries.update(user.id, { currentShiftId: user.currentShiftId } as any);
      } catch (error) {
        console.warn(`Could not restore current shift for ${user.name}:`, error);
      }
    }
  };

  hydrateShiftSummaries();
  restoreActiveShiftState();

  const addAuditLog = db.addAuditLog;

  const getNextDocumentSequence = (kind: 'invoice' | 'receipt' | 'credit-note') => nextDocumentSequence(getSqlite(),kind);

  const generateInvoiceNumber = () => {
    const seq = getNextDocumentSequence('invoice');
    const year = new Date().getFullYear();
    return `Inv-${year}-${String(seq).padStart(4, '0')}`;
  };

  const generateReceiptNumber = () => {
    const seq = getNextDocumentSequence('receipt');
    const year = new Date().getFullYear();
    return `Rcpt-${year}-${String(seq).padStart(4, '0')}`;
  };

  const generateCreditNoteNumber = () => {
    const seq = getNextDocumentSequence('credit-note');
    const year = new Date().getFullYear();
    return `Cn-${year}-${String(seq).padStart(4, '0')}`;
  };

  const getSupplierName = (supplier: any) => String(supplier?.name ?? supplier?.supplierName ?? '').trim();
  const normalizeSupplierName = (name: string) => String(name || '').trim().toLowerCase();
  const normalizeTaxId = (value?: string | null) => String(value || '').trim().toUpperCase();
  const isUniqueConstraintError = (error: unknown) => /UNIQUE constraint failed|idx_(customers|suppliers)_(name|tax_id)_unique/i.test(error instanceof Error?error.message:String(error));
  const findSupplierByName = (name: string) => {
    const target = normalizeSupplierName(name);
    return suppliers.find((supplier) => normalizeSupplierName(getSupplierName(supplier)) === target);
  };
  const resolveRegisteredSupplier = (supplierIdOrName?: string) => {
    const rawValue = String(supplierIdOrName || '').trim();
    if (!rawValue) return null;

    const byId = suppliers.find((supplier) => supplier.id === rawValue);
    if (byId) return byId;

    return findSupplierByName(rawValue);
  };
  const getSupplierOutstandingBalance = (supplierId: string) => {
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) return 0;

    const supplierName = getSupplierName(supplier);
    const deliveriesTotal = deliveries
      .filter((delivery) => normalizeSupplierName(delivery.supplierName) === normalizeSupplierName(supplierName))
      .reduce((sum, delivery) => sum + Number(delivery.totalCost || 0), 0);

    const paymentsTotal = supplierPayments
      .filter((payment) => payment.supplierId === supplierId)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    return Math.max(0, deliveriesTotal - paymentsTotal);
  };

  const refreshSupplierBalancesFromHistory = () => {
    suppliers = suppliers.map((supplier) => {
      const derivedBalance = getSupplierOutstandingBalance(supplier.id);
      const updatedSupplier = { ...supplier, currentBalance: derivedBalance };

      try {
        db.supplierQueries.update(supplier.id, { accountBalance: derivedBalance } as any);
      } catch (error) {
        console.error('Error syncing supplier balance to database:', error);
      }

      return updatedSupplier;
    });
  };

  refreshSupplierBalancesFromHistory();

  type AuthenticatedSession = { userId: string; expiresAt: number };
  const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
  const getSession = (token?: string): AuthenticatedSession | null => {
    if (!token) return null;
    const tokenHash = sessionHash(token);
    const row = getSqlite().prepare('SELECT user_id,expires_at FROM auth_sessions WHERE token_hash=?').get(tokenHash) as {user_id:string;expires_at:string}|undefined;
    if (!row) return null;
    const expiresAt = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      getSqlite().prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash);
      return null;
    }
    return { userId: row.user_id, expiresAt };
  };
  const deleteSession = (token?: string) => { if (token) getSqlite().prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(sessionHash(token)); };
  const deleteUserSessions = (userId: string) => { getSqlite().prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId); };
  getSqlite().prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  const parseCookies = (cookieHeader?: string) => Object.fromEntries(
    String(cookieHeader || '').split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))];
    })
  );
  // These paths are no longer needed for the global middleware, but we keep them for reference.
  const operationalMutationPaths = new Set([
    '/sales',
    '/shifts/clock-in',
    '/reconciliations',
    '/auth/change-pin',
  ]);

  // ======================================================================
  // MIDDLEWARE – Authentication only; authorisation is per endpoint.
  // ======================================================================
  app.use('/api', (req: any, res, next) => {
    if (req.path === '/auth/verify-pin') return next();
    if (req.path === '/auth/bootstrap-status') return next();
    if (req.path === '/auth/logout') return next();
    if (req.path === '/status') return next();
    if (req.path === '/users' && req.method === 'POST' && Number((getSqlite().prepare('SELECT COUNT(*) count FROM users').get() as any).count) === 0) return next();

    const sessionId = parseCookies(req.headers.cookie).fms_session;
    const session = getSession(sessionId);
    const authenticatedUser = session && session.expiresAt > Date.now()
      ? getUserById(session.userId)
      : null;

    if (!authenticatedUser?.active) {
      return res.status(401).json({
        success: false,
        message: 'Authentication is required for this action.',
      });
    }

    req.authUser = authenticatedUser;

    if (authenticatedUser.mustChangePassword && !['/auth/change-pin','/auth/logout','/auth/me'].includes(req.path)) {
      return res.status(403).json({ success:false, code:'PASSWORD_CHANGE_REQUIRED', message:'You must set a new personal PIN before accessing DEITAX FMS.A.' });
    }

    if (req.body && typeof req.body === 'object') {
      req.body.actorUserId = authenticatedUser.id;
      req.body.actorRole = authenticatedUser.role;
      req.body.userRole = authenticatedUser.role;
      req.body.userName = authenticatedUser.name;
    }

    // ✅ We do NOT check authorisation here – each endpoint will enforce its own permission.
    next();
  });

  app.use('/api/automation/controllers', createControllerRouter({
    sqlite: getSqlite(),
    requirePermission,
    addAuditLog,
    manager: adapterManager,
  }));
  app.use('/api/automation/device-mappings', createMappingRouter({
    sqlite: getSqlite(),
    requirePermission,
    addAuditLog,
    manager: adapterManager,
  }));
  app.use('/api/automation/runtime', createRuntimeRouter({ manager: adapterManager, requirePermission, addAuditLog }));
  app.use('/api/automation/live-forecourt', createLiveForecourtRouter({ projection: adapterManager.liveForecourt, manager: adapterManager, requirePermission }));
  app.use('/api/automation/meters', createMeterRouter({ sqlite: getSqlite(), requirePermission }));
  app.use('/api/automation/atg', createAtgRouter({ sqlite: getSqlite(), requirePermission }));
  app.use('/api/automation/reconciliation', createAutomationReconciliationRouter({ sqlite: getSqlite(), requirePermission, addAuditLog }));
  app.use('/api/automation/alerts', createAlertRouter({ sqlite: getSqlite(), requirePermission, addAuditLog }));
  app.use('/api/automation/recovery', createRecoveryRouter({ coordinator: recoveryCoordinator }));
  app.use('/api/automation/pts2-prices', createPts2PriceRouter({ sqlite: getSqlite(), requirePermission, addAuditLog }));

  // --- API ROUTES ---

  app.get('/api/status', (req, res) => {
    const dashboardSummary = buildDashboardSalesSummary(transactions, shifts, new Date(), creditNotes);
    res.json({
      status: 'online',
      system: 'DEITAX FMS.A (Fuel Management System)',
      activeShiftsCount: dashboardSummary.activeStaff.count,
      pendingApprovalsCount: approvals.filter((a) => a.status === 'Pending').length,
      totalSalesToday: dashboardSummary.today.totalSales,
    });
  });

  app.get('/api/auth/bootstrap-status', (_req, res) => {
    res.json({ hasUsers: Number((getSqlite().prepare('SELECT COUNT(*) AS count FROM users').get() as any).count || 0) > 0 });
  });

  app.get('/api/dashboard-summary', (req, res) => {
    transactions = (db.transactionQueries.all() as any[]).map(normalizeStoredTransaction);
    res.json(buildDashboardSalesSummary(transactions, shifts, new Date(), creditNotes));
  });
  app.get('/api/auth/me', (req: any, res) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies?.fms_session;

      if (!sessionId) {
        return res.status(401).json({
          authenticated: false,
        });
      }

      const session = getSession(sessionId);

      if (!session) {
        return res.status(401).json({
          authenticated: false,
        });
      }

      const user = getUserById(session.userId);

      if (!user || !user.active) {
        return res.status(401).json({
          authenticated: false,
        });
      }

      return res.status(200).json({
        authenticated: true,
        // Always hydrate permissions from the authoritative database source.
        user: toAuthenticatedUser(user),
      });
    } catch (error) {
      console.error('Session restore error:', error);

      return res.status(500).json({
        authenticated: false,
      });
    }
  });

  app.post('/api/auth/verify-pin', (req, res) => {
    const { userId, identifier, pin, requiredRoles } = req.body || {};
    const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
    const matchedUser = userId
      ? getUserById(String(userId))
      : normalizedIdentifier
        ? getSqlite().prepare(`SELECT * FROM users
          WHERE lower(trim(email)) = ? OR lower(trim(name)) = ? OR lower(trim(COALESCE(username, ''))) = ?
          LIMIT 1`).get(normalizedIdentifier, normalizedIdentifier, normalizedIdentifier) as User | undefined
        : undefined;
    const user = matchedUser ? getUserById(String(matchedUser.id)) : undefined;
    const verification = user ? verifyStoredPin(user.pin, pin) : { valid: false, legacy: false };
    if (!user || !user.active || !verification.valid) {
      return res.status(401).json({ success: false, message: 'Invalid username or PIN.' });
    }
    if (verification.legacy) {
      const upgradedPin = hashPin(String(pin));
      db.userQueries.update(user.id, { pin: upgradedPin } as any);
      user.pin = upgradedPin;
      users = users.map((item) => item.id === user.id ? { ...item, pin: upgradedPin } : item);
    }
    if (requiredRoles && Array.isArray(requiredRoles) && !requiredRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: `Action requires role: ${requiredRoles.join(' or ')}. Logged in as ${user.role}.`,
      });
    }

    const sessionId = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    getSqlite().prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sessionHash(sessionId),user.id,expiresAt);
    user.lastLogin = new Date().toISOString();
    db.userQueries.update(user.id, { lastLogin: user.lastLogin } as any);
    res.setHeader('Set-Cookie', `fms_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    addAuditLog(user.id, user.name, user.role, 'LOGIN_SUCCEEDED', 'Auth', 'Authenticated session created.');
    return res.json({ success: true, user: toAuthenticatedUser(user) });
  });

  app.post('/api/auth/logout', (req: any, res) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies ? cookies.fms_session : undefined;

      deleteSession(sessionId);

      res.setHeader('Set-Cookie', [
        'fms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ]);

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Logout handler crash caught:', error);

      res.setHeader('Set-Cookie', 'fms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return res.status(200).json({ success: true });
    }
  });

  app.post('/api/auth/change-pin', (req: any, res) => {
    const user = req.authUser as User | undefined;
    const { currentPin, newPin } = req.body || {};
    if (!user || !verifyStoredPin(user.pin, currentPin).valid) return res.status(401).json({ success: false, message: 'Current PIN is invalid.' });
    if (!isValidPin(newPin)) return res.status(400).json({ success: false, message: 'PIN must be 4-6 digits.' });
    if (String(currentPin) === String(newPin)) return res.status(400).json({ success: false, message: 'New PIN must differ from the current PIN.' });
    const hashedPin = hashPin(String(newPin));
    db.userQueries.update(user.id, { pin: hashedPin, mustChangePassword: false } as any);
    users = users.map((item) => item.id === user.id ? { ...item, pin: hashedPin, mustChangePassword: false } : item);
    deleteUserSessions(user.id);
    addAuditLog(user.id, user.name, user.role, 'USER_PASSWORD_CHANGED', 'Auth', 'User changed their own password.');
    res.setHeader('Set-Cookie', 'fms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ success: true });
  });

  // Users
  const isSuperAdmin = (role?: string) => role === 'Super Admin';
  const isAdmin = (role?: string) => ['Super Admin', 'Admin'].includes(role || '');

  app.get('/api/roles', (req:any,res) => {
    if (requirePermission(req,res,'MANAGE_USERS','view custom roles')) return;
    const rows=getSqlite().prepare(`SELECT r.*,COUNT(DISTINCT u.id) user_count FROM custom_roles r LEFT JOIN users u ON lower(u.role)=lower(r.name) GROUP BY r.id ORDER BY r.system_role DESC,r.name`).all() as any[];
    const permissions=getSqlite().prepare('SELECT permission FROM custom_role_permissions WHERE role_id=? ORDER BY permission');
    res.json(rows.map(row=>({...row,permissions:(permissions.all(row.id) as any[]).map(p=>p.permission)})));
  });
  app.post('/api/roles', (req:any,res) => {
    if (requirePermission(req,res,'MANAGE_USERS','create custom role')) return;
    const name=String(req.body.name||'').trim(),description=String(req.body.description||'').trim();const permissions=[...new Set((Array.isArray(req.body.permissions)?req.body.permissions:[]).map(String))];
    if(name.length<2||name.length>80)return res.status(400).json({message:'Role name must be 2-80 characters.'});if(['Super Admin','Admin'].some(r=>r.toLowerCase()===name.toLowerCase()))return res.status(403).json({message:'Protected system role names cannot be created.'});if(permissions.some(p=>!PERMISSIONS.includes(p as any)))return res.status(400).json({message:'Unknown permission requested.'});if(permissions.some(p=>restrictedPermissions.has(p as Permission))&&!isSuperAdminRole(req.authUser.role))return res.status(403).json({message:'Only Super Admin can grant restricted permissions.'});
    const id=randomUUID(),now=new Date().toISOString();try{getSqlite().transaction(()=>{getSqlite().prepare(`INSERT INTO custom_roles(id,name,description,status,system_role,created_by,created_at,updated_at) VALUES(?,?,?,'ACTIVE',0,?,?,?)`).run(id,name,description,req.authUser.id,now,now);const insert=getSqlite().prepare('INSERT INTO custom_role_permissions(role_id,permission,granted_by,granted_at) VALUES(?,?,?,?)');permissions.forEach(p=>insert.run(id,p,req.authUser.id,now));})();}catch(e){return res.status(409).json({message:'A role with this name already exists.'});}
    addAuditLog(req.authUser.id,req.authUser.name,req.authUser.role,'CUSTOM_ROLE_CREATED','Settings',`Created role ${name} with ${permissions.length} permissions.`);res.status(201).json({id,name,description,status:'ACTIVE',system_role:0,permissions,user_count:0});
  });
  app.put('/api/roles/:id', (req:any,res) => {
    if (requirePermission(req,res,'MANAGE_USERS','edit custom role')) return;const role=getSqlite().prepare('SELECT * FROM custom_roles WHERE id=?').get(req.params.id) as any;if(!role)return res.status(404).json({message:'Role not found.'});if(role.system_role)return res.status(403).json({message:'Protected system roles cannot be edited here.'});const name=String(req.body.name||role.name).trim(),description=String(req.body.description??role.description),status=req.body.status==='INACTIVE'?'INACTIVE':'ACTIVE';const permissions=[...new Set((Array.isArray(req.body.permissions)?req.body.permissions:[]).map(String))];if(!name||permissions.some(p=>!PERMISSIONS.includes(p as any)))return res.status(400).json({message:'Invalid role configuration.'});if(permissions.some(p=>restrictedPermissions.has(p as Permission))&&!isSuperAdminRole(req.authUser.role))return res.status(403).json({message:'Only Super Admin can grant restricted permissions.'});const now=new Date().toISOString();try{getSqlite().transaction(()=>{getSqlite().prepare('UPDATE users SET role=?,updated_at=? WHERE lower(role)=lower(?)').run(name,now,role.name);getSqlite().prepare('UPDATE custom_roles SET name=?,description=?,status=?,updated_at=? WHERE id=?').run(name,description,status,now,role.id);getSqlite().prepare('DELETE FROM custom_role_permissions WHERE role_id=?').run(role.id);const ins=getSqlite().prepare('INSERT INTO custom_role_permissions(role_id,permission,granted_by,granted_at) VALUES(?,?,?,?)');permissions.forEach(p=>ins.run(role.id,p,req.authUser.id,now));})();users=users.map(u=>u.role.toLowerCase()===String(role.name).toLowerCase()?{...u,role:name}:u);}catch(e){return res.status(409).json({message:'Role name already exists.'});}addAuditLog(req.authUser.id,req.authUser.name,req.authUser.role,'CUSTOM_ROLE_UPDATED','Settings',`Updated role ${role.name} to ${name} (${status}).`);res.json({id:role.id,name,description,status,permissions});
  });
  app.delete('/api/roles/:id',(req:any,res)=>{if(requirePermission(req,res,'MANAGE_USERS','delete custom role'))return;const role=getSqlite().prepare('SELECT * FROM custom_roles WHERE id=?').get(req.params.id) as any;if(!role)return res.status(404).json({message:'Role not found.'});if(role.system_role)return res.status(403).json({message:'System roles cannot be deleted.'});const assigned=Number((getSqlite().prepare('SELECT COUNT(*) count FROM users WHERE lower(role)=lower(?)').get(role.name) as any).count);if(assigned)return res.status(409).json({message:`Role is assigned to ${assigned} user(s). Reassign them before deletion.`});getSqlite().transaction(()=>{getSqlite().prepare('DELETE FROM custom_role_permissions WHERE role_id=?').run(role.id);getSqlite().prepare('DELETE FROM custom_roles WHERE id=?').run(role.id);})();addAuditLog(req.authUser.id,req.authUser.name,req.authUser.role,'CUSTOM_ROLE_DELETED','Settings',`Deleted unassigned role ${role.name}.`);res.json({success:true});});

  app.get('/api/users', (req, res) => {
    const actor = (req as any).authUser as User | undefined;
    if (!actor) return res.status(401).json({ message: 'Authentication is required to view users.' });
    if (!hasPermission(actor, 'MANAGE_USERS')) {
      return res.status(403).json({ message: 'Unauthorized access to user list.' });
    }
    res.json(users.map((user) => ({ ...user, pin: undefined, permissions: getPermissions(user.id) })));
  });

  app.get('/api/users/:id/permissions', (req: any, res) => {
    const roleCheck = requirePermission(req, res, 'MANAGE_USERS', 'view user permissions');
    if (roleCheck) return roleCheck;
    if (!users.some((user) => user.id === req.params.id)) return res.status(404).json({ message: 'User not found.' });
    res.json({ userId: req.params.id, permissions: getPermissions(req.params.id) });
  });

  app.put('/api/users/:id/permissions', (req: any, res) => {
    const roleCheck = requirePermission(req, res, 'MANAGE_USERS', 'manage user permissions');
    if (roleCheck) return roleCheck;
    const target = users.find((user) => user.id === req.params.id);
    const requestedPermissions = Array.isArray(req.body?.permissions) ? [...new Set(req.body.permissions.map(String))] : [];
    const validPermissions = new Set<Permission>(PERMISSIONS);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (target.role === 'Super Admin') return res.status(403).json({ message: 'Super Admin permissions are role-derived and cannot be changed.' });
    if (requestedPermissions.some((permission) => !validPermissions.has(permission as Permission))) return res.status(400).json({ message: 'Unknown permission requested.' });
    if (requestedPermissions.some((permission) => restrictedPermissions.has(permission as Permission)) && !isSuperAdminRole(req.authUser.role)) {
      return res.status(403).json({ message: 'Only Super Admin can grant or revoke restricted system permissions.' });
    }
    const now = new Date().toISOString();
    getSqlite().transaction(() => {
      getSqlite().prepare('DELETE FROM user_permissions WHERE user_id = ?').run(target.id);
      const insert = getSqlite().prepare('INSERT INTO user_permissions (user_id, permission, granted_by, granted_at) VALUES (?, ?, ?, ?)');
      requestedPermissions.forEach((permission) => insert.run(target.id, permission, req.authUser.id, now));
    })();
    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'USER_PERMISSIONS_UPDATED', 'Settings', `Updated permissions for ${target.name}: ${requestedPermissions.join(', ') || 'none'}.`);
    res.json({ userId: target.id, permissions: getPermissions(target.id) });
  });

  app.post('/api/users', (req, res) => {
    const actorUserId = String(req.body.actorUserId || '');
    const actorRole = String(req.body.actorRole || '');
    const isFirstUser = Number((getSqlite().prepare('SELECT COUNT(*) count FROM users').get() as any).count) === 0;
    const requestedRole = String(req.body.role || 'Admin');
    const normalizedRole = requestedRole === 'super-admin' ? 'Admin' : requestedRole;
    const submittedName = String(req.body.name || '').trim();
    const submittedEmail = String(req.body.email || '').trim().toLowerCase();
    const submittedUsername = String(req.body.username || '').trim();
    const roleRecord = getSqlite().prepare('SELECT status FROM custom_roles WHERE lower(name)=lower(?)').get(normalizedRole) as any;

    if (!isValidPin(req.body.pin)) return res.status(400).json({ message: 'PIN must be 4-6 digits.' });
    if (!submittedName) return res.status(400).json({ message: 'Full name is required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail)) return res.status(400).json({ message: 'A valid email address is required.' });
    if (!String(req.body.phone || '').trim()) return res.status(400).json({ message: 'Phone number is required.' });

    if (!isFirstUser && !hasPermission((req as any).authUser, 'CREATE_USER')) {
      return res.status(403).json({ message: 'Permission required: CREATE_USER.' });
    }

    if (submittedName && users.some((user) => user.name.trim().toLowerCase() === submittedName.toLowerCase())) {
      return res.status(409).json({ message: 'A user with this name already exists.' });
    }

    if (submittedEmail && users.some((user) => user.email.trim().toLowerCase() === submittedEmail)) {
      return res.status(409).json({ message: 'A user with this email already exists.' });
    }

    if (submittedUsername && users.some((user) => String(user.username || user.email).trim().toLowerCase() === submittedUsername.toLowerCase())) {
      return res.status(409).json({ message: 'A user with this username already exists.' });
    }

    if (isFirstUser) {
      const newUser: User = {
        id: 'usr-' + Date.now(),
        ...req.body,
        name: submittedName,
        username: submittedUsername || submittedEmail.split('@')[0],
        email: submittedEmail,
        phone: String(req.body.phone || '').trim(),
        role: 'Super Admin',
        pin: hashPin(String(req.body.pin || '')),
        active: true,
        mustChangePassword: false,
        status: 'Active',
        createdAt: new Date().toISOString(),
      } as User;

      try {
        db.userQueries.create(newUser as any);
        const addInitialRole=getSqlite().prepare(`INSERT OR IGNORE INTO custom_roles(id,name,description,status,system_role,created_by) VALUES(?,?,'Initial DEITAX FMS.A role','ACTIVE',?,?)`);
        ['Super Admin','Admin','Station Manager','Auditor','Fuel Attendant','Shop Attendant','Cashier','Normal User','Standard User'].forEach(name=>addInitialRole.run(`role-${name.toLowerCase().replace(/\s+/g,'-')}`,name,['Super Admin','Admin'].includes(name)?1:0,newUser.id));
      } catch (error) {
        console.error('Error saving user to database:', error);
        return res.status(409).json({ message: 'The first account could not be created. Check that the name, username, and email are unique.' });
      }

      users.push(newUser);

      addAuditLog('sys', 'System Admin', 'Super Admin', 'USER_CREATED', 'Settings', `Created first user ${newUser.name} as Super Admin.`);
      return res.json(toAuthenticatedUser(newUser));
    }

    if (normalizedRole === 'Super Admin' && (req as any).authUser?.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Only a Super Admin can create a Super Admin user.' });
    }
    if (!roleRecord || roleRecord.status !== 'ACTIVE') return res.status(400).json({ message: 'Select an active configured role.' });

    const newUser: User = {
      id: 'usr-' + Date.now(),
      ...req.body,
      name: submittedName,
      username: submittedUsername || submittedEmail.split('@')[0],
      email: submittedEmail,
      phone: String(req.body.phone || '').trim(),
      role: normalizedRole as User['role'],
      pin: hashPin(String(req.body.pin || '')),
      active: true,
      mustChangePassword: true,
      status: 'Active',
      createdAt: new Date().toISOString(),
    } as User;

    try {
      db.userQueries.create(newUser as any);
    } catch (error) {
      console.error('Error saving user to database:', error);
      return res.status(409).json({ message: 'The user could not be created. Check that the name, username, and email are unique.' });
    }

    users.push(newUser);

    addAuditLog(actorUserId || 'sys', actorRole || 'Admin', actorRole || 'Admin', 'USER_CREATED', 'Settings', `Created user ${newUser.name} (${newUser.role})`);
    res.json(toAuthenticatedUser(newUser));
  });

  app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const actor = (req as any).authUser as User;
    const target = users.find((u) => u.id === id);

    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (!hasPermission(actor, 'MANAGE_USERS')) return res.status(403).json({ message: 'Permission required: MANAGE_USERS.' });
    if (target.role === 'Super Admin' && actor.role !== 'Super Admin') return res.status(403).json({ message: 'Admins cannot modify Super Admin data.' });
    if (String(req.body.role || target.role) === 'Super Admin' && actor.role !== 'Super Admin') return res.status(403).json({ message: 'Only Super Admin can assign Super Admin role.' });
    const requestedUserRole=String(req.body.role||target.role);const configuredRole=getSqlite().prepare('SELECT status FROM custom_roles WHERE lower(name)=lower(?)').get(requestedUserRole) as any;if(req.body.role&&(!configuredRole||configuredRole.status!=='ACTIVE'))return res.status(400).json({message:'Select an active configured role.'});

    const updatedUser = {
      ...target,
      ...req.body,
      pin: target.pin,
      name: String(req.body.name || target.name).trim(),
      email: String(req.body.email || target.email).trim(),
      phone: String(req.body.phone || target.phone).trim(),
      username: req.body.username ? String(req.body.username).trim() : target.username,
      role: String(req.body.role || target.role) as User['role'],
      active: req.body.active !== undefined ? Boolean(req.body.active) : target.active,
      status: req.body.status || target.status || (target.active ? 'Active' : 'Inactive'),
    } as User;

    const normalizedEmail = updatedUser.email.toLowerCase();
    const normalizedUsername = String(updatedUser.username || '').trim().toLowerCase();
    if (users.some((user) => user.id !== id && user.email.trim().toLowerCase() === normalizedEmail)) return res.status(409).json({ message: 'A user with this email already exists.' });
    if (normalizedUsername && users.some((user) => user.id !== id && String(user.username || '').trim().toLowerCase() === normalizedUsername)) return res.status(409).json({ message: 'A user with this username already exists.' });
    const changedFields = ['name', 'username', 'email', 'phone', 'role', 'active']
      .filter((field) => String((target as any)[field] ?? '') !== String((updatedUser as any)[field] ?? ''));

    users = users.map((u) => u.id === id ? updatedUser : u);
    db.userQueries.update(id, updatedUser as any);
    if (!updatedUser.active) deleteUserSessions(id);
    addAuditLog(actor.id, actor.name, actor.role, 'USER_UPDATED', 'Settings', `Updated ${updatedUser.name} (${updatedUser.id}); changed: ${changedFields.join(', ') || 'no persisted fields'}.`);
    res.json(toAuthenticatedUser(updatedUser));
  });

  app.post('/api/users/:id/reset-pin', (req, res) => {
    const { id } = req.params;
    const { newPin, actorUserId, actorRole } = req.body;

    if (!hasPermission((req as any).authUser, 'RESET_USER_PASSWORD')) return res.status(403).json({ message: 'Permission required: RESET_USER_PASSWORD.' });
    const target = users.find((u) => u.id === id);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (target.role === 'Super Admin' && actorRole !== 'Super Admin') return res.status(403).json({ message: 'Admins cannot reset a Super Admin password.' });
    if (!newPin || !/^\d{4,6}$/.test(String(newPin))) return res.status(400).json({ message: 'PIN must be 4-6 digits.' });

    target.pin = hashPin(String(newPin));
    target.mustChangePassword = true;
    db.userQueries.update(target.id, { pin: target.pin, mustChangePassword: true } as any);
    deleteUserSessions(target.id);
    addAuditLog(actorUserId || 'sys', actorRole || 'Admin', actorRole || 'Admin', 'USER_PASSWORD_RESET', 'Auth', `Password reset initiated for ${target.name}.`);
    res.json(toAuthenticatedUser(target));
  });

  app.post('/api/users/:id/status', (req, res) => {
    const { id } = req.params;
    const { status, actorUserId, actorRole } = req.body;
    const target = users.find((u) => u.id === id);

    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (!hasPermission((req as any).authUser, 'MANAGE_USERS')) return res.status(403).json({ message: 'Permission required: MANAGE_USERS.' });
    if (target.role === 'Super Admin' && actorRole !== 'Super Admin') return res.status(403).json({ message: 'Admins cannot change Super Admin status.' });
    if (id === actorUserId) return res.status(403).json({ message: 'You cannot deactivate your own account.' });

    const nextStatus = String(status || 'Active') as User['status'];
    const nextActive = nextStatus === 'Active';
    target.status = nextStatus;
    target.active = nextActive;
    db.userQueries.update(target.id, { active: target.active } as any);
    if (!nextActive) deleteUserSessions(target.id);

    addAuditLog(actorUserId || 'sys', actorRole || 'Admin', actorRole || 'Admin', 'USER_STATUS_CHANGED', 'Settings', `Set ${target.name} to ${nextStatus}.`);
    res.json(toAuthenticatedUser(target));
  });

  app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { actorUserId, actorRole } = req.body || {};
    const target = users.find((u) => u.id === id);

    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (!hasPermission((req as any).authUser, 'MANAGE_USERS')) return res.status(403).json({ message: 'Permission required: MANAGE_USERS.' });
    if (target.role === 'Super Admin') return res.status(403).json({ message: 'Super Admin accounts cannot be deleted.' });
    if (id === actorUserId) return res.status(403).json({ message: 'You cannot delete your own account.' });

    const relatedShift = shifts.some((shift) => shift.staffId === id);
    const relatedTx = transactions.some((tx) => tx.staffId === id);
    const relatedAudit = auditLogs.some((log) => log.userId === id || log.userName === target.name);

    if (relatedShift || relatedTx || relatedAudit) {
      users = users.map((u) => u.id === id ? { ...u, active: false, status: 'Inactive' } : u);
      db.userQueries.update(id, { active: false } as any);
      deleteUserSessions(id);
      addAuditLog(actorUserId || 'sys', actorRole || 'Admin', actorRole || 'Admin', 'USER_DEACTIVATED', 'Settings', `Deactivated ${target.name} instead of deleting due to historical activity.`);
      return res.json({ success: true, deactivated: true });
    }

    users = users.filter((u) => u.id !== id);
    db.userQueries.delete(id);
    addAuditLog(actorUserId || 'sys', actorRole || 'Admin', actorRole || 'Admin', 'USER_DELETED', 'Settings', `Deleted user ${target.name}.`);
    res.json({ success: true, deleted: true });
  });

  // Tanks & Dip Readings
  app.get('/api/tanks', (req, res) => {
    const denied = requirePermission(req, res, 'VIEW_PUMPS', 'view tanks');
    if (denied) return denied;
    const sqlite = getSqlite();
    const latestDip = sqlite.prepare('SELECT volume_liters,variance_liters FROM manual_tank_dips WHERE tank_id=? ORDER BY datetime(occurred_at) DESC,id DESC LIMIT 1');
    const latestStockMovement = sqlite.prepare('SELECT movement_type,quantity,before_balance,after_balance,source,reference,occurred_at FROM tank_stock_ledger WHERE tank_id=? ORDER BY datetime(occurred_at) DESC,datetime(recorded_at) DESC,id DESC LIMIT 1');
    res.json(db.tankQueries.all().map((tank) => {
      const dip = latestDip.get(tank.id) as any;
      const movement = latestStockMovement.get(tank.id) as any;
      return {
        ...tank,
        manualDipVolume: dip?.volume_liters ?? null,
        manualDipVariance: dip?.variance_liters ?? null,
        latestStockMovement: movement ? {
          movementType: String(movement.movement_type),
          quantityLiters: Number(movement.quantity),
          beforeBalance: Number(movement.before_balance),
          afterBalance: Number(movement.after_balance),
          source: String(movement.source),
          reference: movement.reference == null ? null : String(movement.reference),
          occurredAt: String(movement.occurred_at),
        } : null,
      };
    }));
  });

  app.post('/api/tanks', (req, res) => {
    const { tankName, fuelProductId, fuelName, capacityLiters, currentLevelLiters, reorderLevelLiters, taxCode, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_PUMPS', 'Tank registration');
    if (permCheck) return permCheck;

    const normalizedFuelName = String(fuelName || '').trim();
    const selectedTaxCode: TaxCode = normalizeTaxCode(taxCode);
    if (!normalizedFuelName) {
      return res.status(400).json({ message: 'Fuel product name is required when creating a tank.' });
    }

    let prod = products.find((p) => p.id === fuelProductId || p.name.toLowerCase() === normalizedFuelName.toLowerCase() || p.code.toLowerCase() === normalizedFuelName.toLowerCase());

    if (!prod) {
      const partialMatch = products.find((p) => {
        const productName = String(p.name || '').toLowerCase();
        const productCode = String(p.code || '').toLowerCase();
        return productName.includes(normalizedFuelName.toLowerCase()) || normalizedFuelName.toLowerCase().includes(productName) || productCode.includes(normalizedFuelName.toLowerCase()) || normalizedFuelName.toLowerCase().includes(productCode);
      });
      prod = partialMatch || null;
    }

    if (!prod) {
      const safeCodeBase = normalizedFuelName
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase() || `FUEL-${Date.now()}`;

      const lowerFuelName = normalizedFuelName.toLowerCase();
      const isDiesel = /(diesel|ago|gasoil)/.test(lowerFuelName);
      const isPetrol = /(petrol|gasoline|premium|unl|super)/.test(lowerFuelName);
      const defaultCost = isDiesel ? 145 : isPetrol ? 170 : 150;
      const defaultPrice = isDiesel ? defaultCost + 15 : isPetrol ? defaultCost + 18 : defaultCost + 12;
      const productTaxRate = getTaxRateByCode(selectedTaxCode);

      prod = {
        id: 'prod-' + Date.now(),
        code: `${safeCodeBase}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        name: normalizedFuelName,
        pricePerLiter: defaultPrice,
        costPerLiter: defaultCost,
        taxRate: productTaxRate,
        taxCode: selectedTaxCode,
        unit: 'L',
        color: '#10b981',
      };

      products.push(prod);

      try {
        db.productQueries.create({
          ...prod,
          taxCode: String(prod.taxCode ?? selectedTaxCode).toUpperCase(),
        } as any);
      } catch (error) {
        console.error('Error creating product for tank registration:', error);
      }
    }

    const newTank: FuelTank = {
      id: 'tnk-' + Date.now(),
      tankName: tankName || `Tank ${tanks.length + 1}`,
      fuelProductId: prod.id,
      fuelName: prod.name,
      capacityLiters: Number(capacityLiters || 30000),
      currentLevelLiters: Number(currentLevelLiters ?? 0),
      reorderLevelLiters: Number(reorderLevelLiters || 5000),
      lastDipReading: Number(currentLevelLiters ?? 0),
      lastDipTime: new Date().toISOString(),
    };

    tanks.push(newTank);

    try {
      db.tankQueries.create(newTank as any);
    } catch (error) {
      console.error('Error saving tank to database:', error);
    }

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'TANK_REGISTERED', 'Tanks', `Registered new station fuel tank: ${newTank.tankName} (${newTank.fuelName}, ${newTank.capacityLiters} L capacity).`);
    res.json(newTank);
  });

  app.delete('/api/tanks/:id', (req, res) => {
    const { id } = req.params;
    const { userId, userName, userRole } = req.body || {};

    const permCheck = requirePermission(req, res, 'MANAGE_PUMPS', 'Tank deletion');
    if (permCheck) return permCheck;

    const tankIndex = tanks.findIndex((t) => t.id === id);
    if (tankIndex === -1) {
      return res.status(404).json({ message: 'Tank not found.' });
    }

    const tank = tanks[tankIndex];
    const relatedPumps = pumps.filter((pump) => pump.tankId === id);
    const sqlite = getSqlite();
    const dependencies = sqlite.prepare(`SELECT
      (SELECT COUNT(*) FROM pump_nozzles WHERE tank_id=?) nozzles,
      (SELECT COUNT(*) FROM fuel_deliveries WHERE tank_id=?) deliveries,
      (SELECT COUNT(*) FROM automation_device_mappings WHERE tank_id=?) mappings`).get(id,id,id) as {nozzles:number;deliveries:number;mappings:number};
    if (dependencies.nozzles || dependencies.deliveries || dependencies.mappings) return res.status(409).json({ success:false, code:'TANK_HAS_HISTORY', message:'Tank cannot be deleted while nozzles, deliveries, or automation mappings reference it. Historical records were preserved.' });

    try {
      deleteTankAndLinkedRecords(sqlite, id);
    } catch (error) {
      console.error('Error deleting tank and linked pumps from database:', error);
      return res.status(500).json({ success:false, code:'DATABASE_OPERATION_FAILED', message:'Tank could not be deleted safely.' });
    }
    pumps = pumps.filter((pump) => pump.tankId !== id);
    tanks.splice(tankIndex, 1);

    addAuditLog(
      userId || 'sys',
      userName || 'System',
      userRole || 'Admin',
      'TANK_DELETED',
      'Tanks',
      `Deleted tank ${tank.tankName} and ${relatedPumps.length} linked pump(s).`
    );

    res.json({ success: true, deletedTank: tank, deletedPumps: relatedPumps });
  });

  app.get('/api/tanks/evidence', (req:any,res)=>{
    const denied=requirePermission(req,res,'VIEW_PUMPS','Tank evidence');if(denied)return denied;
    const page=Math.max(1,Number(req.query.page)||1),limit=25,offset=(page-1)*limit;
    res.json({tanks:db.tankQueries.all().map(t=>({...t,latestManualDip:getSqlite().prepare('SELECT * FROM manual_tank_dips WHERE tank_id=? ORDER BY occurred_at DESC,id DESC LIMIT 1').get(t.id)||null})),dips:getSqlite().prepare('SELECT d.*,t.tank_name FROM manual_tank_dips d JOIN fuel_tanks t ON t.id=d.tank_id ORDER BY d.recorded_at DESC,d.id DESC LIMIT ? OFFSET ?').all(limit,offset),movements:getSqlite().prepare('SELECT l.*,t.tank_name FROM tank_stock_ledger l JOIN fuel_tanks t ON t.id=l.tank_id ORDER BY l.recorded_at DESC,l.id DESC LIMIT ? OFFSET ?').all(limit,offset),page});
  });
  app.post('/api/tanks/dip', (req:any,res)=>{
    const denied=requirePermission(req,res,'ADJUST_STOCK','Manual tank dip');if(denied)return denied;
    const initialSetup=req.body.initialSetup===true||String(req.body.mode||'').toUpperCase()==='INITIAL';
    if(initialSetup&&!isAdminRole(req.authUser.role))return res.status(403).json({message:'Only an Admin or Super Admin can set the initial tank stock.'});
    if(req.body.dipValue==null&&req.body.dipReadingLiters==null)return res.status(400).json({message:'A physical dip reading is required.'});
    const activeShift=db.shiftQueries.active().find((shift:any)=>shift.staffId===req.authUser.id);
    const station=getSqlite().prepare('SELECT id FROM station_settings LIMIT 1').get() as any;
    try{
      const observation=getSqlite().transaction(()=>{
        const result=recordManualTankDip(getSqlite(),{tankId:String(req.body.tankId||''),dipValue:Number(req.body.dipValue??req.body.dipReadingLiters),dipUnit:String(req.body.dipUnit||'L').toUpperCase(),volumeLiters:Number(req.body.volumeLiters??req.body.dipReadingLiters),occurredAt:req.body.readingAt||new Date().toISOString(),actorId:req.authUser.id,stationId:station?.id,shiftId:activeShift?.id,reason:String(req.body.reason||'Manual dip observation'),reference:req.body.reference,setInitialStock:initialSetup});
        addAuditLog(req.authUser.id,req.authUser.name,req.authUser.role,'DIP_READING_RECORDED','Tanks',JSON.stringify(result));
        if(Math.abs(result.variance)>0.0005&&activeShift)getSqlite().prepare("INSERT INTO reading_variances(id,shift_id,reading_type,tank_id,reported_value,authoritative_value,variance,status,recorded_by,recorded_at) VALUES(?,?,'Tank Dip',?,?,?,?,'Review Required',?,?)").run(result.id,activeShift.id,result.tankId,result.reportedValue,result.authoritativeValue,result.variance,req.authUser.id,result.recordedAt);
        return result;
      })();
      res.json({...db.tankQueries.byId(observation.tankId),observation});
    }catch(error){res.status(400).json({message:error instanceof Error?error.message:'Unable to record dip.'});}
  });

  // Fuel Deliveries
  app.get('/api/deliveries', (req, res) => {
    const denied = requirePermission(req, res, 'VIEW_PUMPS', 'view fuel deliveries');
    if (denied) return denied;
    res.json(deliveries);
  });

  app.post('/api/deliveries', (req, res) => {
    const { tankId, supplierId, supplierName, deliveryNoteNo, litersReceived, costPerLiter, driverName, truckPlate, receivedBy, userId, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'ADJUST_STOCK', 'Fuel delivery logging');
    if (permCheck) return permCheck;

    const tank = tanks.find((t) => t.id === tankId);
    if (!tank) return res.status(404).json({ message: 'Tank not found' });

    const suppliedSupplierId = String(supplierId || '').trim();
    const supplierDisplayName = String(supplierName || '').trim();
    const liters = Number(litersReceived);
    const unitPrice = Number(costPerLiter);

    let supplierMatch: SupplierAccount | undefined;
    if (suppliedSupplierId) {
      supplierMatch = suppliers.find((supplier) => supplier.id === suppliedSupplierId);
    }
    if (!supplierMatch && supplierDisplayName) {
      supplierMatch = findSupplierByName(supplierDisplayName);
    }

    if (!supplierMatch) {
      return res.status(400).json({
        message: 'Supplier must be registered before logging a delivery. Please create the supplier account from Suppliers & OMCs first.',
      });
    }

    if (!deliveryNoteNo || String(deliveryNoteNo).trim() === '') {
      return res.status(400).json({ message: 'Delivery note number is required.' });
    }

    if (!Number.isFinite(liters) || liters <= 0) {
      return res.status(400).json({ message: 'Liters received must be greater than zero.' });
    }

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ message: 'Cost per liter must be greater than zero.' });
    }

    const verifiedSupplierId = supplierMatch.id;
    const verifiedSupplierName = getSupplierName(supplierMatch);

    const dbSupplierExists = !!db.supplierQueries.byId(verifiedSupplierId);
    if (!dbSupplierExists) {
      db.supplierQueries.create({
        id: verifiedSupplierId,
        supplierName: verifiedSupplierName,
        contactPerson: supplierMatch.contactPerson || verifiedSupplierName,
        email: supplierMatch.email ?? null,
        phone: supplierMatch.phone || '0000000000',
        address: supplierMatch.address ?? null,
        paymentTerms: supplierMatch.paymentTerms ?? null,
        accountBalance: Number(supplierMatch.currentBalance ?? 0),
        status: supplierMatch.status || 'Active',
        taxId: supplierMatch.kraPin ?? null,
        bankName: null,
        bankAccount: null,
      } as any);
    }

    const dbTankExists = !!db.tankQueries.byId(tank.id);
    if (!dbTankExists) {
      db.tankQueries.create({
        id: tank.id,
        tankName: tank.tankName,
        fuelProductId: tank.fuelProductId,
        fuelName: tank.fuelName,
        capacityLiters: Number(tank.capacityLiters),
        currentLevelLiters: Number(tank.currentLevelLiters),
        reorderLevelLiters: Number(tank.reorderLevelLiters),
        lastDipReading: Number(tank.lastDipReading ?? tank.currentLevelLiters),
        lastDipTime: tank.lastDipTime || new Date().toISOString(),
      } as any);
    }

    const productMatch = products.find((product) => product.id === tank.fuelProductId);
    const dbProductExists = !!db.productQueries.byId(tank.fuelProductId);
    if (!dbProductExists) {
      const fallbackName = String(tank.fuelName || 'Fuel');
      const lowerFuelName = fallbackName.toLowerCase();
      const isDiesel = /(diesel|ago|gasoil)/.test(lowerFuelName);
      const isPetrol = /(petrol|gasoline|premium|unl|super)/.test(lowerFuelName);
      const defaultCost = isDiesel ? 145 : isPetrol ? 170 : 150;
      const defaultPrice = isDiesel ? defaultCost + 15 : isPetrol ? defaultCost + 18 : defaultCost + 12;
      const fallbackTaxCode: TaxCode = isDiesel ? 'B' : 'B';
      const createdProduct: FuelProduct = {
        id: tank.fuelProductId,
        code: `${(tank.fuelName || 'FUEL').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase() || 'FUEL'}-${Date.now()}`,
        name: tank.fuelName || 'Fuel',
        pricePerLiter: defaultPrice,
        costPerLiter: defaultCost,
        taxRate: getTaxRateByCode(fallbackTaxCode),
        taxCode: fallbackTaxCode,
        unit: 'L',
        color: '#10b981',
      };
      products.push(createdProduct);
      try {
        db.productQueries.create(createdProduct as any);
      } catch (error) {
        console.error('Error creating product for tank fallback:', error);
      }
    }

    if (productMatch) {
      const currentCost = Number(productMatch.costPerLiter || 0);
      const nextCost = Number(unitPrice || currentCost || productMatch.pricePerLiter || 0);
      productMatch.costPerLiter = nextCost;
      productMatch.pricePerLiter = Number(productMatch.pricePerLiter || nextCost || 0);

      try {
        db.productQueries.update(productMatch.id, {
          name: productMatch.name,
          code: productMatch.code,
          pricePerLiter: Number(productMatch.pricePerLiter || nextCost),
          costPerLiter: Number(nextCost),
          taxRate: Number(productMatch.taxRate ?? 0.16),
          unit: productMatch.unit ?? 'L',
          color: productMatch.color ?? '#10b981',
        } as any);
      } catch (error) {
        console.error('Error updating product cost from delivery:', error);
      }
    }

    const validUserId = (req as any).authUser.id;
    const openingLevel = Number(db.tankQueries.byId(tank.id)?.currentLevelLiters);
    const closingLevel = Number((openingLevel + liters).toFixed(3));

    const totalCost = liters * unitPrice;
    const newDelivery: FuelDelivery = {
      id: 'del-' + Date.now(),
      timestamp: new Date().toISOString(),
      tankId: tank.id,
      tankName: tank.tankName,
      supplierName: verifiedSupplierName,
      deliveryNoteNo: String(deliveryNoteNo).trim(),
      litersReceived: liters,
      costPerLiter: unitPrice,
      totalCost,
      openingLevel,
      closingLevel,
      driverName: driverName || 'Driver',
      truckPlate: truckPlate || 'KBB 120X',
      receivedBy: receivedBy || 'Station Staff',
    };

    try {
      getSqlite().transaction(()=>{
      db.deliveryQueries.create({
        id: newDelivery.id,
        supplierId: verifiedSupplierId,
        supplierName: verifiedSupplierName,
        tankId: tank.id,
        fuelProductId: tank.fuelProductId,
        quantity: liters,
        openingLevel,
        closingLevel,
        unitPrice,
        totalCost,
        deliveryDate: new Date().toISOString().slice(0, 10),
        deliveryTime: new Date().toISOString().slice(11, 19),
        invoiceNumber: String(deliveryNoteNo).trim() || null,
        driverName: driverName || 'Driver',
        driverPhone: null,
        vehicleReg: truckPlate || 'KBB 120X',
        receivedBy: validUserId,
        receivedByName: receivedBy || 'Station Staff',
        status: 'Completed',
        notes: `Delivery recorded for ${tank.tankName}`,
      } as any);
        db.tankQueries.update(tank.id,{currentLevelLiters:closingLevel});
        db.supplierQueries.update(supplierMatch.id,{accountBalance:getSupplierOutstandingBalance(supplierMatch.id)+totalCost} as any);
        getSqlite().prepare("INSERT INTO tank_stock_ledger(id,tank_id,product_id,movement_type,quantity,before_balance,after_balance,source,reference,actor_id,delivery_id,occurred_at) VALUES(?,?,?,'FUEL_DELIVERY',?,?,?,'FMS_DELIVERY',?,?,?,?)").run('delivery:'+newDelivery.id,tank.id,tank.fuelProductId,liters,openingLevel,closingLevel,newDelivery.deliveryNoteNo,validUserId,newDelivery.id,newDelivery.timestamp);
        createStockAdjustmentRecord({
      type: 'Fuel',
      itemId: tank.id,
      itemName: tank.tankName,
      itemCode: productMatch?.code || tank.fuelProductId,
      previousQty: openingLevel,
      newQty: closingLevel,
      reason: 'Fuel Delivery',
      userId: validUserId,
      userName: receivedBy || 'Station Staff',
      userRole: userRole || 'Station Manager',
      source: 'Pumps & Tanks',
      referenceNumber: String(deliveryNoteNo).trim(),
      originalDocumentNumber: String(deliveryNoteNo).trim(),
      movementType: 'FUEL DELIVERY',
      notes: `Fuel delivery received for ${tank.tankName}. Supplier: ${verifiedSupplierName}. Quantity added: ${liters} L.`,
    });
      })();
      tank.currentLevelLiters=closingLevel;
      deliveries.unshift(newDelivery);
      supplierMatch.currentBalance=getSupplierOutstandingBalance(supplierMatch.id);

    } catch (error) {
      console.error('Error saving fuel delivery to database:', error);
      return res.status(500).json({ message: 'Delivery could not be saved to the database.' });
    }

    const actor = (req as any).authUser as User;
    addAuditLog(
      actor.id,
      actor.name,
      actor.role,
      'FUEL_DELIVERY_RECEIVED',
      'Tanks',
      `Received fuel delivery ${String(deliveryNoteNo).trim()} from ${verifiedSupplierName}: ${liters} L to ${tank.tankName}. Inventory and supplier balance updated; no cash-flow entry is created until supplier payout.`
    );

    res.json({ delivery: newDelivery, updatedTank: tank });
  });

  const pts2NozzleIds=()=>new Set<string>((getSqlite().prepare(`SELECT m.nozzle_id FROM automation_device_mappings m JOIN automation_controllers c ON c.id=m.controller_id WHERE m.equipment_type='NOZZLE' AND m.status='MAPPED' AND c.adapter_type='PTS2'`).all() as any[]).map(row=>row.nozzle_id));
  const refreshTransactionMeters=async(nozzleIds:string[])=>{
    try{await adapterManager.captureNozzleMeters(nozzleIds);}
    catch(error){console.warn('Sale saved; controller meter refresh failed. The scheduled poll will retry.',error instanceof Error?error.message:String(error));}
    pumps=(db.pumpQueries.all() as PumpNozzle[])??[];
  };
  // Pumps & Meter Readings
  app.get('/api/pumps', (req: any, res) => {
    const permCheck = requirePermission(req, res, 'VIEW_PUMPS', 'view pump nozzles');
    if (permCheck) return permCheck;
    // Return physical readings projected asynchronously from controller snapshots.
    pumps = (db.pumpQueries.all() as PumpNozzle[]) ?? [];
    const hardware=pts2NozzleIds(),previous=previousNozzleClosings(getSqlite());
    res.json(pumps.map(pump=>{
      const common={...pump,meterSource:hardware.has(pump.id)?'PTS2':'MANUAL',previousClosingMeter:previous.get(pump.id)?.meter,previousShiftEnd:previous.get(pump.id)?.endTime};
      if(!hardware.has(pump.id))return common;
      const state=getSqlite().prepare(`SELECT s.*,c.status controller_status FROM automation_device_mappings m JOIN automation_controllers c ON c.id=m.controller_id LEFT JOIN automation_meter_current_state s ON s.controller_id=m.controller_id AND s.external_parent_id=m.external_parent_id AND s.external_device_id=m.external_equipment_id AND s.nozzle_id=m.nozzle_id WHERE m.nozzle_id=? AND m.status='MAPPED' AND c.adapter_type='PTS2'`).get(pump.id) as any;
      const reset=state?.controller_id?getSqlite().prepare("SELECT MAX(source_occurred_at) at FROM automation_meter_readings WHERE controller_id=? AND nozzle_id=? AND anomaly_classification IN('METER_RESET','METER_DECREASE')").get(state.controller_id,pump.id) as any:null;
      return {...common,currentMeterReading:state?.current_value??null,meterReadingAt:state?.last_source_occurred_at,meterLastResetAt:reset?.at,meterAnomaly:state?.last_anomaly,meterFreshness:state?.current_value==null?'UNAVAILABLE':state.controller_status!=='ONLINE'?'OFFLINE':Date.now()-Date.parse(state.last_received_at)>30000?'STALE':'FRESH'};
    }));
  });

  app.get('/api/pump-units', (req: any, res) => {
    const permCheck = requirePermission(req, res, 'VIEW_PUMPS', 'view physical pumps');
    if (permCheck) return permCheck;
    const pumpUnits = getSqlite().prepare(`
      SELECT id, pump_number AS pumpNumber, pump_name AS pumpName, status
      FROM pumps
      ORDER BY pump_number
    `).all();
    res.json(pumpUnits);
  });

  app.get('/api/nozzle-readings', (req, res) => {
    res.json(db.nozzleReadingQueries.all());
  });

  app.post('/api/pumps', (req, res) => {
    const { pumpName, pumpNumber, tankId, openingMeterReading, nozzleConfigs, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_PUMPS', 'Pump registration');
    if (permCheck) return permCheck;

    const num = Number(pumpNumber || pumps.length + 1);
    if (!Number.isInteger(num) || num <= 0) return res.status(400).json({ message: 'Pump number must be a positive whole number.' });
    const requestedNozzles = Array.isArray(nozzleConfigs) && nozzleConfigs.length > 0
      ? nozzleConfigs
      : [{ tankId: tankId || tanks[0]?.id, openingMeterReading, nozzleName: 'Nozzle 1' }];
    const nozzleNumbers = requestedNozzles.map((config: any, index: number) => Number(config.nozzleNumber ?? index + 1));
    const invalidNozzle = nozzleNumbers.find((number) => !Number.isInteger(number) || number <= 0);
    if (invalidNozzle !== undefined) return res.status(400).json({ message: 'Every nozzle number must be a positive whole number.' });
    const duplicateNumbers = nozzleNumbers.filter((number, index) => nozzleNumbers.indexOf(number) !== index);
    if (duplicateNumbers.length) return res.status(400).json({ message: `Duplicate nozzle numbers are not allowed for this pump: ${[...new Set(duplicateNumbers)].join(', ')}.` });
    const invalidTankIndex = requestedNozzles.findIndex((config: any) => !tanks.some((tank) => tank.id === config.tankId));
    if (invalidTankIndex >= 0) return res.status(400).json({ message: `Nozzle ${nozzleNumbers[invalidTankIndex]} must be linked to a valid source tank.` });
    const newNozzles: PumpNozzle[] = requestedNozzles.map((config: any, index: number) => {
      const sourceTank = tanks.find((tank) => tank.id === config.tankId);
      if (!sourceTank) throw new Error(`Nozzle ${nozzleNumbers[index]} must be linked to a valid source tank.`);
      const openingReading = Number(config.openingMeterReading ?? openingMeterReading ?? 0);
      return {
        id: `noz-${Date.now()}-${index + 1}`,
        physicalPumpId: '',
        nozzleNumber: nozzleNumbers[index],
        nozzleName: String(config.nozzleName || `Nozzle ${nozzleNumbers[index]}`),
        pumpNumber: num,
        pumpName: pumpName || `Pump ${num}`,
        tankId: sourceTank.id,
        fuelProductId: sourceTank.fuelProductId,
        fuelName: sourceTank.fuelName,
        openingMeterReading: openingReading,
        currentMeterReading: openingReading,
        status: 'Active',
      };
    });

    if(newNozzles.some(nozzle=>!Number.isFinite(nozzle.currentMeterReading)||nozzle.currentMeterReading<0))return res.status(400).json({message:'Recorded meters must be finite, non-negative numbers.'});
    const configurationMeterApprovals:ManagerApproval[]=[];
    let physicalPumpId = '';
    try {
      const sqlite = getSqlite();
      const pumpRecord = ensurePumpRecord(sqlite, null, num, pumpName || `Pump ${num}`);
      physicalPumpId = pumpRecord.id;
      newNozzles.forEach((nozzle) => {
        nozzle.physicalPumpId = physicalPumpId;
      });

      sqlite.transaction(() => {
        for (const nozzle of newNozzles) {
          const existing = db.pumpQueries.findByPhysicalPumpAndNumber(physicalPumpId, nozzle.nozzleNumber) as any;
          if (existing) {
            const requestedMeter = Number(nozzle.currentMeterReading);
            const existingMeter = Number(existing.currentMeterReading);
            const sourceConfig=requestedNozzles[nozzleNumbers.indexOf(Number(nozzle.nozzleNumber))];
            const hasReportedMeter=sourceConfig?.openingMeterReading!=null||openingMeterReading!=null;
            const meterChanged=hasReportedMeter&&hasMeterVariance(requestedMeter-existingMeter);
            db.pumpQueries.update(existing.id, {
              physicalPumpId,
              nozzleNumber: nozzle.nozzleNumber,
              nozzleName: nozzle.nozzleName,
              pumpNumber: nozzle.pumpNumber,
              pumpName: nozzle.pumpName,
              tankId: nozzle.tankId,
              fuelProductId: nozzle.fuelProductId,
              fuelName: nozzle.fuelName,
              status: 'Active',

            } as any);
            nozzle.id = existing.id;
            nozzle.openingMeterReading = Number(existing.openingMeterReading);
            nozzle.currentMeterReading = existingMeter;
            if (hasReportedMeter) {
              db.nozzleReadingQueries.create({
                id: `reading-${Date.now()}-${existing.id}-manual`, nozzleId: existing.id,
                pumpId: physicalPumpId, tankId: nozzle.tankId, fuelProductId: nozzle.fuelProductId,
                shiftId: null, transactionId: null, previousReading: existingMeter,
                quantityDispensed: 0, currentReading: requestedMeter, readingType: 'Observation',
                recordedBy: (req as any).authUser?.id || userId || null, timestamp: new Date().toISOString(),
              } as any);
            }
            if(meterChanged){
              const observer=(req as any).authUser;
              const review:ManagerApproval={id:`app-${randomUUID()}`,timestamp:new Date().toISOString(),type:'Nozzle Reading Variance',reviewScope:'READING',requestedBy:observer.name,reason:`Nozzle ${nozzle.pumpName}: user observed ${requestedMeter.toFixed(3)} L; last system/PTS-2 reading ${existingMeter.toFixed(3)} L. Configuration reading retained as an observation; physical meter unchanged.`,amountOrQty:`${(requestedMeter-existingMeter).toFixed(3)} L`,status:'Pending'};
              sqlite.prepare("INSERT INTO manager_approvals(id,timestamp,type,requested_by,reason,amount_or_qty,status,review_scope) VALUES(?,?,?,?,?,?,'Pending','READING')").run(review.id,review.timestamp,review.type,review.requestedBy,review.reason,review.amountOrQty);
              configurationMeterApprovals.push(review);
            }
            continue;
          }
          db.pumpQueries.create(nozzle as any);
          db.nozzleReadingQueries.create({
            id: `nr-opening-${nozzle.id}`,
            nozzleId: nozzle.id,
            pumpId: physicalPumpId,
            tankId: nozzle.tankId,
            fuelProductId: nozzle.fuelProductId,
            shiftId: null,
            transactionId: null,
            previousReading: nozzle.openingMeterReading,
            quantityDispensed: 0,
            currentReading: nozzle.currentMeterReading,
            readingType: 'Opening',
            recordedBy: userId || null,
            timestamp: new Date().toISOString(),
          } as any);
        }
        // Omitted nozzles are retired, not deleted, so historical dispensing and
        // meter-reading relationships remain intact.
        const submittedNumbers = newNozzles.map((nozzle) => nozzle.nozzleNumber);
        const existingNozzles = sqlite.prepare('SELECT id, nozzle_number FROM pump_nozzles WHERE physical_pump_id = ? AND status != ?').all(physicalPumpId, 'Inactive') as any[];
        existingNozzles.filter((nozzle) => !submittedNumbers.includes(Number(nozzle.nozzle_number))).forEach((nozzle) => {
          sqlite.prepare("UPDATE pump_nozzles SET status = 'Inactive', updated_at = ? WHERE id = ?").run(new Date().toISOString(), nozzle.id);
        });
      })();
    } catch (error) {
      console.error('Error saving pump nozzles to database:', error);
      const message=error instanceof Error?error.message:String(error),constraint=/SQLITE_CONSTRAINT|UNIQUE constraint/i.test(message);
      return res.status(constraint?409:500).json({success:false,code:constraint?'PUMP_NOZZLE_DUPLICATE':'DATABASE_OPERATION_FAILED',message:constraint?'This pump already contains one of the submitted nozzle numbers. No changes were saved.':'Pump configuration could not be saved.'});
    }

    approvals.unshift(...configurationMeterApprovals);
    const savedNozzleIds = new Set(newNozzles.map((nozzle) => nozzle.id));
    pumps = pumps.filter((nozzle) => !savedNozzleIds.has(nozzle.id) && nozzle.physicalPumpId !== physicalPumpId).concat(newNozzles);

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'PUMP_REGISTERED', 'Tanks', `Registered ${newNozzles.length} nozzle(s) on ${pumpName || `Pump ${num}`}.`);
    res.json(newNozzles[0]);
  });

  app.delete('/api/pumps/:id', (req, res) => {
    const { id } = req.params;
    const { userId, userName, userRole } = req.body || {};

    const permCheck = requirePermission(req, res, 'DELETE_PUMP', 'Pump nozzle deletion');
    if (permCheck) return permCheck;

    const pumpIndex = pumps.findIndex((pump) => pump.id === id);
    if (pumpIndex === -1) {
      return res.status(404).json({ message: 'Pump nozzle not found.' });
    }

    const removedPump = pumps[pumpIndex];
    const activeShift = shifts.find((shift) => shift.status === 'Active' && (shift.openingPumpReadings || []).some((reading) => reading.pumpId === id));
    if (activeShift) {
      return res.status(409).json({ message: `Cannot delete ${removedPump.nozzleName || 'this nozzle'} because it is part of the active shift for ${activeShift.staffName}. Clock out or close that shift first.` });
    }

    const historicalTransactions = transactions.filter((transaction: any) =>
      transaction.nozzleId === id || transaction.pumpId === id || (transaction.items || []).some((item: any) => item.nozzleId === id || item.pumpId === id)
    ).length;

    try {
      const sqlite = getSqlite();
      sqlite.transaction(() => {
        sqlite.prepare(`UPDATE pump_nozzles SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
      })();
    } catch (error) {
      console.error('Error deleting pump from database:', error);
      return res.status(500).json({ message: 'Nozzle could not be removed from operations.' });
    }

    pumps[pumpIndex] = { ...removedPump, status: 'Inactive' };

    addAuditLog(
      userId || 'sys',
      userName || 'System',
      userRole || 'Admin',
      'PUMP_DELETED',
      'Tanks',
      `Deleted ${removedPump.nozzleName || 'nozzle'} from ${removedPump.pumpName}. Tank: ${removedPump.tankId}. Fuel: ${removedPump.fuelName}. Historical transactions preserved (${historicalTransactions}).`
    );

    res.json({ success: true, deletedPump: removedPump, historicalTransactions });
  });

  app.delete('/api/pump-units/:id', (req, res) => {
    const { id } = req.params;
    const { userId, userName, userRole } = req.body || {};
    const permCheck = requirePermission(req, res, 'DELETE_PUMP', 'Physical pump deletion');
    if (permCheck) return permCheck;

    const sqlite = getSqlite();
    const pumpUnit = sqlite.prepare('SELECT id, pump_name, pump_number FROM pumps WHERE id = ? AND status != ?').get(id, 'Inactive') as any;
    if (!pumpUnit) return res.status(404).json({ message: 'Physical pump not found.' });
    const children = pumps.filter((nozzle) => nozzle.physicalPumpId === id && nozzle.status !== 'Inactive');
    const blockingShift = shifts.find((shift) => shift.status === 'Active' && (shift.openingPumpReadings || []).some((reading) => children.some((nozzle) => nozzle.id === reading.pumpId)));
    if (blockingShift) {
      return res.status(409).json({ message: `Cannot delete ${pumpUnit.pump_name} because a child nozzle is part of the active shift for ${blockingShift.staffName}. Clock out or close that shift first.` });
    }

    const childIds = new Set(children.map((nozzle) => nozzle.id));
    const historicalTransactions = transactions.filter((transaction: any) =>
      childIds.has(transaction.nozzleId || '') || childIds.has((transaction as any).pumpId || '') || (transaction.items || []).some((item: any) => childIds.has(item.nozzleId || item.pumpId || ''))
    ).length;

    try {
      sqlite.transaction(() => {
        sqlite.prepare(`UPDATE pump_nozzles SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE physical_pump_id = ?`).run(id);
        sqlite.prepare(`UPDATE pumps SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
      })();
    } catch (error) {
      console.error('Error deleting physical pump:', error);
      return res.status(500).json({ message: 'Physical pump could not be removed from operations.' });
    }

    pumps = pumps.map((nozzle) => nozzle.physicalPumpId === id ? { ...nozzle, status: 'Inactive' } : nozzle);
    addAuditLog(userId || 'sys', userName || 'System', userRole || 'Admin', 'PUMP_UNIT_DELETED', 'Tanks', `Deleted ${pumpUnit.pump_name} and ${children.length} linked nozzle(s). Historical transactions preserved (${historicalTransactions}).`);
    res.json({ success: true, deletedPumpUnit: id, childNozzleCount: children.length, historicalTransactions });
  });

  // Products & Fuel Prices
  app.get('/api/products', (req, res) => {
    res.json(products);
  });

  app.post('/api/products/price', (req, res) => {
    const { productId, newPrice, taxCode, productName, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_PUMPS', 'Fuel price updates');
    if (permCheck) return permCheck;

    const prod = products.find((p) => p.id === productId);
    if (!prod) return res.status(404).json({ message: 'Product not found' });

    const oldPrice = prod.pricePerLiter;
    const nextPrice = Number(newPrice);
    const nextTaxCode: TaxCode = normalizeTaxCode(taxCode || prod.taxCode || 'B');
    const nextTaxRate = getTaxRateByCode(nextTaxCode);
    const nextName = String(productName || prod.name || '').trim();
    prod.pricePerLiter = nextPrice;
    prod.taxCode = nextTaxCode;
    prod.taxRate = nextTaxRate;
    if (nextName) {
      prod.name = nextName;
    }

    try {
      db.productQueries.update(prod.id, {
        code: prod.code,
        name: prod.name,
        pricePerLiter: nextPrice,
        costPerLiter: Number(prod.costPerLiter ?? 0),
        taxRate: Number(nextTaxRate),
        taxCode: nextTaxCode,
        unit: prod.unit ?? 'L',
        color: prod.color ?? 'emerald',
      } as any);
    } catch (error) {
      console.error('Error updating product price in database:', error);
    }

    addAuditLog(
      userId,
      userName,
      userRole,
      'PRICE_CHANGE',
      'Settings',
      `Updated ${prod.name} fuel info: price KES ${oldPrice.toFixed(2)} → ${prod.pricePerLiter.toFixed(2)} / L, tax ${nextTaxCode}`,
      'Warning'
    );

    res.json(prod);
  });

  app.put('/api/products/:id', (req, res) => {
    const { id } = req.params;
    const { name, code, pricePerLiter, costPerLiter, taxCode, taxRate, unit, color, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_PUMPS', 'Fuel product edits');
    if (permCheck) return permCheck;

    const productIndex = products.findIndex((p) => p.id === id);
    if (productIndex === -1) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const existing = products[productIndex];
    const nextName = String(name ?? existing.name).trim();
    const nextCode = String(code ?? existing.code).trim();
    const nextPrice = Number(pricePerLiter ?? existing.pricePerLiter ?? 0);
    const nextCost = Number(costPerLiter ?? existing.costPerLiter ?? 0);
    const nextTaxCode = normalizeTaxCode(String(taxCode ?? existing.taxCode ?? 'B'));
    const nextTaxRate = Number(taxRate ?? getTaxRateByCode(nextTaxCode));

    products[productIndex] = {
      ...existing,
      code: nextCode || existing.code,
      name: nextName || existing.name,
      pricePerLiter: nextPrice,
      costPerLiter: nextCost,
      taxCode: nextTaxCode,
      taxRate: nextTaxRate,
      unit: String(unit ?? existing.unit ?? 'L'),
      color: String(color ?? existing.color ?? '#10b981'),
    };

    try {
      db.productQueries.update(id, {
        code: products[productIndex].code,
        name: products[productIndex].name,
        pricePerLiter: Number(products[productIndex].pricePerLiter ?? 0),
        costPerLiter: Number(products[productIndex].costPerLiter ?? 0),
        taxRate: Number(products[productIndex].taxRate ?? 0),
        taxCode: products[productIndex].taxCode ?? 'B',
        unit: products[productIndex].unit ?? 'L',
        color: products[productIndex].color ?? '#10b981',
      } as any);
    } catch (error) {
      console.error('Error updating product in database:', error);
    }

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'PRODUCT_UPDATED', 'Stock', `Updated fuel product ${products[productIndex].name} (${products[productIndex].code})`);
    res.json(products[productIndex]);
  });

  app.delete('/api/products/:id', (req, res) => {
    const { id } = req.params;
    const { userId, userName, userRole } = req.body || {};
    const permCheck = requirePermission(req, res, 'MANAGE_PUMPS', 'Fuel product deletion');
    if (permCheck) return permCheck;

    const productIndex = products.findIndex((p) => p.id === id);
    if (productIndex === -1) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const deletedProduct = products[productIndex];
    const sqlite = getSqlite();
    const dependencies=sqlite.prepare(`SELECT
      (SELECT COUNT(*) FROM fuel_tanks WHERE fuel_product_id=?) tanks,
      (SELECT COUNT(*) FROM pump_nozzles WHERE fuel_product_id=?) nozzles,
      (SELECT COUNT(*) FROM transactions WHERE product_id=?) transactions,
      (SELECT COUNT(*) FROM automation_device_mappings WHERE product_id=?) mappings`).get(id,id,id,id) as {tanks:number;nozzles:number;transactions:number;mappings:number};
    if(dependencies.tanks||dependencies.nozzles||dependencies.transactions||dependencies.mappings)return res.status(409).json({success:false,code:'PRODUCT_HAS_HISTORY',message:'Fuel product cannot be deleted while tanks, nozzles, transactions, or automation mappings reference it. Historical records were preserved.'});
    try {
      deleteProductAndLinkedRecords(sqlite, id);
    } catch (error) {
      console.error('Error deleting product from database:', error);
      return res.status(500).json({success:false,code:'DATABASE_OPERATION_FAILED',message:'Fuel product could not be deleted safely.'});
    }
    products.splice(productIndex, 1);

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'PRODUCT_DELETED', 'Stock', `Deleted fuel product ${deletedProduct.name} (${deletedProduct.code})`);
    res.json({ success: true, deletedProduct });
  });

  // Station & Invoice Settings
  app.get('/api/settings', (req, res) => {
    res.json(stationSettings);
  });

  app.post('/api/settings', (req, res) => {
    const { settings, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_SETTINGS', 'Station settings updates');
    if (permCheck) return permCheck;
    stationSettings = normalizeStationSettings({ ...stationSettings, ...settings });

    try {
      db.settingsQueries.update({
        id: 'station-1',
        stationName: stationSettings.stationName,
        tagline: stationSettings.tagline,
        taxPin: stationSettings.taxPin,
        address: stationSettings.address,
        phone: stationSettings.phone,
        email: stationSettings.email,
        invoiceTerms: stationSettings.invoiceTerms,
        paybillNumber: stationSettings.paybillNumber,
        paybillAccountNumber: stationSettings.paybillAccountNumber,
        tillNumber: stationSettings.tillNumber,
        showPaybillOnInvoice: stationSettings.showPaybillOnInvoice,
        showTillOnInvoice: stationSettings.showTillOnInvoice,
      } as any);
    } catch (error) {
      console.error('Error updating station settings in database:', error);
    }

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'SETTINGS_UPDATED', 'Settings', `Updated Station & Invoice Header configuration.`);
    res.json(stationSettings);
  });

  // Suppliers Management
  app.get('/api/suppliers', (req, res) => {
    res.json(suppliers.map(normalizeSupplierRecord));
  });

  app.post('/api/suppliers', (req, res) => {
    const { id, name, contactPerson, phone, email, address, kraPin, paymentTerms, status, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_SUPPLIERS', 'Supplier management');
    if (permCheck) return permCheck;
    const normalizedName = normalizeSupplierName(name);
    const normalizedPin = normalizeTaxId(kraPin);
    if (!normalizedName) return res.status(400).json({ message: 'Supplier name is required.' });
    if (suppliers.some((supplier) => supplier.id !== id && normalizeSupplierName(supplier.name) === normalizedName)) {
      return res.status(409).json({ message: 'A supplier with this name already exists.' });
    }
    if (normalizedPin && suppliers.some((supplier) => supplier.id !== id && normalizeTaxId(supplier.kraPin) === normalizedPin)) {
      return res.status(409).json({ message: 'A supplier with this Tax PIN already exists.' });
    }

    if (id) {
      const existing = suppliers.find((s) => s.id === id);
      if (existing) {
        existing.name = name || existing.name;
        existing.contactPerson = contactPerson !== undefined ? contactPerson : existing.contactPerson;
        existing.phone = phone || existing.phone;
        existing.email = email !== undefined ? email : existing.email;
        existing.address = address !== undefined ? address : existing.address;
        existing.kraPin = kraPin !== undefined ? normalizedPin : existing.kraPin;
        existing.paymentTerms = paymentTerms || existing.paymentTerms;
        existing.status = status || existing.status;

        try {
          db.supplierQueries.update(existing.id, {
            supplierName: existing.name,
            contactPerson: existing.contactPerson || '',
            phone: existing.phone || '',
            email: existing.email ?? null,
            address: existing.address ?? null,
            paymentTerms: existing.paymentTerms ?? null,
            status: existing.status || 'Active',
            taxId: existing.kraPin ?? null,
            accountBalance: Number(existing.currentBalance ?? 0),
          } as any);
        } catch (error) {
          console.error('Error updating supplier in database:', error);
        }

        addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'SUPPLIER_UPDATED', 'Suppliers', `Updated supplier profile for ${existing.name}.`);
        return res.json(existing);
      }
    }

    const newSupplier: SupplierAccount = {
      id: 'sup-' + Date.now(),
      name,
      contactPerson,
      phone: phone || '',
      email,
      address,
      kraPin: normalizedPin || undefined,
      currentBalance: 0,
      paymentTerms: paymentTerms || 'Net 14 Days',
      status: status || 'Active',
      createdAt: new Date().toISOString(),
    } as SupplierAccount;

    try {
      db.supplierQueries.create({
        id: newSupplier.id,
        supplierName: newSupplier.name,
        contactPerson: newSupplier.contactPerson || '',
        email: newSupplier.email ?? null,
        phone: newSupplier.phone || '',
        address: newSupplier.address ?? null,
        paymentTerms: newSupplier.paymentTerms ?? null,
        accountBalance: Number(newSupplier.currentBalance ?? 0),
        status: newSupplier.status || 'Active',
        taxId: newSupplier.kraPin ?? null,
        bankName: null,
        bankAccount: null,
      } as any);
    } catch (error) {
      console.error('Error saving supplier to database:', error);
      return res.status(isUniqueConstraintError(error)?409:500).json({ message: isUniqueConstraintError(error)?'Supplier name and Tax PIN must each be unique.':'Supplier could not be saved to the database.' });
    }

    suppliers.unshift(newSupplier);

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'SUPPLIER_CREATED', 'Suppliers', `Registered new oil supplier ${newSupplier.name}.`);
    res.json(newSupplier);
  });

  app.delete('/api/suppliers/:id', (req: any, res) => {
    const permCheck = requirePermission(req, res, 'DELETE_SUPPLIER', 'delete supplier');
    if (permCheck) return permCheck;
    const supplier = suppliers.find((item) => item.id === req.params.id);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
    const hasHistory = deliveries.some((delivery) => delivery.supplierId === supplier.id || normalizeSupplierName(delivery.supplierName) === normalizeSupplierName(supplier.name))
      || supplierPayments.some((payment) => payment.supplierId === supplier.id)
      || Number(supplier.currentBalance || 0) !== 0;
    if (hasHistory) return res.status(409).json({ message: 'Supplier cannot be deleted because it has deliveries, payments, or an outstanding balance.' });
    db.supplierQueries.delete(supplier.id);
    suppliers = suppliers.filter((item) => item.id !== supplier.id);
    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'SUPPLIER_DELETED', 'Suppliers', `Deleted supplier ${supplier.name} (${supplier.id}).`, 'Warning');
    res.json({ success: true });
  });

  app.post('/api/suppliers/payment', (req, res) => {
    const { supplierId, amount, paymentMethod, referenceNo, deliveryNoteNo, notes } = req.body;
    const permCheck = requirePermission(req, res, 'RECORD_SUPPLIER_PAYOUT', 'Supplier payment');
    if (permCheck) return permCheck;

    const actor = (req as any).authUser as User;
    const sup = resolveRegisteredSupplier(supplierId);
    if (!sup) {
      return res.status(400).json({
        message: 'Supplier must be registered before any payment or delivery-related transaction can be recorded.',
      });
    }

    const payAmount = Number(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than zero.' });
    }

    if (payAmount > sup.currentBalance) {
      return res.status(400).json({
        message: `Payment amount cannot exceed the supplier's outstanding balance of KES ${sup.currentBalance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}.`,
      });
    }

    const suppliedReference = String(referenceNo || '').trim();
    if (suppliedReference && supplierPayments.some((payment) => payment.referenceNo === suppliedReference)) {
      return res.status(409).json({ message: 'A supplier payout with this reference has already been recorded.' });
    }

    const oldBalance = sup.currentBalance;
    sup.currentBalance = Number((sup.currentBalance - payAmount).toFixed(2));

    try {
      db.supplierQueries.update(sup.id, {
        supplierName: sup.name,
        contactPerson: sup.contactPerson || '',
        phone: sup.phone || '',
        email: sup.email ?? null,
        address: sup.address ?? null,
        paymentTerms: sup.paymentTerms ?? null,
        accountBalance: Number(sup.currentBalance ?? 0),
        status: sup.status || 'Active',
        taxId: sup.kraPin ?? null,
      } as any);
    } catch (error) {
      console.error('Error syncing supplier payment balance to database:', error);
    }

    const paymentRecord: SupplierPayment = {
      id: 'suppay-' + Date.now(),
      supplierId: sup.id,
      supplierName: getSupplierName(sup),
      timestamp: new Date().toISOString(),
      amount: payAmount,
      paymentMethod: paymentMethod || 'Bank Transfer',
      referenceNo: referenceNo || `PAY-${Math.floor(100000 + Math.random() * 900000)}`,
      deliveryNoteNo,
      notes,
      recordedBy: actor.name,
    };
    supplierPayments.unshift(paymentRecord);
    try {
      db.supplierPaymentQueries.create({
        id: paymentRecord.id,
        supplierId: sup.id,
        amount: payAmount,
        paymentMethod: paymentRecord.paymentMethod,
        referenceNumber: paymentRecord.referenceNo || null,
        date: new Date().toISOString().slice(0, 10),
        approvedBy: actor.id,
        approvedByName: actor.name,
        notes: paymentRecord.notes || null,
        status: 'Completed',
      } as any);
    } catch (error) {
      console.error('Error persisting supplier payment to database:', error);
    }

    sup.currentBalance = getSupplierOutstandingBalance(sup.id);
    try {
      db.supplierQueries.update(sup.id, {
        accountBalance: sup.currentBalance,
      } as any);
    } catch (error) {
      console.error('Error updating supplier balance after payment:', error);
    }

    // Auto record cash flow outflow
    const cfRecord: CashFlowRecord = {
      id: 'cf-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'Outflow',
      category: 'Supplier Payment',
      amount: payAmount,
      paymentMethod: paymentMethod || 'Bank Transfer',
      referenceNo: paymentRecord.referenceNo,
      description: `Payment to Supplier ${getSupplierName(sup)}${deliveryNoteNo ? ` (Delivery Note: ${deliveryNoteNo})` : ''}`,
      recordedBy: actor.name,
    };
    cashFlow.unshift(cfRecord);
    try {
      db.cashFlowQueries.create({
        id: cfRecord.id,
        date: new Date(cfRecord.timestamp).toISOString().slice(0, 10),
        type: 'Outflow',
        category: 'Supplier Payment',
        description: cfRecord.description,
        amount: cfRecord.amount,
        accountingMethod: cfRecord.paymentMethod,
        referenceNo: cfRecord.referenceNo,
        relatedTransactionId: null,
        relatedDeliveryId: null,
        relatedPaymentId: paymentRecord.id,
        recordedBy: actor.id,
        recordedByName: actor.name,
        approvedBy: null,
        approvedByName: null,
        notes: notes || null,
        status: 'Recorded',
      } as any);
    } catch (error) {
      console.error('Error persisting supplier payout cash flow:', error);
      return res.status(500).json({ message: 'Supplier payment could not be recorded in cash flow.' });
    }

    addAuditLog(
      actor.id,
      actor.name,
      actor.role,
      'SUPPLIER_PAYMENT_RECORDED',
      'Suppliers',
      `Recorded KES ${payAmount.toLocaleString()} payment to ${getSupplierName(sup)}. Outstanding balance reduced from KES ${oldBalance.toLocaleString()} to KES ${sup.currentBalance.toLocaleString()}.`
    );

    res.json({ supplier: sup, payment: paymentRecord, cashFlow: cfRecord });
  });

  // Stock Management & Inventory Audits
  const createStockAdjustmentRecord = ({
    type,
    itemId,
    itemName,
    itemCode,
    previousQty,
    newQty,
    reason,
    userId,
    userName,
    userRole,
    source = 'Manual Adjustment',
    referenceNumber,
    originalDocumentNumber,
    movementType,
    notes,
  }: {
    type: 'Fuel' | 'Shop';
    itemId: string;
    itemName: string;
    itemCode?: string;
    previousQty: number;
    newQty: number;
    reason: string;
    userId?: string;
    userName?: string;
    userRole?: string;
    source?: string;
    referenceNumber?: string;
    originalDocumentNumber?: string;
    movementType?: string;
    notes?: string;
  }) => {
    const effectiveDifference = Number(newQty) - Number(previousQty);
    const effectiveMovementType = effectiveDifference > 0 ? 'Stock Increase' : effectiveDifference < 0 ? 'Stock Decrease' : 'No Change';
    const normalizedReason = reason || 'Stock Take Audit';
    const entry: StockAdjustment = {
      id: 'adj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      type,
      itemId,
      itemName,
      itemCode,
      previousQty: Number(previousQty),
      adjustedQty: Number(newQty),
      differenceQty: effectiveDifference,
      reason: normalizedReason as any,
      movementType: effectiveMovementType,
      source,
      referenceNumber,
      originalDocumentNumber,
      performedBy: userName || 'System',
      notes: notes || `Inventory ${type === 'Fuel' ? 'fuel tank' : 'shop item'} adjusted. Previous=${previousQty}; New=${newQty}; Difference=${effectiveDifference}`,
      recordedBy: userName || 'Station Manager',
    };

    db.stockAdjustmentQueries.create({
      id: entry.id,
      type,
      referenceId: itemId,
      referenceName: itemName,
      previousQuantity: Number(previousQty),
      adjustmentQuantity: effectiveDifference,
      newQuantity: Number(newQty),
      reason: normalizedReason,
      movementType: effectiveMovementType,
      source,
      referenceNumber: referenceNumber || null,
      originalDocumentNumber: originalDocumentNumber || null,
      productCode: itemCode || null,
      performedBy: userName || userId || 'System',
      recordedBy: userId || 'sys',
      recordedByName: userName || 'Station Manager',
      notes: entry.notes || null,
    } as any);

    addAuditLog(
      userId || 'sys',
      userName || 'Manager',
      userRole || 'Admin',
      'STOCK_ADJUSTMENT_LOGGED',
      'Stock',
      `Stock adjustment for ${itemName}: Previous=${previousQty}, New=${newQty}, Diff=${effectiveDifference}. Reason: ${normalizedReason}. Source: ${source}${referenceNumber ? ` Ref: ${referenceNumber}` : ''}`
    );

    stockAdjustments.unshift(entry);
    return entry;
  };

  app.get('/api/stock/adjustments', (req, res) => {
    const roleCheck = requirePermission(req as any, res, 'ADJUST_STOCK', 'view stock adjustment logs');
    if (roleCheck) return roleCheck;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));
    const sqlite = getSqlite();
    const total = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM stock_adjustments').get() as any).count || 0);
    const records = sqlite.prepare('SELECT * FROM stock_adjustments ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize)
      .map((record: any) => ({
        id: record.id,
        timestamp: record.created_at,
        type: record.type,
        itemId: record.reference_id,
        itemName: record.reference_name,
        itemCode: record.product_code || undefined,
        previousQty: Number(record.previous_quantity),
        adjustedQty: Number(record.new_quantity),
        differenceQty: Number(record.adjustment_quantity),
        reason: record.reason,
        movementType: record.movement_type || undefined,
        source: record.source || undefined,
        referenceNumber: record.reference_number || undefined,
        originalDocumentNumber: record.original_document_number || undefined,
        performedBy: record.performed_by || undefined,
        notes: record.notes || undefined,
        recordedBy: record.recorded_by_name || 'System',
      }));
    res.json({ records, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  });

  app.post('/api/stock/adjustments', (req, res) => {
    const { type, itemId, newQty, reason } = req.body;
    const roleCheck = requirePermission(req as any, res, 'ADJUST_STOCK', 'stock adjustments');
    if (roleCheck) return roleCheck;
    if (String(req.body.type || '').toLowerCase() === 'fuel') return res.status(403).json({ message: 'Fuel stock is managed in the Pumps & Tanks tab through administrator dip setup.' });
    const actor = (req as any).authUser as User;

    let previousQty = 0;
    let itemName = '';

    if (type === 'Fuel') {
      const tank = tanks.find((t) => t.id === itemId);
      if (!tank) return res.status(404).json({ message: 'Fuel tank not found.' });
      previousQty = tank.currentLevelLiters;
      tank.currentLevelLiters = Number(newQty);
      tank.lastDipReading = Number(newQty);
      tank.lastDipTime = new Date().toISOString();
      itemName = tank.tankName;
    } else {
      const item = shopItems.find((s) => s.id === itemId);
      if (!item) return res.status(404).json({ message: 'Shop item not found.' });
      previousQty = item.stockQty;
      item.stockQty = Number(newQty);
      itemName = item.name;
    }

    let adjRecord: StockAdjustment;
    try {
      adjRecord = createStockAdjustmentRecord({
        type: (type || 'Shop') as 'Fuel' | 'Shop',
        itemId,
        itemName,
        previousQty,
        newQty: Number(newQty),
        reason: reason || 'Stock Take Audit',
        userId: actor.id,
        userName: actor.name,
        userRole: actor.role,
        source: 'Manual Adjustment',
        movementType: Number(newQty) - previousQty > 0 ? 'Stock Increase' : Number(newQty) - previousQty < 0 ? 'Stock Decrease' : 'No Change',
        notes: `Inventory ${type === 'Fuel' ? 'fuel tank' : 'shop item'} adjusted. Previous=${previousQty}; New=${newQty}; Difference=${Number(newQty) - previousQty}`,
      });
    } catch (error) {
      if (type === 'Fuel') {
        const tank = tanks.find((entry) => entry.id === itemId);
        if (tank) tank.currentLevelLiters = previousQty;
      } else {
        const item = shopItems.find((entry) => entry.id === itemId);
        if (item) item.stockQty = previousQty;
      }
      console.error('Error persisting stock adjustment:', error);
      return res.status(500).json({ message: 'Stock adjustment could not be recorded.' });
    }

    if (type === 'Fuel') {
      const tank = tanks.find((t) => t.id === itemId);
      if (tank) {
        try {
          db.tankQueries.update(tank.id, {
            currentLevelLiters: Number(newQty),
            lastDipReading: Number(newQty),
            lastDipTime: new Date().toISOString(),
          } as any);
        } catch (error) {
          console.error('Error persisting fuel stock adjustment:', error);
        }
      }
    } else {
      const item = shopItems.find((s) => s.id === itemId);
      if (item) {
        try {
          db.shopItemQueries.update(item.id, {
            stockQty: Number(newQty),
          } as any);
        } catch (error) {
          console.error('Error persisting shop stock adjustment:', error);
        }
      }
    }

    res.json(adjRecord);
  });

  // Corporate Customer Accounts & Credit Debt Management
  app.get('/api/customers', (req, res) => {
    res.json(customers.map(normalizeCustomerRecord));
  });

  app.post('/api/customers', (req, res) => {
    const { id, name, kraPin, phone, email, address, creditLimit, vehicles, status, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_CREDIT_CUSTOMERS', 'Customer account management');
    if (permCheck) return permCheck;
    const submittedName=String(name||'').trim();
    const normalizedName=submittedName.toLowerCase();
    const normalizedPin = normalizeTaxId(kraPin);
    if (!submittedName) return res.status(400).json({ message: 'Customer name is required.' });
    if (!normalizedPin) return res.status(400).json({ message: 'Customer Tax PIN is required.' });
    if (customers.some((customer) => customer.id !== id && String(customer.name||'').trim().toLowerCase() === normalizedName)) {
      return res.status(409).json({ message: 'A customer with this name already exists.' });
    }
    if (customers.some((customer) => customer.id !== id && normalizeTaxId(customer.kraPin) === normalizedPin)) {
      return res.status(409).json({ message: 'A customer with this Tax PIN already exists.' });
    }

    if (id) {
      const existing = customers.find((c) => c.id === id);
      if (existing) {
        existing.name = submittedName;
        existing.kraPin = normalizedPin;
        existing.phone = phone || existing.phone;
        existing.email = email !== undefined ? email : existing.email;
        existing.address = address !== undefined ? address : existing.address;
        existing.creditLimit = creditLimit !== undefined ? Number(creditLimit) : existing.creditLimit;
        existing.status = status || existing.status;
        if (vehicles && Array.isArray(vehicles)) {
          existing.vehicles = vehicles;
        }

        try {
          db.customerQueries.update(existing.id, {
            businessName: existing.name,
            contactPerson: existing.name,
            email: existing.email ?? null,
            phone: existing.phone || '',
            address: existing.address ?? null,
            accountType: 'Corporate',
            creditLimit: Number(existing.creditLimit ?? 0),
            currentDebt: Number(existing.currentBalance ?? 0),
            status: existing.status || 'Active',
            taxId: existing.kraPin ?? null,
          } as any);
        } catch (error) {
          console.error('Error updating customer in database:', error);
          return res.status(isUniqueConstraintError(error)?409:500).json({message:isUniqueConstraintError(error)?'Customer name and Tax PIN must each be unique.':'Customer account could not be updated.'});
        }

        addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'CUSTOMER_UPDATED', 'Sales', `Updated customer ${existing.name} (Credit Limit: KES ${existing.creditLimit.toLocaleString()}, Status: ${existing.status}).`);
        return res.json(existing);
      }
    }

    const newCust: CustomerAccount = {
      id: 'cust-' + Date.now(),
      name:submittedName,
      kraPin: normalizedPin,
      phone: phone || '',
      email,
      address,
      creditLimit: Number(creditLimit || 100000),
      currentBalance: 0,
      vehicles: Array.isArray(vehicles) ? vehicles : [],
      status: status || 'Active',
      createdAt: new Date().toISOString(),
    };

    try {
      db.customerQueries.create({
        id: newCust.id,
        businessName: newCust.name,
        contactPerson: newCust.name,
        email: newCust.email ?? null,
        phone: newCust.phone || '',
        address: newCust.address ?? null,
        accountType: 'Corporate',
        creditLimit: Number(newCust.creditLimit ?? 0),
        currentDebt: Number(newCust.currentBalance ?? 0),
        status: newCust.status || 'Active',
        taxId: newCust.kraPin ?? null,
      } as any);
    } catch (error) {
      console.error('Error saving customer to database:', error);
      return res.status(isUniqueConstraintError(error)?409:500).json({ message: isUniqueConstraintError(error)?'Customer name and Tax PIN must each be unique.':'Customer account could not be saved to the database.' });
    }

    customers.unshift(newCust);

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'CUSTOMER_CREATED', 'Sales', `Created new customer account ${newCust.name} with credit limit KES ${newCust.creditLimit.toLocaleString()}.`);
    res.json(newCust);
  });

  app.delete('/api/customers/:id', (req: any, res) => {
    const permCheck = requirePermission(req, res, 'DELETE_CUSTOMER', 'delete customer');
    if (permCheck) return permCheck;
    const customer = customers.find((item) => item.id === req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found.' });
    const hasHistory = transactions.some((transaction: any) => transaction.customerId === customer.id || normalizeTaxId(transaction.customerPin) === normalizeTaxId(customer.kraPin))
      || creditNotes.some((note: any) => note.customerId === customer.id || normalizeTaxId(note.customerPin) === normalizeTaxId(customer.kraPin))
      || Number(customer.currentBalance || 0) !== 0;
    if (hasHistory) return res.status(409).json({ message: 'Customer cannot be deleted because financial history or an outstanding balance exists.' });
    db.customerQueries.delete(customer.id);
    customers = customers.filter((item) => item.id !== customer.id);
    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'CUSTOMER_DELETED', 'Sales', `Deleted customer ${customer.name} (${customer.id}).`, 'Warning');
    res.json({ success: true });
  });

  app.post('/api/customers/repayment', (req, res) => {
    const { customerId, amount, paymentMethod, referenceNo, notes, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_CASH_FLOW', 'Customer repayment');
    if (permCheck) return permCheck;

    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return res.status(404).json({ message: 'Customer account not found.' });

    const payAmount = Number(amount);
    if (payAmount <= 0) {
      return res.status(400).json({ message: 'Repayment amount must be greater than zero.' });
    }

    const oldBalance = cust.currentBalance;
    cust.currentBalance = Math.max(0, cust.currentBalance - payAmount);

    try {
      db.customerQueries.update(cust.id, {
        businessName: cust.name,
        contactPerson: cust.name,
        email: cust.email ?? null,
        phone: cust.phone || '',
        address: cust.address ?? null,
        accountType: 'Corporate',
        creditLimit: Number(cust.creditLimit ?? 0),
        currentDebt: Number(cust.currentBalance ?? 0),
        status: cust.status || 'Active',
        taxId: cust.kraPin ?? null,
      } as any);
    } catch (error) {
      console.error('Error updating customer debt balance in database:', error);
    }

    const cfRecord: CashFlowRecord = {
      id: 'cf-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'Inflow',
      category: 'Debt Repayment',
      amount: payAmount,
      paymentMethod: paymentMethod || 'Bank Transfer',
      referenceNo: referenceNo || `PAY-${Math.floor(100000 + Math.random() * 900000)}`,
      description: `Debt repayment by ${cust.name} (${notes || 'Credit account settlement'})`,
      recordedBy: userName || 'Station Staff',
    };

    try {
      db.cashFlowQueries.create({
        id: cfRecord.id,
        date: cfRecord.timestamp.slice(0, 10),
        type: 'Inflow',
        category: cfRecord.category,
        description: cfRecord.description,
        amount: cfRecord.amount,
        accountingMethod: cfRecord.paymentMethod,
        referenceNo: cfRecord.referenceNo,
        relatedTransactionId: null,
        relatedDeliveryId: null,
        relatedPaymentId: null,
        recordedBy: userId || null,
        recordedByName: cfRecord.recordedBy,
        approvedBy: null,
        approvedByName: null,
        notes: cfRecord.referenceNo || null,
        status: 'Recorded',
      } as any);
    } catch (error) {
      cust.currentBalance = oldBalance;
      console.error('Error saving customer repayment cash flow to database:', error);
      return res.status(500).json({ message: 'Debt repayment could not be saved.' });
    }

    cashFlow.unshift(cfRecord);

    addAuditLog(
      userId || 'sys',
      userName || 'Staff',
      userRole || 'Station Manager',
      'CUSTOMER_DEBT_REPAYMENT',
      'Sales',
      `Received KES ${payAmount.toLocaleString()} debt repayment from ${cust.name}. Debt balance reduced from KES ${oldBalance.toLocaleString()} to KES ${cust.currentBalance.toLocaleString()}.`
    );

    res.json({ customer: cust, cashFlow: cfRecord });
  });

  // Cash Flow Ledger
  app.get('/api/cash-flow', (req, res) => {
    cashFlow = (db.cashFlowQueries.all() as any[]).map(normalizeStoredCashFlow);
    res.json(cashFlow);
  });

  app.post('/api/cash-flow', (req, res) => {
    const { type, category, amount, paymentMethod, referenceNo, description, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'MANAGE_CASH_FLOW', 'Cash flow entry');
    if (permCheck) return permCheck;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than zero.' });
    }

    const newRecord: CashFlowRecord = {
      id: 'cf-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: type || 'Inflow',
      category: category || 'Other',
      amount: Number(amount),
      paymentMethod: paymentMethod || 'Cash',
      referenceNo: referenceNo || `REF-${Math.floor(100000 + Math.random() * 900000)}`,
      description: description || 'Manual cash flow entry',
      recordedBy: userName || 'Station Staff',
    };

    try {
      db.cashFlowQueries.create({
        id: newRecord.id,
        date: newRecord.timestamp.slice(0, 10),
        type: newRecord.type === 'Outflow' ? 'Expense' : 'Inflow',
        category: newRecord.category,
        description: newRecord.description,
        amount: newRecord.amount,
        accountingMethod: newRecord.paymentMethod,
        referenceNo: newRecord.referenceNo,
        relatedTransactionId: null,
        relatedDeliveryId: null,
        relatedPaymentId: null,
        recordedBy: userId || null,
        recordedByName: newRecord.recordedBy,
        approvedBy: null,
        approvedByName: null,
        notes: newRecord.referenceNo,
        status: 'Recorded',
      } as any);
    } catch (error) {
      console.error('Error saving cash flow entry to database:', error);
      return res.status(500).json({ message: 'Cash flow entry could not be saved.' });
    }

    cashFlow.unshift(newRecord);
    addAuditLog(userId || 'sys', userName || 'Staff', userRole || 'Manager', 'CASH_FLOW_LOGGED', 'Sales', `Recorded ${type} of KES ${Number(amount).toLocaleString()} (${category}): ${description}`);
    res.json(newRecord);
  });

  // ---- Credit Notes ----
  app.get('/api/credit-notes', (req, res) => {
    res.json(creditNotes);
  });

  app.post('/api/credit-notes', (req, res) => {
    const {
      originalTransactionId,
      originalDocumentType,
      originalDocumentNo,
      originalInvoiceNo,
      originalReceiptNo,
      documentType,
      customerName,
      customerPin,
      vehiclePlate,
      items,
      reason,
      reasonCode,
      issuedBy,
      userId,
      userName,
      userRole,
    } = req.body;

    const permCheck = requirePermission(req, res, 'CREATE_CREDIT_NOTE', 'Credit note creation');
    if (permCheck) return permCheck;

    const normalizedInvoiceNo = String(originalInvoiceNo || '').trim();
    const normalizedReceiptNo = String(originalReceiptNo || '').trim();
    const requestedDocumentType = String(originalDocumentType || documentType || 'invoice').toLowerCase();
    const targetType = requestedDocumentType === 'receipt' ? 'receipt' : 'invoice';
    const normalizedOriginalDocumentNo = String(originalDocumentNo || (targetType === 'receipt' ? normalizedReceiptNo : normalizedInvoiceNo) || '').trim();

    let originalTx = transactions.find((tx) => tx.id === originalTransactionId);

    if (!originalTx) {
      const exactDocNo = normalizeDocumentNumber(
        normalizedOriginalDocumentNo || (targetType === 'receipt' ? normalizedReceiptNo : normalizedInvoiceNo),
        targetType === 'receipt' ? 'Rcpt' : 'Inv'
      );

      if (targetType === 'receipt') {
        originalTx = transactions.find((tx) => tx.receiptNo && normalizeDocumentNumber(tx.receiptNo, 'Rcpt') === exactDocNo);
      } else {
        originalTx = transactions.find((tx) => tx.taxInvoiceNo && normalizeDocumentNumber(tx.taxInvoiceNo, 'Inv') === exactDocNo);
      }
    }

    if (!originalTx && normalizedReceiptNo) {
      originalTx = transactions.find((tx) => tx.receiptNo && normalizeDocumentNumber(tx.receiptNo, 'Rcpt') === normalizeDocumentNumber(normalizedReceiptNo, 'Rcpt'));
    }

    if (!originalTx && normalizedInvoiceNo) {
      originalTx = transactions.find((tx) => tx.taxInvoiceNo && normalizeDocumentNumber(tx.taxInvoiceNo, 'Inv') === normalizeDocumentNumber(normalizedInvoiceNo, 'Inv'));
    }

    const effectiveInvoiceNo = (normalizedInvoiceNo && /^Inv/i.test(normalizedInvoiceNo)) ? normalizedInvoiceNo : (originalTx?.taxInvoiceNo || normalizedInvoiceNo || '');
    const effectiveReceiptNo = (normalizedReceiptNo && /^(Rcpt|Rec)/i.test(normalizedReceiptNo)) ? normalizedReceiptNo : (originalTx?.receiptNo || normalizedReceiptNo || '');
    const actualCreditDocumentNo = targetType === 'receipt' ? (effectiveReceiptNo || effectiveInvoiceNo) : (effectiveInvoiceNo || effectiveReceiptNo);

    const creditedItems = (items || []).map((i: any) => {
      const qty = Number(i.quantity ?? i.qty ?? 1) || 0;
      const unitPrice = Number(i.unitPrice ?? 0) || 0;
      const exactOriginalItemId = String(i.originalItemId || i.itemId || '').trim();
      const selectedOriginalItem = originalTx?.items.find((src) => src.itemId === exactOriginalItemId) ||
        (originalTx?.items.find((src) => String(src.name || '').trim().toLowerCase() === String(i.name || '').trim().toLowerCase()) || null);
      const taxCode = String((i.taxCode || selectedOriginalItem?.taxCode || 'A')).toUpperCase();
      const normalizedTaxCode = normalizeTaxCodeValue(taxCode);
      return { quantity: qty, unitPrice, taxCode: normalizedTaxCode };
    });

    const computedTotals = computeDocumentTotals(creditedItems);
    const subtotal = computedTotals.subtotal;
    const totalTax = computedTotals.taxAmount;
    const totalAmount = computedTotals.totalAmount;

    const formattedItems = creditedItems.map((line, index) => {
      const item = (items || [])[index] ?? {};
      const qty = Number(item.quantity ?? item.qty ?? 1) || 0;
      const unitPrice = Number(item.unitPrice ?? 0) || 0;
      const exactOriginalItemId = String(item.originalItemId || item.itemId || '').trim();
      const requestedSourceNozzleId = String(item.sourceNozzleId || '').trim();
      const selectedOriginalItem = originalTx?.items.find((src) => {
        const sameNozzle = !requestedSourceNozzleId || String(src.nozzleId || src.pumpId || '').trim() === requestedSourceNozzleId;
        const sameItemId = src.itemId === exactOriginalItemId;
        const sameName = String(src.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase();
        return sameNozzle && (sameItemId || sameName);
      }) || (!requestedSourceNozzleId
        ? originalTx?.items.find((src) => String(src.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase()) || null
        : null);
      const taxCode = normalizeTaxCodeValue(String((item.taxCode || selectedOriginalItem?.taxCode || 'A')).toUpperCase());
      const lineTotals = computedTotals.items[index] ?? {
        grossAmount: qty * unitPrice,
        netAmount: qty * unitPrice,
        taxAmount: 0,
        taxRate: TAX_RATE_MAP[taxCode] ?? 0,
      };
      return {
        itemId: item.itemId || `item-cn-${index}`,
        originalItemId: selectedOriginalItem?.itemId || exactOriginalItemId || item.itemId || `item-cn-${index}`,
        // The source nozzle comes from the original persisted sale, never from the credit-note request.
        sourceNozzleId: selectedOriginalItem?.nozzleId || selectedOriginalItem?.pumpId || null,
        name: item.name,
        type: item.type || selectedOriginalItem?.type || 'Fuel',
        qty,
        quantity: qty,
        unitPrice,
        totalPrice: lineTotals.grossAmount,
        totalAmount: lineTotals.grossAmount,
        taxableAmount: lineTotals.netAmount,
        taxAmount: lineTotals.taxAmount,
        taxRate: lineTotals.taxRate,
        taxCode,
      };
    });

    if (originalTx) {
      const originalTotalAmount = Number(originalTx.totalAmount ?? 0);
      const relatedCreditNotes = creditNotes.filter((cn) => {
        if (cn.status === 'Voided') return false;
        const sameTransaction = cn.originalTransactionId === originalTx.id;
        const sameInvoice = !!originalTx.taxInvoiceNo && !!cn.originalInvoiceNo && normalizeDocumentNumber(cn.originalInvoiceNo, 'Inv') === normalizeDocumentNumber(originalTx.taxInvoiceNo, 'Inv');
        const sameReceipt = !!originalTx.receiptNo && !!cn.originalReceiptNo && normalizeDocumentNumber(cn.originalReceiptNo, 'Rcpt') === normalizeDocumentNumber(originalTx.receiptNo, 'Rcpt');
        return sameTransaction || sameInvoice || sameReceipt;
      });
      const alreadyCredited = relatedCreditNotes.reduce((sum, cn) => sum + Number(cn.totalAmount ?? 0), 0);
      const remainingCredit = Math.max(originalTotalAmount - alreadyCredited, 0);
      if (totalAmount > remainingCredit + 0.0001) {
        return res.status(400).json({
          message: `Credit note exceeds remaining creditable amount on ${originalTx.taxInvoiceNo || originalTx.receiptNo || 'this document'}. Remaining: KES ${remainingCredit.toFixed(2)}.`,
          remaining: remainingCredit,
          originalTotal: originalTotalAmount,
          alreadyCredited,
        });
      }

      const requestedQtyByOriginalItem = new Map<string, number>();
      for (const item of formattedItems) {
        const requestedSourceNozzleId = String(item.sourceNozzleId || '').trim();
        const match = originalTx.items.find((src) => {
          const sameNozzle = !requestedSourceNozzleId || String(src.nozzleId || src.pumpId || '').trim() === requestedSourceNozzleId;
          const sameItemId = !!item.originalItemId && src.itemId === item.originalItemId;
          const sameName = String(src.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase();
          return sameNozzle && (sameItemId || sameName);
        });
        if (!match) {
          return res.status(400).json({ message: `Credit item ${item.name || 'unknown'} does not exist on the original document.` });
        }
        const itemKey = (match.itemId || String(match.name || '').trim().toLowerCase()) + '::' + String(match.nozzleId || match.pumpId || '').trim();
        requestedQtyByOriginalItem.set(itemKey, (requestedQtyByOriginalItem.get(itemKey) ?? 0) + Number(item.qty ?? 0));
      }

      for (const [itemKey, requestedQty] of requestedQtyByOriginalItem) {
        const separatorAt = itemKey.lastIndexOf('::');
        const originalItemKey = separatorAt >= 0 ? itemKey.slice(0, separatorAt) : itemKey;
        const originalSourceNozzleId = separatorAt >= 0 ? itemKey.slice(separatorAt + 2) : '';
        const match = originalTx.items.find((src) => {
          const sameItem = (src.itemId || String(src.name || '').trim().toLowerCase()) === originalItemKey;
          const sameNozzle = !originalSourceNozzleId || String(src.nozzleId || src.pumpId || '').trim() === originalSourceNozzleId;
          return sameItem && sameNozzle;
        })!;
        const previouslyCreditedQty = relatedCreditNotes.reduce((sum, creditNote) => sum + (creditNote.items || []).reduce((itemSum, item) => {
          const sameItemId = !!item.originalItemId && item.originalItemId === match.itemId;
          const sameName = String(item.name || '').trim().toLowerCase() === String(match.name || '').trim().toLowerCase();
          const sameNozzle = !originalSourceNozzleId || !item.sourceNozzleId || String(item.sourceNozzleId).trim() === originalSourceNozzleId;
          return (sameItemId || sameName) && sameNozzle ? itemSum + Number(item.quantity ?? item.qty ?? 0) : itemSum;
        }, 0), 0);
        const remainingQty = Math.max(Number(match.qty ?? 0) - previouslyCreditedQty, 0);
        if (requestedQty > remainingQty + 0.0001) {
          return res.status(400).json({
            message: `Credit quantity for ${match.name} exceeds the remaining creditable quantity. Remaining: ${remainingQty}.`,
            item: match.name,
            originalQty: Number(match.qty ?? 0),
            previouslyCreditedQty,
            remainingQty,
            requestedQty,
          });
        }
      }
    }

    // Shop returns are restored to shop stock. Fuel credit notes are financial-only
    // unless the operator explicitly selects RTT (Return to Tank). RTT is tied to
    // the nozzle persisted on the original sale so litres cannot be moved to a
    // different tank by editing the credit-note request.
    const normalizedCreditReasonCode = String(reasonCode || '').trim().toUpperCase();
    const isReturnToTank = normalizedCreditReasonCode === 'RTT'
      || /\bRTT\b|RETURN\s+TO\s+TANK/i.test(String(reason || ''));

    if (isReturnToTank && formattedItems.some((item) => String(item.type || '').toLowerCase() !== 'fuel')) {
      return res.status(400).json({ message: 'RTT is available only for fuel credit-note lines.' });
    }
    const stockReturnByItemId = new Map<string, { targetItem: ShopItem; quantity: number }>();
    for (const creditedItem of formattedItems) {
      if (String(creditedItem.type || '').toLowerCase() !== 'shop') continue;

      const originalItemId = String(creditedItem.originalItemId || creditedItem.itemId || '').trim();
      const normalizedName = String(creditedItem.name || '').trim().toLowerCase();
      const targetItem = shopItems.find((shopItem) => shopItem.id === originalItemId)
        || shopItems.find((shopItem) => shopItem.id === String(creditedItem.itemId || '').trim())
        || shopItems.find((shopItem) => normalizedName && String(shopItem.name || '').trim().toLowerCase() === normalizedName);

      if (!targetItem) {
        return res.status(400).json({ message: 'The credited shop product ' + (creditedItem.name || 'unknown item') + ' no longer exists in inventory. Restore or map the product before issuing a credit note.' });
      }

      const quantity = Number(creditedItem.qty ?? creditedItem.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ message: 'Credit quantity for ' + targetItem.name + ' must be greater than zero.' });
      }

      const existing = stockReturnByItemId.get(targetItem.id);
      stockReturnByItemId.set(targetItem.id, {
        targetItem,
        quantity: Number(((existing?.quantity ?? 0) + quantity).toFixed(6)),
      });
    }
    const stockReturnPlans = [...stockReturnByItemId.values()];

    const tankReturnByTankId = new Map<string, { targetTank: FuelTank; sourceNozzleId: string; quantity: number }>();
    if (isReturnToTank) {
      for (const creditedItem of formattedItems) {
        const originalItemId = String(creditedItem.originalItemId || creditedItem.itemId || '').trim();
        const sourceNozzleId = String(creditedItem.sourceNozzleId || '').trim();
        const sourceNozzle = pumps.find((nozzle) => nozzle.id === sourceNozzleId);
        if (!sourceNozzle) {
          return res.status(400).json({ message: 'RTT requires the original sale to retain its source nozzle mapping.' });
        }
        if (String(sourceNozzle.fuelProductId || '') !== originalItemId) {
          return res.status(400).json({ message: 'RTT cannot restore fuel because the original sale product does not match its source nozzle.' });
        }

        const targetTank = tanks.find((tank) => tank.id === sourceNozzle.tankId);
        if (!targetTank || String(targetTank.fuelProductId || '') !== String(sourceNozzle.fuelProductId || '')) {
          return res.status(400).json({ message: 'RTT requires an active source-tank mapping for the original sale nozzle.' });
        }

        const quantity = Number(creditedItem.qty ?? creditedItem.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return res.status(400).json({ message: 'RTT quantity for ' + (creditedItem.name || 'fuel') + ' must be greater than zero.' });
        }

        const existing = tankReturnByTankId.get(targetTank.id);
        tankReturnByTankId.set(targetTank.id, {
          targetTank,
          sourceNozzleId,
          quantity: Number(((existing?.quantity ?? 0) + quantity).toFixed(6)),
        });
      }

      for (const { targetTank, quantity } of tankReturnByTankId.values()) {
        const currentLevel = Number(targetTank.currentLevelLiters ?? 0);
        const capacity = Number(targetTank.capacityLiters ?? 0);
        if (!Number.isFinite(currentLevel) || !Number.isFinite(capacity) || currentLevel + quantity > capacity + 0.000001) {
          return res.status(400).json({ message: 'RTT would exceed the capacity of ' + targetTank.tankName + '.' });
        }
      }
    }
    const tankReturnPlans = [...tankReturnByTankId.values()];
    const newCN: CreditNote = {
      id: 'cn-' + Date.now(),
      creditNoteNo: generateCreditNoteNumber(),
      originalTransactionId: originalTx?.id,
      originalDocumentType: targetType,
      originalDocumentNo: actualCreditDocumentNo || normalizedOriginalDocumentNo || (targetType === 'receipt' ? effectiveReceiptNo : effectiveInvoiceNo),
      originalInvoiceNo: targetType === 'invoice' ? (effectiveInvoiceNo || actualCreditDocumentNo || 'Inv000') : (originalTx?.taxInvoiceNo || normalizedInvoiceNo || ''),
      originalReceiptNo: targetType === 'receipt' ? (effectiveReceiptNo || actualCreditDocumentNo || 'Rcpt000') : (originalTx?.receiptNo || normalizedReceiptNo || ''),
      timestamp: new Date().toISOString(),
      customerName: customerName || 'Walk-in Customer',
      customerPin,
      vehiclePlate,
      items: formattedItems,
      subtotal,
      taxAmount: totalTax,
      totalAmount,
      reason,
      issuedBy: issuedBy || userName || 'Station Manager',
      status: 'Issued',
    };

    const cashFlowRecord: CashFlowRecord = {
      id: 'cf-' + Date.now(),
      timestamp: newCN.timestamp,
      type: 'Outflow',
      category: 'Credit Note',
      amount: newCN.totalAmount,
      paymentMethod: 'Credit',
      referenceNo: newCN.creditNoteNo,
      description: 'Credit note ' + newCN.creditNoteNo + ' issued against ' + (newCN.originalDocumentNo || 'unknown document') + ' - ' + (reason || 'No reason provided'),
      recordedBy: issuedBy || userName || 'Station Manager',
    };

    const stockAdjustmentsBeforePersistence = [...stockAdjustments];
    const auditLogsBeforePersistence = [...auditLogs];
    const restoredStock: Array<{ targetItem: ShopItem; nextQty: number }> = [];
    const restoredTankStock: Array<{ targetTank: FuelTank; quantity: number; nextQty: number }> = [];

    try {
      const persistCreditNoteAndStock = getSqlite().transaction(() => {
        db.creditNoteQueries.create({
          id: newCN.id,
          creditNoteNo: newCN.creditNoteNo,
          customerId: null,
          customerName: newCN.customerName || 'Walk-in Customer',
          customerPin: newCN.customerPin || null,
          vehiclePlate: newCN.vehiclePlate || null,
          amount: Number(newCN.totalAmount ?? totalAmount),
          subtotal: Number(newCN.subtotal ?? subtotal),
          taxAmount: Number(newCN.taxAmount ?? totalTax),
          totalAmount: Number(newCN.totalAmount ?? totalAmount),
          reason: newCN.reason || reason || 'Other Reason',
          narration: newCN.reason || reason || 'Credit note issued',
          status: newCN.status || 'Issued',
          itemsJson: JSON.stringify(newCN.items || []),
          originalTransactionId: newCN.originalTransactionId || originalTx?.id || null,
          originalDocumentType: newCN.originalDocumentType || targetType || 'invoice',
          originalDocumentNo: newCN.originalDocumentNo || actualCreditDocumentNo || normalizedOriginalDocumentNo || null,
          originalInvoiceNo: newCN.originalInvoiceNo || (targetType === 'invoice' ? effectiveInvoiceNo || actualCreditDocumentNo || null : null),
          originalReceiptNo: newCN.originalReceiptNo || (targetType === 'receipt' ? effectiveReceiptNo || actualCreditDocumentNo || null : null),
          issuedBy: userId || null,
          issuedByName: issuedBy || userName || 'Station Manager',
          approvedBy: null,
          approvedByName: null,
          appliedToTransactionId: null,
          timestamp: newCN.timestamp,
        } as any);

        db.cashFlowQueries.create({
          id: cashFlowRecord.id,
          date: cashFlowRecord.timestamp.slice(0, 10),
          type: 'Expense',
          category: cashFlowRecord.category,
          description: cashFlowRecord.description,
          amount: cashFlowRecord.amount,
          accountingMethod: cashFlowRecord.paymentMethod,
          referenceNo: cashFlowRecord.referenceNo,
          relatedTransactionId: originalTx?.id || null,
          relatedDeliveryId: null,
          relatedPaymentId: null,
          recordedBy: userId || null,
          recordedByName: cashFlowRecord.recordedBy,
          approvedBy: null,
          approvedByName: null,
          notes: 'Credit note ' + newCN.creditNoteNo,
          status: 'Recorded',
        } as any);

        for (const { targetItem, quantity } of stockReturnPlans) {
          const persistedItem = db.shopItemQueries.byId(targetItem.id) as ShopItem | undefined;
          if (!persistedItem) throw new Error('Credited shop product no longer exists in inventory.');
          const previousQty = Number(persistedItem.stockQty ?? 0);
          const nextQty = Number((previousQty + quantity).toFixed(6));
          if (!Number.isFinite(previousQty) || !Number.isFinite(nextQty)) {
            throw new Error('Credit note stock return has an invalid inventory quantity.');
          }

          db.shopItemQueries.update(targetItem.id, { stockQty: nextQty } as any);
          createStockAdjustmentRecord({
            type: 'Shop',
            itemId: targetItem.id,
            itemName: targetItem.name,
            itemCode: targetItem.code,
            previousQty,
            newQty: nextQty,
            reason: 'Credit Note Return',
            userId: userId || 'sys',
            userName: userName || issuedBy || 'System',
            userRole: userRole || 'Admin',
            source: 'Credit Note',
            referenceNumber: newCN.creditNoteNo,
            originalDocumentNumber: newCN.originalDocumentNo || newCN.originalInvoiceNo || newCN.originalReceiptNo || '-',
            movementType: 'Stock Return',
            notes: 'Credit note return restored ' + quantity + ' ' + targetItem.name + ' unit(s) to inventory. Original document: ' + (newCN.originalDocumentNo || newCN.originalInvoiceNo || newCN.originalReceiptNo || 'Unknown document') + '.',
          });
          restoredStock.push({ targetItem, nextQty });
        }

        for (const { targetTank, sourceNozzleId, quantity } of tankReturnPlans) {
          const persistedNozzle = db.pumpQueries.byId(sourceNozzleId) as PumpNozzle | undefined;
          const persistedTank = db.tankQueries.byId(targetTank.id) as FuelTank | undefined;
          if (!persistedNozzle || persistedNozzle.tankId !== targetTank.id || persistedNozzle.fuelProductId !== targetTank.fuelProductId) {
            throw new Error('RTT source nozzle mapping changed before the credit note could be recorded.');
          }
          if (!persistedTank || persistedTank.fuelProductId !== targetTank.fuelProductId) {
            throw new Error('RTT source tank mapping changed before the credit note could be recorded.');
          }

          const fuelProduct = products.find((product) => product.id === targetTank.fuelProductId);
          const sourceNozzleLabel = [persistedNozzle.pumpName, persistedNozzle.nozzleName].filter(Boolean).join(' / ') || persistedNozzle.id;
          const previousQty = Number(persistedTank.currentLevelLiters ?? 0);
          const capacity = Number(persistedTank.capacityLiters ?? 0);
          const nextQty = Number((previousQty + quantity).toFixed(6));
          if (!Number.isFinite(previousQty) || !Number.isFinite(capacity) || nextQty > capacity + 0.000001) {
            throw new Error('RTT would exceed the current capacity of ' + targetTank.tankName + '.');
          }

          db.tankQueries.update(targetTank.id, { currentLevelLiters: nextQty } as any);
          getSqlite().prepare("INSERT INTO tank_stock_ledger(id,tank_id,product_id,movement_type,quantity,before_balance,after_balance,source,reference,actor_id,delivery_id,occurred_at) VALUES(?,?,?,'CREDIT_NOTE_RTT',?,?,?,'CREDIT_NOTE_RTT',?,?,NULL,?)").run(
            'credit-rtt:' + newCN.id + ':' + targetTank.id,
            targetTank.id,
            targetTank.fuelProductId,
            quantity,
            previousQty,
            nextQty,
            newCN.creditNoteNo,
            String((req as any).authUser?.id || userId || 'SYSTEM'),
            newCN.timestamp
          );
          createStockAdjustmentRecord({
            type: 'Fuel',
            itemId: targetTank.id,
            itemName: targetTank.tankName,
            itemCode: fuelProduct?.code || targetTank.fuelProductId,
            previousQty,
            newQty: nextQty,
            reason: 'Credit Note RTT Return to Tank',
            userId: String((req as any).authUser?.id || userId || 'sys'),
            userName: String((req as any).authUser?.name || userName || issuedBy || 'System'),
            userRole: ((req as any).authUser?.role || userRole || 'Admin') as any,
            source: 'Credit Note RTT',
            referenceNumber: newCN.creditNoteNo,
            originalDocumentNumber: newCN.originalDocumentNo || newCN.originalInvoiceNo || newCN.originalReceiptNo || '-',
            movementType: 'Stock Return',
            notes: 'RTT return | Tank: ' + targetTank.tankName + ' | Product: ' + (fuelProduct?.name || targetTank.fuelName) + ' | Nozzle: ' + sourceNozzleLabel + ' | Added: ' + quantity + ' L | Stock: ' + previousQty + ' L -> ' + nextQty + ' L | Credit note: ' + newCN.creditNoteNo + ' | Original document: ' + (newCN.originalDocumentNo || newCN.originalInvoiceNo || newCN.originalReceiptNo || 'Unknown document') + '.',
          });
          restoredTankStock.push({ targetTank, quantity, nextQty });
        }
      });

      persistCreditNoteAndStock();
    } catch (error) {
      // createStockAdjustmentRecord updates in-memory history after its database write.
      // Restore that in-memory projection when SQLite rolls the transaction back.
      stockAdjustments = stockAdjustmentsBeforePersistence;
      auditLogs = auditLogsBeforePersistence;
      console.error('Error saving credit note with inventory return:', error);
      return res.status(500).json({ error: 'Credit note could not be saved with its inventory return or RTT tank restoration.' });
    }

    cashFlow.unshift(cashFlowRecord);
    for (const { targetItem, nextQty } of restoredStock) {
      targetItem.stockQty = nextQty;
    }
    for (const { targetTank, nextQty } of restoredTankStock) {
      targetTank.currentLevelLiters = nextQty;
    }

    for (const { targetItem, nextQty } of restoredStock) {
      const returned = stockReturnPlans.find((plan) => plan.targetItem.id === targetItem.id);
      addAuditLog(
        userId || 'sys',
        userName || 'Station Staff',
        userRole || 'Admin',
        'CREDIT_NOTE_STOCK_RESTORED',
        'Shop',
        'Restored ' + (returned?.quantity ?? 0) + ' ' + targetItem.name + ' unit(s) to inventory after credit note ' + newCN.creditNoteNo + '. New stock: ' + nextQty + '.'
      );
    }
    for (const { targetTank, quantity, nextQty } of restoredTankStock) {
      addAuditLog(
        userId || 'sys',
        userName || issuedBy || 'Station Staff',
        userRole || 'Admin',
        'CREDIT_NOTE_RTT_TANK_RESTORED',
        'Tanks',
        'RTT credit note ' + newCN.creditNoteNo + ' restored ' + quantity + ' L to ' + targetTank.tankName + '. New stock: ' + nextQty + ' L.'
      );
    }
    addAuditLog(
      userId || 'sys',
      issuedBy || 'Manager',
      userRole || 'Admin',
      'CREDIT_NOTE_ISSUED',
      'Sales',
      `Issued Credit Note ${newCN.creditNoteNo} against ${newCN.originalDocumentNo || actualCreditDocumentNo || 'Unknown Document'} for KES ${totalAmount.toFixed(2)}. Reason: ${reason}`,
      'Warning'
    );

    creditNotes.unshift(newCN);
    res.json(newCN);
  });

  // ======================================================================
  // SHOP ITEMS – with granular permissions
  // ======================================================================

  app.get('/api/shop', (req, res) => {
    res.json(shopItems);
  });

  app.post('/api/shop', (req, res) => {
    const {
      code,
      name,
      category,
      unitPrice,
      price,
      costPrice,
      stockQty,
      reorderLevel,
      requireShiftCount,
      taxCode,
      taxType,
      country,
      currency,
      productType,
      unit,
      userId,
      userName,
      userRole,
    } = req.body;
    const permCheck = requirePermission(req, res, 'CREATE_SHOP_ITEM', 'Shop item creation');
    if (permCheck) return permCheck;

    const normalizedTaxCode = String(taxType || taxCode || 'A').toUpperCase();
    const allowedTaxCodes = ['A', 'B', 'C', 'D', 'E'];
    if (!allowedTaxCodes.includes(normalizedTaxCode)) {
      return res.status(400).json({ message: 'Tax code is required and must be one of A, B, C, D, or E.' });
    }

    const normalizedCountry = String(country || 'KE').toUpperCase();
    const normalizedCurrency = String(currency || 'KES').toUpperCase();
    const normalizedUnit = String(unit || 'Pieces');
    const normalizedProductType = Number(productType ?? 1);
    const normalizedPrice = Number(price ?? unitPrice ?? 0);

    const newItem: ShopItem = {
      id: 'shp-' + Date.now(),
      code: code || `ITM-${Math.floor(100 + Math.random() * 900)}`,
      name,
      category: category || 'General',
      unitPrice: Number(unitPrice ?? normalizedPrice),
      price: Number(normalizedPrice),
      costPrice: Number(costPrice || normalizedPrice * 0.8),
      stockQty: Number(stockQty || 0),
      reorderLevel: Number(reorderLevel || 5),
      requireShiftCount: Boolean(requireShiftCount),
      taxCode: normalizedTaxCode as any,
      taxType: normalizedTaxCode as any,
      country: normalizedCountry as any,
      currency: normalizedCurrency as any,
      productType: [1, 2, 3].includes(normalizedProductType) ? (normalizedProductType as 1 | 2 | 3) : 1,
      unit: (normalizedUnit as any),
    } as ShopItem;

    shopItems.unshift(newItem);

    try {
      db.shopItemQueries.create({
        id: newItem.id,
        code: newItem.code,
        name: newItem.name,
        category: newItem.category,
        unitPrice: Number(newItem.unitPrice ?? 0),
        price: Number(newItem.price ?? newItem.unitPrice ?? 0),
        costPrice: Number(newItem.costPrice ?? newItem.unitPrice ?? 0),
        stockQty: Number(newItem.stockQty ?? 0),
        reorderLevel: Number(newItem.reorderLevel ?? 0),
        requireShiftCount: Number(Boolean(newItem.requireShiftCount)),
        taxCode: newItem.taxCode ?? 'A',
        taxType: newItem.taxType ?? (newItem.taxCode ?? 'A'),
        country: newItem.country ?? 'KE',
        currency: newItem.currency ?? 'KES',
        productType: Number(newItem.productType ?? 1),
        unit: newItem.unit ?? 'Pieces',
      } as any);
    } catch (error) {
      console.error('Error saving shop item to database:', error);
    }

    addAuditLog(userId || 'sys', userName || 'Staff', userRole || 'Manager', 'PRODUCT_REGISTERED', 'Shop', `Registered new item: ${newItem.name} (${newItem.code}) at KES ${newItem.unitPrice}`);

    res.json(newItem);
  });

  app.put('/api/shop/:id', (req, res) => {
    const { id } = req.params;
    const { name, code, category, unitPrice, price, costPrice, stockQty, reorderLevel, requireShiftCount, taxCode, taxType, country, currency, productType, unit, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'UPDATE_SHOP_ITEM', 'Shop item update');
    if (permCheck) return permCheck;

    const itemIndex = shopItems.findIndex((s) => s.id === id);
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Shop item not found.' });
    }

    const existingItem = shopItems[itemIndex];
    const nextTaxCode = String(taxType || taxCode || existingItem.taxCode || 'A').toUpperCase();
    const normalizedCountry = String(country || existingItem.country || 'KE').toUpperCase();
    const normalizedCurrency = String(currency || existingItem.currency || 'KES').toUpperCase();
    const normalizedUnit = String(unit || existingItem.unit || 'Pieces');
    const normalizedProductType = Number(productType ?? existingItem.productType ?? 1);

    shopItems[itemIndex] = {
      ...existingItem,
      code: String(code || existingItem.code),
      name: String(name || existingItem.name),
      category: String(category || existingItem.category || 'General'),
      unitPrice: Number(unitPrice ?? price ?? existingItem.unitPrice ?? 0),
      price: Number(price ?? unitPrice ?? existingItem.price ?? existingItem.unitPrice ?? 0),
      costPrice: Number(costPrice ?? existingItem.costPrice ?? 0),
      stockQty: Number(stockQty ?? existingItem.stockQty ?? 0),
      reorderLevel: Number(reorderLevel ?? existingItem.reorderLevel ?? 5),
      requireShiftCount: Boolean(requireShiftCount ?? existingItem.requireShiftCount ?? true),
      taxCode: nextTaxCode as any,
      taxType: nextTaxCode as any,
      country: normalizedCountry as any,
      currency: normalizedCurrency as any,
      productType: [1, 2, 3].includes(normalizedProductType) ? normalizedProductType as 1 | 2 | 3 : 1,
      unit: normalizedUnit as any,
    };

    try {
      db.shopItemQueries.update(id, {
        code: shopItems[itemIndex].code,
        name: shopItems[itemIndex].name,
        category: shopItems[itemIndex].category,
        unitPrice: Number(shopItems[itemIndex].unitPrice ?? 0),
        price: Number(shopItems[itemIndex].price ?? shopItems[itemIndex].unitPrice ?? 0),
        costPrice: Number(shopItems[itemIndex].costPrice ?? 0),
        stockQty: Number(shopItems[itemIndex].stockQty ?? 0),
        reorderLevel: Number(shopItems[itemIndex].reorderLevel ?? 0),
        requireShiftCount: Number(Boolean(shopItems[itemIndex].requireShiftCount)),
        taxCode: shopItems[itemIndex].taxCode ?? 'A',
        taxType: shopItems[itemIndex].taxType ?? (shopItems[itemIndex].taxCode ?? 'A'),
        country: shopItems[itemIndex].country ?? 'KE',
        currency: shopItems[itemIndex].currency ?? 'KES',
        productType: Number(shopItems[itemIndex].productType ?? 1),
        unit: shopItems[itemIndex].unit ?? 'Pieces',
      } as any);
    } catch (error) {
      console.error('Error updating shop item in database:', error);
    }

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'PRODUCT_UPDATED', 'Shop', `Updated shop item ${shopItems[itemIndex].name} (${shopItems[itemIndex].code})`);
    res.json(shopItems[itemIndex]);
  });

  app.delete('/api/shop/:id', (req, res) => {
    const { id } = req.params;
    const { userId, userName, userRole } = req.body || {};
    const permCheck = requirePermission(req, res, 'DELETE_SHOP_ITEM', 'Shop item deletion');
    if (permCheck) return permCheck;

    const itemIndex = shopItems.findIndex((s) => s.id === id);
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Shop item not found.' });
    }

    const [deletedItem] = shopItems.splice(itemIndex, 1);
    try {
      db.shopItemQueries.delete(id);
    } catch (error) {
      console.error('Error deleting shop item from database:', error);
    }

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'PRODUCT_DELETED', 'Shop', `Deleted shop item ${deletedItem.name} (${deletedItem.code})`);
    res.json({ success: true, deletedItem });
  });

  app.post('/api/shop/bulk', (req, res) => {
    const { items, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'BULK_UPLOAD_SHOP_ITEMS', 'Bulk shop upload');
    if (permCheck) return permCheck;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'No items provided for bulk upload.' });
    }

    const allowedTaxCodes = ['A', 'B', 'C', 'D', 'E'];
    const addedItems: ShopItem[] = [];
    items.forEach((row: any, idx: number) => {
      const normalizedTaxCode = String(row.taxType || row.taxCode || row.tax || 'A').toUpperCase();
      if (!allowedTaxCodes.includes(normalizedTaxCode)) {
        return;
      }

      const rawPrice = Number(row.price ?? row.unitPrice ?? row.salePrice ?? 0);
      const normalizedCountry = String(row.country || 'KE').toUpperCase();
      const normalizedCurrency = String(row.currency || 'KES').toUpperCase();
      const normalizedUnit = String(row.unit || 'Pieces');
      const normalizedProductType = Number(row.productType ?? row.product_type ?? 1);

      const newItem: ShopItem = {
        id: 'shp-' + (Date.now() + idx),
        code: row.code || `XLS-${Math.floor(1000 + Math.random() * 9000)}`,
        name: row.name || `Uploaded Product ${idx + 1}`,
        category: row.category || 'General',
        unitPrice: Number(rawPrice),
        price: Number(rawPrice),
        costPrice: Number(row.costPrice || row.cost || rawPrice * 0.8),
        stockQty: Number(row.stockQty || row.qty || 0),
        reorderLevel: Number(row.reorderLevel || 5),
        requireShiftCount: Boolean(row.requireShiftCount),
        taxCode: normalizedTaxCode as any,
        taxType: normalizedTaxCode as any,
        country: normalizedCountry as any,
        currency: normalizedCurrency as any,
        productType: [1, 2, 3].includes(normalizedProductType) ? (normalizedProductType as 1 | 2 | 3) : 1,
        unit: (normalizedUnit as any),
      };
      shopItems.unshift(newItem);
      addedItems.push(newItem);

      try {
        db.shopItemQueries.create({
          id: newItem.id,
          code: newItem.code,
          name: newItem.name,
          category: newItem.category,
          unitPrice: Number(newItem.unitPrice ?? 0),
          price: Number(newItem.price ?? newItem.unitPrice ?? 0),
          costPrice: Number(newItem.costPrice ?? newItem.unitPrice ?? 0),
          stockQty: Number(newItem.stockQty ?? 0),
          reorderLevel: Number(newItem.reorderLevel ?? 0),
          requireShiftCount: Number(Boolean(newItem.requireShiftCount)),
          taxCode: newItem.taxCode ?? 'A',
          taxType: newItem.taxType ?? (newItem.taxCode ?? 'A'),
          country: newItem.country ?? 'KE',
          currency: newItem.currency ?? 'KES',
          productType: Number(newItem.productType ?? 1),
          unit: newItem.unit ?? 'Pieces',
        } as any);
      } catch (error) {
        console.error('Error saving bulk shop item to database:', error);
      }
    });

    addAuditLog(userId || 'sys', userName || 'Manager', userRole || 'Admin', 'EXCEL_ITEMS_UPLOADED', 'Shop', `Imported ${addedItems.length} items via Excel spreadsheet sheet batch upload.`);

    res.json({ message: `Successfully uploaded ${addedItems.length} items from Excel sheet.`, items: addedItems });
  });

  app.post('/api/shop/adjust', (req, res) => {
    const { itemId, newQty, reason, userId, userName, userRole } = req.body;
    const permCheck = requirePermission(req, res, 'ADJUST_STOCK', 'Shop stock adjustment');
    if (permCheck) return permCheck;

    const item = shopItems.find((s) => s.id === itemId);
    if (!item) return res.status(404).json({ message: 'Shop item not found' });

    const oldQty = item.stockQty;
    item.stockQty = Number(newQty);

    try {
      db.shopItemQueries.update(item.id, { stockQty: item.stockQty } as any);
    } catch (error) {
      item.stockQty = oldQty;
      console.error('Error saving shop stock adjustment to database:', error);
      return res.status(500).json({ message: 'Shop stock adjustment could not be saved.' });
    }

    addAuditLog(
      userId,
      userName,
      userRole,
      'STOCK_ADJUSTMENT',
      'Shop',
      `Adjusted stock for ${item.name} from ${oldQty} to ${newQty}. Reason: ${reason}`
    );

    res.json(item);
  });

  // Sales & Tax Invoicing
  app.get('/api/sales', (req, res) => {
    // Automation posts directly and atomically to SQLite; refresh this legacy
    // in-memory projection so viewers see authoritative backend captures.
    transactions = (db.transactionQueries.all() as any[]).map(normalizeStoredTransaction);
    res.json(transactions);
  });

  app.post('/api/sales/:id/settle', async (req, res) => {
    const actingUser = (req as any).authUser as User | undefined;
    if (!actingUser) return res.status(401).json({ message: 'Authentication required.' });
    const paymentMethod = String(req.body?.paymentMethod || '').trim();
    const paymentReference = String(req.body?.paymentReference || '').trim();
    if (!['Cash', 'M-Pesa', 'Card', 'Bank Transfer'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Select Cash, M-Pesa, Card, or Bank Transfer.' });
    }
    if (paymentMethod !== 'Cash' && !paymentReference) {
      return res.status(400).json({ message: `A ${paymentMethod} payment reference is required.` });
    }
    const activeShift = shifts.find((shift) => shift.status === 'Active' && shift.staffId === actingUser.id);
    if (!activeShift) return res.status(400).json({ message: 'Clock in before confirming an automated payment.' });
    const sqlite = getSqlite();
    try {
      const settled = sqlite.transaction(() => {
        const pending = sqlite.prepare(`SELECT * FROM transactions WHERE id=?`).get(req.params.id) as any;
        if (!pending) throw new Error('TRANSACTION_NOT_FOUND');
        if (pending.source !== 'AUTOMATION') throw new Error('NOT_AUTOMATION_TRANSACTION');
        if (pending.status !== 'Payment Pending') throw new Error('ALREADY_SETTLED');
        let pendingItems: any[] = [];
        try {
          pendingItems = JSON.parse(String(pending.items_json || '[]'));
        } catch {
          throw new Error('INVALID_TRANSACTION_ITEMS');
        }
        if (!Array.isArray(pendingItems) || pendingItems.length === 0) {
          throw new Error('INVALID_TRANSACTION_ITEMS');
        }
        const recomputed = computeDocumentTotals(pendingItems.map((item: any) => ({
          quantity: Number(item.quantity ?? item.qty ?? 0),
          unitPrice: Number(item.unitPrice ?? 0),
          taxCode: normalizeTaxCodeValue(String(item.taxCode || 'A')),
        })));
        const correctedItems = pendingItems.map((item: any, index: number) => ({
          ...item,
          totalPrice: recomputed.items[index].grossAmount,
          taxableAmount: recomputed.items[index].netAmount,
          taxAmount: recomputed.items[index].taxAmount,
          taxRate: recomputed.items[index].taxRate,
          taxCode: recomputed.items[index].taxCode,
        }));
        const receiptNumber = generateReceiptNumber();
        const reference = paymentReference || receiptNumber;
        const updated = sqlite.prepare(`UPDATE transactions SET items_json=?,subtotal=?,tax=?,total_amount=?,payment_method=?,attendant_id=?,attendant_name=?,receipt_number=?,document_type='Receipt',status='Completed',settlement_shift_id=?,settled_at=?,notes=COALESCE(notes,'')||?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Payment Pending'`).run(JSON.stringify(correctedItems),recomputed.subtotal,recomputed.taxAmount,recomputed.totalAmount,paymentMethod,actingUser.id,actingUser.name,receiptNumber,activeShift.id,new Date().toISOString(),`; Payment confirmed via ${paymentMethod}${paymentReference ? ` (${paymentReference})` : ''}`,pending.id);
        if (updated.changes !== 1) throw new Error('ALREADY_SETTLED');
        sqlite.prepare(`INSERT INTO cash_flow_records(id,date,type,category,description,amount,accounting_method,reference_no,related_transaction_id,recorded_by,recorded_by_name,status) VALUES(?,date('now','localtime'),'Inflow','Fuel Sales',?,?,?,?,?,?,?,'Recorded')`).run(`cf-auto-${randomUUID()}`,`Automated fuel sale ${receiptNumber}`,Number(pending.total_amount),paymentMethod,reference,pending.id,actingUser.id,actingUser.name);
        return sqlite.prepare(`SELECT * FROM transactions WHERE id=?`).get(pending.id);
      })();
      transactions = (db.transactionQueries.all() as any[]).map(normalizeStoredTransaction);
      const normalized = normalizeStoredTransaction(settled);
      addAuditLog(actingUser.id,actingUser.name,actingUser.role,'AUTOMATION_PAYMENT_CONFIRMED','Sales',`Confirmed ${normalized.receiptNo} for KES ${normalized.totalAmount.toFixed(2)} via ${paymentMethod}.`);
      await refreshTransactionMeters(settled.nozzle_id?[String(settled.nozzle_id)]:[]);
      res.json(normalized);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'TRANSACTION_NOT_FOUND') return res.status(404).json({ message: 'Automated transaction not found.' });
      if (code === 'NOT_AUTOMATION_TRANSACTION') return res.status(400).json({ message: 'Only automated pending transactions can use this confirmation action.' });
      if (code === 'ALREADY_SETTLED') return res.status(409).json({ message: 'This transaction has already been confirmed.' });
      if (code === 'INVALID_TRANSACTION_ITEMS') return res.status(422).json({ message: 'Payment cannot be confirmed because the transaction lines are missing or invalid.' });
      console.error('Automated payment confirmation failed:', error);
      res.status(500).json({ message: 'Payment confirmation failed safely. No receipt was issued.' });
    }
  });

  app.get('/api/shifts/active', (req, res) => {
    const activeShift = hydrateShiftSummaries().find((shift) => shift.status === 'Active');
    res.json(activeShift ?? null);
  });

  app.post('/api/sales', async (req, res) => {
    const { shiftId, staffId, staffName, type, items, paymentMethod, paymentRef, customerName, vehiclePlate, customerPin, documentType } = req.body;

    const shift = shifts.find((s) => s.id === shiftId);
    if (!shift || shift.status !== 'Active') {
      return res.status(400).json({ message: 'Must be clocked into an active shift to process sales.' });
    }
    const actingUser = (req as any).authUser as User | undefined;
    if (!actingUser || shift.staffId !== actingUser.id) {
      return res.status(403).json({ message: 'Sales must be recorded against the authenticated user\'s active shift.' });
    }

    const requestedDocumentType = documentType === 'Invoice' ? 'Invoice' : 'Receipt';

    const invalidNozzle = items.find((item: any) => {
      if (item.type !== 'Fuel') return false;
      const nozzleId = item.nozzleId || item.pumpId;
      const nozzle = pumps.find((entry) => entry.id === nozzleId);
      const tank = nozzle ? tanks.find((entry) => entry.id === nozzle.tankId) : null;
      return !nozzle
        || nozzle.status !== 'Active'
        || nozzle.fuelProductId !== item.itemId
        || !tank
        || tank.fuelProductId !== nozzle.fuelProductId
        || Number(tank.currentLevelLiters ?? 0) < Number(item.qty ?? 0);
    });
    if (invalidNozzle) {
      return res.status(400).json({ message: 'Fuel sale rejected: select an active nozzle configured for this product with sufficient stock in its source tank.' });
    }

    const saleLines = items.map((item: any) => {
      const qty = Number(item.qty ?? 0);
      const unitPrice = Number(item.unitPrice ?? 0);
      const taxCode = normalizeTaxCode(String(item.taxCode || (item.type === 'Fuel' ? 'B' : 'A')).toUpperCase());
      return {
        quantity: qty,
        unitPrice,
        taxCode,
      };
    });
    const computedTotals = computeDocumentTotals(saleLines);

    const formattedItems = items.map((item: any, index: number) => {
      const itemTotal = Number(item.qty) * Number(item.unitPrice);
      const taxCode = normalizeTaxCode(String(item.taxCode || (item.type === 'Fuel' ? 'B' : 'A')).toUpperCase());
      const lineTotals = computedTotals.items[index] ?? {
        grossAmount: itemTotal,
        taxAmount: 0,
        netAmount: itemTotal,
        taxCode,
        taxRate: TAX_RATE_MAP[taxCode] ?? 0,
      };
      return { item, itemTotal, tax: lineTotals.taxAmount, taxCode };
    });
    const totalAmount = computedTotals.totalAmount;
    const totalTax = computedTotals.taxAmount;

    let matchedCustomer: CustomerAccount | undefined;
    if (paymentMethod === 'Credit') {
      matchedCustomer = customers.find(
        (c) =>
          (customerPin && c.kraPin?.toLowerCase() === customerPin.toLowerCase()) ||
          (customerName && c.name.toLowerCase() === customerName.toLowerCase()) ||
          (c.vehicles && vehiclePlate && c.vehicles.some((v) => v.toLowerCase().replace(/\s+/g, '') === vehiclePlate.toLowerCase().replace(/\s+/g, '')))
      );

      if (requestedDocumentType === 'Invoice') {
        if (!matchedCustomer) {
          return res.status(400).json({
            message: 'No recognised customer account found for this credit invoice. Add the customer or switch to Receipt mode.',
          });
        }
        if (matchedCustomer.status !== 'Active') {
          return res.status(400).json({ message: `Customer account '${matchedCustomer.name}' is ${matchedCustomer.status}. Credit sales blocked.` });
        }
        if (matchedCustomer.currentBalance + totalAmount > matchedCustomer.creditLimit) {
          const avail = Math.max(0, matchedCustomer.creditLimit - matchedCustomer.currentBalance);
          return res.status(400).json({
            message: `CREDIT LIMIT EXCEEDED! ${matchedCustomer.name} Limit: KES ${matchedCustomer.creditLimit.toLocaleString()}, Outstanding Debt: KES ${matchedCustomer.currentBalance.toLocaleString()}, Available: KES ${avail.toLocaleString()}. Invoice total KES ${totalAmount.toLocaleString()} rejected.`,
          });
        }
      }
    }

    const saleMovementEntries: Array<{
      itemId: string;
      nozzleId?: string;
      name: string;
      code?: string;
      type: 'Fuel' | 'Shop';
      previousQty: number;
      newQty: number;
      qtySold: number;
    }> = [];

    const finalItems = formattedItems.map(({ item, itemTotal, tax, taxCode }) => {
      const qtySold = Number(item.qty);
      let previousQty = 0;
      let nextQty = 0;

      if (item.type === 'Fuel') {
        const nozzleId = item.nozzleId || item.pumpId;
        const nozzle = pumps.find((entry) => entry.id === nozzleId);
        if (!nozzle) {
          throw new Error(`Fuel sale rejected: nozzle ${nozzleId} not found.`);
        }

        if (nozzle.fuelProductId !== item.itemId) {
          throw new Error(`Fuel sale rejected: nozzle ${nozzle.nozzleName || nozzle.pumpName} does not match the selected product.`);
        }

        const tank = tanks.find((t) => t.id === nozzle.tankId);
        if (tank) {
          previousQty = Number(tank.currentLevelLiters ?? 0);
          tank.currentLevelLiters = Math.max(0, previousQty - qtySold);
          nextQty = Number(tank.currentLevelLiters ?? 0);
        }

        if(!pts2NozzleIds().has(nozzle.id))nozzle.currentMeterReading += qtySold;
      } else if (item.type === 'Shop') {
        const shopItem = shopItems.find((s) => s.id === item.itemId);
        if (shopItem) {
          previousQty = Number(shopItem.stockQty ?? 0);
          shopItem.stockQty = Math.max(0, previousQty - qtySold);
          nextQty = Number(shopItem.stockQty ?? 0);
        }
      }

      saleMovementEntries.push({
        itemId: item.itemId,
        nozzleId: item.type === 'Fuel' ? (item.nozzleId || item.pumpId) : undefined,
        name: item.name,
        code: (item as any)?.code,
        type: item.type,
        previousQty,
        newQty: nextQty,
        qtySold,
      });

      return {
        itemId: item.itemId,
        pumpId: item.pumpId || item.nozzleId,
        nozzleId: item.nozzleId || item.pumpId,
        name: item.name,
        type: item.type,
        qty: Number(item.qty),
        unitPrice: Number(item.unitPrice),
        totalPrice: itemTotal,
        taxAmount: tax,
        taxCode: taxCode as any,
      };
    });

    const invoiceNum = generateInvoiceNumber();
    const receiptNum = generateReceiptNumber();

    const newTx: Transaction = {
      id: 'tx-' + Date.now(),
      receiptNo: receiptNum,
      taxInvoiceNo: invoiceNum,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${invoiceNum}|${computedTotals.totalAmount.toFixed(2)}`)}`,
      timestamp: new Date().toISOString(),
      shiftId,
      staffId: actingUser.id,
      staffName: actingUser.name,
      type: type || 'Fuel',
      items: finalItems.map((item) => ({
        ...item,
        totalPrice: Number(item.qty) * Number(item.unitPrice),
        taxAmount: computedTotals.items.find((line) => line.taxCode === item.taxCode && line.quantity === Number(item.qty) && Math.abs(line.unitPrice - Number(item.unitPrice)) < 0.0001)?.taxAmount ?? 0,
        taxableAmount: computedTotals.items.find((line) => line.taxCode === item.taxCode && line.quantity === Number(item.qty) && Math.abs(line.unitPrice - Number(item.unitPrice)) < 0.0001)?.netAmount ?? 0,
      })),
      subtotal: computedTotals.subtotal,
      taxAmount: computedTotals.taxAmount,
      totalAmount: computedTotals.totalAmount,
      paymentMethod,
      paymentRef: paymentRef || (paymentMethod === 'M-Pesa' ? `MP${Math.random().toString(36).substring(2, 9).toUpperCase()}` : undefined),
      customerName: matchedCustomer ? matchedCustomer.name : (customerName || 'Walk-in Customer'),
      vehiclePlate,
      customerPin: matchedCustomer ? matchedCustomer.kraPin : customerPin,
      status: 'Completed',
      documentType: requestedDocumentType,
    } as Transaction;

    transactions.unshift(newTx);

    const documentReference = requestedDocumentType === 'Invoice' ? newTx.taxInvoiceNo : newTx.receiptNo;
    for (const movement of saleMovementEntries) {
      if (!movement.qtySold || movement.qtySold <= 0) continue;

      const previousQty = Number(movement.previousQty ?? 0);
      const nextQty = Number(movement.newQty ?? 0);
      const stockDifference = nextQty - previousQty;

      if (Number.isNaN(stockDifference) || stockDifference >= 0) {
        continue;
      }

      createStockAdjustmentRecord({
        type: movement.type,
        itemId: movement.itemId,
        itemName: movement.name,
        itemCode: movement.code,
        previousQty,
        newQty: nextQty,
        reason: 'Item Sold',
        userId: actingUser.id,
        userName: actingUser.name,
        userRole: 'Fuel Attendant',
        source: 'Sales Transaction',
        referenceNumber: documentReference,
        originalDocumentNumber: documentReference,
        movementType: 'SALE',
        notes: `Stock reduced during sale ${documentReference}. Quantity sold: ${movement.qtySold}.`,
      });
    }

    try {
      const fuelSaleItem = items.find((item: any) => item.type === 'Fuel');
      const selectedPumpId = fuelSaleItem?.pumpId ?? null;
      const selectedNozzleId = fuelSaleItem?.nozzleId ?? fuelSaleItem?.pumpId ?? null;
      const validPumpId = selectedNozzleId && pumps.some((pump) => pump.id === selectedNozzleId) ? selectedNozzleId : null;
      const fuelProductId = finalItems.find((item) => item.type === 'Fuel')?.itemId ?? null;
      const validProductId = fuelProductId && products.some((product) => product.id === fuelProductId) ? fuelProductId : null;
      const validAttendantId = actingUser.id;
      const validShiftId = shifts.some((shift) => shift.id === shiftId) ? shiftId : null;
      const validCustomerId = matchedCustomer && customers.some((customer) => customer.id === matchedCustomer.id) ? matchedCustomer.id : null;

      const txRecord = {
        id: newTx.id,
        date: new Date(newTx.timestamp).toISOString().slice(0, 10),
        time: new Date(newTx.timestamp).toISOString().slice(11, 19),
        pumpId: validPumpId,
        nozzleId: validPumpId,
        itemsJson: JSON.stringify(newTx.items),
        productId: validProductId,
        quantity: finalItems.reduce((sum, item) => sum + Number(item.qty || 0), 0),
        unitPrice: finalItems.reduce((sum, item) => sum + Number(item.unitPrice || 0), 0) / Math.max(finalItems.length, 1),
        subtotal: Number(newTx.subtotal ?? 0),
        tax: Number(newTx.taxAmount ?? 0),
        totalAmount: Number(newTx.totalAmount ?? 0),
        paymentMethod: newTx.paymentMethod,
        attendantId: validAttendantId,
        attendantName: validAttendantId ? staffName : null,
        meterReadingBefore: null,
        meterReadingAfter: null,
        receiptNumber: newTx.receiptNo,
        invoiceNumber: newTx.taxInvoiceNo,
        documentType: requestedDocumentType,
        customerName: newTx.customerName || customerName || 'Walk-in Customer',
        customerPin: newTx.customerPin || customerPin || null,
        vehiclePlate: newTx.vehiclePlate || vehiclePlate || null,
        status: newTx.status,
        shiftId: validShiftId,
        settlementShiftId: validShiftId,
        settledAt: newTx.timestamp,
        customerId: validCustomerId,
        notes: matchedCustomer ? `Credit sale for ${matchedCustomer.name}` : customerName ? `Sale for ${customerName}` : null,
      };

      const sqlite = getSqlite();
      const persistSale = sqlite.transaction(() => {
        db.transactionQueries.create(txRecord as any);
        db.cashFlowQueries.create({
          id: 'cf-' + Date.now(),
          date: new Date(newTx.timestamp).toISOString().slice(0, 10),
          type: 'Inflow',
          category: type === 'Shop' ? 'Shop Sales' : 'Fuel Sales',
          description: `${type || 'Fuel'} Sale ${newTx.receiptNo} - ${newTx.customerName}${vehiclePlate ? ` (${vehiclePlate})` : ''}`,
          amount: Number(totalAmount || 0),
          accountingMethod: paymentMethod,
          referenceNo: newTx.taxInvoiceNo || newTx.receiptNo,
          relatedTransactionId: newTx.id,
          relatedDeliveryId: null,
          relatedPaymentId: null,
          recordedBy: actingUser.id,
          recordedByName: actingUser.name,
          approvedBy: null,
          approvedByName: null,
          notes: paymentMethod === 'Credit' ? `Credit sale to ${newTx.customerName}` : null,
          status: 'Recorded',
        } as any);

        for (const movement of saleMovementEntries) {
          if (movement.type === 'Shop') {
            const shopItem = shopItems.find((item) => item.id === movement.itemId);
            if (shopItem) {
              db.shopItemQueries.update(shopItem.id, { stockQty: shopItem.stockQty } as any);
            }
            continue;
          }

          const pump = pumps.find((item) => item.id === movement.nozzleId);
          const tank = tanks.find((item) => item.id === pump?.tankId);
          if (pump && !pts2NozzleIds().has(pump.id)) {
            db.pumpQueries.update(pump.id, { currentMeterReading: pump.currentMeterReading } as any);
            db.nozzleReadingQueries.create({
              id: `nr-${newTx.id}-${pump.id}`,
              nozzleId: pump.id,
              pumpId: pump.physicalPumpId || null,
              tankId: pump.tankId,
              fuelProductId: pump.fuelProductId,
              shiftId: validShiftId,
              transactionId: newTx.id,
              previousReading: Number(pump.currentMeterReading) - Number(movement.qtySold),
              quantityDispensed: Number(movement.qtySold),
              currentReading: Number(pump.currentMeterReading),
              readingType: 'Sale',
              recordedBy: validAttendantId,
              timestamp: newTx.timestamp,
            } as any);
          }
          if (tank) {
            db.tankQueries.update(tank.id, {
              currentLevelLiters: tank.currentLevelLiters,
              lastDipReading: tank.lastDipReading,
              lastDipTime: tank.lastDipTime,
            } as any);
          }
        }
      });

      persistSale();
    } catch (error) {
      console.error('Error saving transaction to database:', error);
      throw error;
    }

    if (paymentMethod === 'Credit' && matchedCustomer && requestedDocumentType === 'Invoice') {
      matchedCustomer.currentBalance += totalAmount;
      try {
        db.customerQueries.update(matchedCustomer.id, {
          businessName: matchedCustomer.name,
          contactPerson: matchedCustomer.name,
          email: matchedCustomer.email ?? null,
          phone: matchedCustomer.phone || '',
          address: matchedCustomer.address ?? null,
          accountType: 'Corporate',
          creditLimit: Number(matchedCustomer.creditLimit ?? 0),
          currentDebt: Number(matchedCustomer.currentBalance ?? 0),
          status: matchedCustomer.status || 'Active',
          taxId: matchedCustomer.kraPin ?? null,
        } as any);
      } catch (error) {
        console.error('Error syncing customer credit balance to database:', error);
      }
    }

    const completedSaleCashFlow: CashFlowRecord = {
      id: 'cf-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'Inflow',
      category: type === 'Shop' ? 'Shop Sales' : 'Fuel Sales',
      amount: totalAmount,
      paymentMethod,
      referenceNo: newTx.taxInvoiceNo || newTx.receiptNo,
      description: `${type || 'Fuel'} Sale ${newTx.receiptNo} - ${newTx.customerName}${vehiclePlate ? ` (${vehiclePlate})` : ''}`,
      recordedBy: staffName || 'Attendant',
    };
    cashFlow.unshift(completedSaleCashFlow);

    const hydratedShifts = rebuildShiftSummaries(shifts, transactions);
    const matchIndex = hydratedShifts.findIndex((item) => item.id === shift.id);
    if (matchIndex >= 0) {
      const hydratedShift = hydratedShifts[matchIndex];
      shift.totalFuelSales = hydratedShift.totalFuelSales;
      shift.totalShopSales = hydratedShift.totalShopSales;
      shift.totalExpectedCash = hydratedShift.totalExpectedCash;
      shifts[matchIndex] = hydratedShift;
    }

    addAuditLog(
      actingUser.id,
      actingUser.name,
      actingUser.role,
      'SALE_COMPLETED',
      'Sales',
      `Processed sale ${newTx.receiptNo} (Invoice: ${newTx.taxInvoiceNo}) for KES ${totalAmount.toFixed(2)} via ${paymentMethod}`
    );

    await refreshTransactionMeters(items.filter((item:any)=>item.type==='Fuel').map((item:any)=>String(item.nozzleId||item.pumpId)));
    res.json(newTx);
  });

  // Shifts
  app.get('/api/shifts', (req, res) => {
    res.json(hydrateShiftSummaries().sort((a,b)=>{
      const bTime=Date.parse(b.endTime||b.startTime||'')||0;const aTime=Date.parse(a.endTime||a.startTime||'')||0;
      return bTime-aTime||String(b.id).localeCompare(String(a.id));
    }));
  });

  const reconcileShiftRosterStatuses = () => {
    const sqlite = getSqlite();
    const now = new Date();
    const assignments = sqlite.prepare(`SELECT assignment.*, plan.scheduled_start, plan.scheduled_end,
      shift_session.id AS attendance_shift_id, shift_session.status AS attendance_shift_status, shift_session.end_time AS attendance_shift_end_time
      FROM shift_assignments assignment
      JOIN shift_plans plan ON plan.id = assignment.shift_plan_id
      LEFT JOIN shifts shift_session ON shift_session.id = assignment.clock_in_shift_id`).all() as any[];
    const updateStatus = sqlite.prepare(`UPDATE shift_assignments
      SET status = ?, expired_at = ?, missed_reason = ? WHERE id = ?`);

    sqlite.transaction(() => {
      for (const assignment of assignments) {
        if (assignment.status === 'Removed From Assignment' || assignment.status === 'Cancelled') continue;
        const scheduledStart = new Date(assignment.scheduled_start);
        const scheduledEnd = new Date(assignment.scheduled_end);
        if (!Number.isFinite(scheduledStart.getTime()) || !Number.isFinite(scheduledEnd.getTime())) continue;

        const hasValidClockIn = Boolean(assignment.attendance_shift_id && assignment.clock_in_time);
        const hasValidClockOut = Boolean(hasValidClockIn && assignment.clock_out_time && assignment.attendance_shift_end_time);
        const nextStatus = hasValidClockOut
          ? 'Completed'
          : hasValidClockIn
            ? 'In Progress'
            : now > scheduledEnd
              ? 'Stale'
              : now >= scheduledStart
                ? 'Due'
                : 'Upcoming';
        const expiredAt = nextStatus === 'Stale' ? (assignment.expired_at || now.toISOString()) : null;
        const missedReason = nextStatus === 'Stale' ? 'No Clock-In' : null;
        if (assignment.status !== nextStatus || assignment.expired_at !== expiredAt || assignment.missed_reason !== missedReason) {
          updateStatus.run(nextStatus, expiredAt, missedReason, assignment.id);
        }
      }
    })();
  };

  const getShiftPlans = () => {
    const sqlite = getSqlite();
    reconcileShiftRosterStatuses();
    const plans = sqlite.prepare('SELECT * FROM shift_plans ORDER BY scheduled_start DESC').all() as any[];
    const assignments = sqlite.prepare(`
      SELECT assignment.*, user.name AS user_name, user.role AS user_role
      FROM shift_assignments assignment
      JOIN users user ON user.id = assignment.user_id
      ORDER BY assignment.assigned_at ASC
    `).all() as any[];

    return plans.map((plan) => ({
      id: plan.id,
      recurrenceId: plan.recurrence_id,
      name: plan.name,
      shiftType: plan.shift_type,
      scheduledStart: plan.scheduled_start,
      scheduledEnd: plan.scheduled_end,
      status: plan.status,
      createdBy: plan.created_by,
      createdAt: plan.created_at,
      assignments: assignments.filter((assignment) => assignment.shift_plan_id === plan.id).map((assignment) => ({
        id: assignment.id,
        shiftPlanId: assignment.shift_plan_id,
        userId: assignment.user_id,
        userName: assignment.user_name,
        userRole: assignment.user_role,
        status: assignment.status,
        assignedAt: assignment.assigned_at,
        assignedBy: assignment.assigned_by,
        removedAt: assignment.removed_at,
        removedBy: assignment.removed_by,
        clockInShiftId: assignment.clock_in_shift_id,
        clockInTime: assignment.clock_in_time,
        clockOutTime: assignment.clock_out_time,
        expiredAt: assignment.expired_at,
        missedReason: assignment.missed_reason,
      })),
    }));
  };

  const shiftManagementRoleCheck = (req: any, res: any, permission: Permission, action: string) => Boolean(requirePermission(req, res, permission, action));

  app.get('/api/shift-plans', (req, res) => {
    if (!(req as any).authUser) return res.status(401).json({ message: 'Authentication is required to view shift rosters.' });
    const actor = (req as any).authUser as User;
    const plans = getShiftPlans();
    if (hasPermission(actor, 'VIEW_SHIFT_USERS')) return res.json(plans);
    // Staff can only receive their own roster assignments; never leak co-workers.
    res.json(plans
      .map((plan) => ({ ...plan, assignments: plan.assignments.filter((assignment) => assignment.userId === actor.id) }))
      .filter((plan) => plan.assignments.length > 0));
  });

  app.post('/api/shift-plans', (req: any, res) => {
    if (shiftManagementRoleCheck(req, res, 'CREATE_SHIFT', 'create shifts')) return;
    const { name, shiftType, scheduledStart, scheduledEnd, userIds, scheduleType = 'one-time', recurrenceStartDate, recurrenceEndDate, recurrenceWeekdays, startTime, endTime } = req.body || {};
    const assignedUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean))];
    const isRecurring = scheduleType === 'recurring';
    if (!String(name || '').trim() || !String(shiftType || '').trim() || (!isRecurring && (!scheduledStart || !scheduledEnd))) {
      return res.status(400).json({ message: 'Shift name, type, scheduled start, and scheduled end are required.' });
    }
    if (!isRecurring && Date.parse(scheduledEnd) <= Date.parse(scheduledStart)) return res.status(400).json({ message: 'Scheduled end must be after scheduled start.' });
    const selectedWeekdays = [...new Set((Array.isArray(recurrenceWeekdays) ? recurrenceWeekdays : []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
    if (isRecurring && (!/^\d{4}-\d{2}-\d{2}$/.test(String(recurrenceStartDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(recurrenceEndDate || '')) || !/^\d{2}:\d{2}$/.test(String(startTime || '')) || !/^\d{2}:\d{2}$/.test(String(endTime || '')) || !selectedWeekdays.length)) {
      return res.status(400).json({ message: 'Recurring rosters require a valid start date, end date, times, and at least one weekday.' });
    }
    if (isRecurring && String(recurrenceEndDate) < String(recurrenceStartDate)) return res.status(400).json({ message: 'Recurrence end date must not be before its start date.' });
    const assignedUsers = users.filter((user) => assignedUserIds.includes(user.id) && user.active);
    if (assignedUsers.length !== assignedUserIds.length) {
      return res.status(400).json({ message: 'One or more selected users are unavailable.' });
    }

    const now = new Date().toISOString();
    const recurrenceId = isRecurring ? `shift-recurrence-${randomUUID()}` : null;
    const planId = `shift-plan-${randomUUID()}`;
    const occurrences = isRecurring ? (() => {
      const records: Array<{ start: string; end: string }> = [];
      for (let date = new Date(`${recurrenceStartDate}T12:00:00`); date <= new Date(`${recurrenceEndDate}T12:00:00`); date.setDate(date.getDate() + 1)) {
        if (!selectedWeekdays.includes(date.getDay())) continue;
        const occurrenceDate = date.toISOString().slice(0, 10);
        const start = new Date(`${occurrenceDate}T${startTime}:00`);
        const end = new Date(`${occurrenceDate}T${endTime}:00`);
        if (end <= start) end.setDate(end.getDate() + 1);
        records.push({ start: start.toISOString(), end: end.toISOString() });
      }
      return records;
    })() : [{ start: scheduledStart, end: scheduledEnd }];
    if (!occurrences.length) return res.status(400).json({ message: 'No occurrences fall within the selected recurrence period.' });
    try {
      getSqlite().transaction(() => {
        if (recurrenceId) {
          getSqlite().prepare(`INSERT INTO shift_recurrences (id, name, shift_type, start_date, end_date, start_time, end_time, weekdays_json, status, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)`)
            .run(recurrenceId, String(name).trim(), String(shiftType).trim(), recurrenceStartDate, recurrenceEndDate, startTime, endTime, JSON.stringify(selectedWeekdays), req.authUser.id, now, now);
        }
        const insertPlan = getSqlite().prepare(`INSERT INTO shift_plans (id, recurrence_id, name, shift_type, scheduled_start, scheduled_end, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?)`);
        const insertAssignment = getSqlite().prepare(`INSERT INTO shift_assignments (id, shift_plan_id, user_id, status, assigned_at, assigned_by)
          VALUES (?, ?, ?, 'Assigned', ?, ?)`);
        occurrences.forEach((occurrence, index) => {
          const occurrencePlanId = index === 0 ? planId : `shift-plan-${randomUUID()}`;
          insertPlan.run(occurrencePlanId, recurrenceId, String(name).trim(), String(shiftType).trim(), occurrence.start, occurrence.end, req.authUser.id, now, now);
          assignedUsers.forEach((user) => insertAssignment.run(`shift-assignment-${randomUUID()}`, occurrencePlanId, user.id, now, req.authUser.id));
        });
      })();
    } catch (error) {
      console.error('Error creating shift plan:', error);
      return res.status(500).json({ message: 'Shift could not be created.' });
    }

    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'SHIFT_CREATED', 'Shifts', `Created ${isRecurring ? 'recurring ' : ''}${name} (${shiftType}) with ${occurrences.length} occurrence(s); assigned ${assignedUsers.map((user) => user.name).join(', ') || 'no users'}.`);
    res.status(201).json(getShiftPlans().find((plan) => plan.id === planId));
  });

  app.post('/api/shift-plans/:id/assignments', (req: any, res) => {
    if (shiftManagementRoleCheck(req, res, 'ASSIGN_SHIFT_USERS', 'assign shift users')) return;
    const plan = getSqlite().prepare('SELECT id FROM shift_plans WHERE id = ?').get(req.params.id) as any;
    const user = users.find((candidate) => candidate.id === String(req.body?.userId || '') && candidate.active);
    if (!plan) return res.status(404).json({ message: 'Shift not found.' });
    if (!user) return res.status(404).json({ message: 'Active user not found.' });

    try {
      getSqlite().prepare(`INSERT INTO shift_assignments (id, shift_plan_id, user_id, status, assigned_at, assigned_by)
        VALUES (?, ?, ?, 'Assigned', ?, ?)`)
        .run(`shift-assignment-${randomUUID()}`, plan.id, user.id, new Date().toISOString(), req.authUser.id);
    } catch (error: any) {
      if (String(error?.message || '').includes('UNIQUE')) return res.status(409).json({ message: 'User is already assigned to this shift.' });
      console.error('Error assigning shift user:', error);
      return res.status(500).json({ message: 'User could not be assigned.' });
    }

    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'SHIFT_USER_ASSIGNED', 'Shifts', `Assigned ${user.name} to shift ${req.params.id}.`);
    res.status(201).json(getShiftPlans().find((candidate) => candidate.id === req.params.id));
  });

  app.delete('/api/shift-plans/:id/assignments/:userId', (req: any, res) => {
    if (shiftManagementRoleCheck(req, res, 'REMOVE_SHIFT_USERS', 'remove shift users')) return;
    const assignment = getSqlite().prepare('SELECT * FROM shift_assignments WHERE shift_plan_id = ? AND user_id = ?').get(req.params.id, req.params.userId) as any;
    if (!assignment) return res.status(404).json({ message: 'Shift assignment not found.' });
    if (assignment.status === 'Removed From Assignment') return res.status(409).json({ message: 'User has already been removed from this shift.' });
    const hasParticipation = Boolean(assignment.clock_in_shift_id || assignment.clock_in_time || assignment.clock_out_time);
    const now = new Date().toISOString();
    getSqlite().prepare(`UPDATE shift_assignments
      SET status = 'Removed From Assignment', removed_at = ?, removed_by = ?
      WHERE id = ?`).run(now, req.authUser.id, assignment.id);
    const target = users.find((user) => user.id === assignment.user_id);
    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'SHIFT_USER_REMOVED', 'Shifts', `${hasParticipation ? 'Safely removed roster access for' : 'Removed'} ${target?.name || assignment.user_id} from shift ${req.params.id}.`);
    res.json(getShiftPlans().find((candidate) => candidate.id === req.params.id));
  });

  app.get('/api/schedules', (req, res) => {
    if (!(req as any).authUser) return res.status(401).json({ message: 'Authentication is required to view shift rosters.' });
    const actor = (req as any).authUser as User;
    const canViewAll = hasPermission(actor, 'VIEW_SHIFT_USERS');
    const projectedSchedules = getShiftPlans().flatMap((plan) => plan.assignments
      .filter((assignment) => assignment.status !== 'Removed From Assignment')
      .filter((assignment) => canViewAll || assignment.userId === actor.id)
      .map((assignment) => {
        const lifecycleStatus = assignment.status;
        return {
          id: assignment.id,
          assignmentId: assignment.id,
          shiftPlanId: plan.id,
          recurrenceId: plan.recurrenceId,
          staffId: assignment.userId,
          staffName: assignment.userName,
          role: assignment.userRole,
          shiftType: plan.shiftType,
          shiftName: plan.name,
          date: plan.scheduledStart.slice(0, 10),
          startTime: plan.scheduledStart,
          endTime: plan.scheduledEnd,
          actualClockIn: assignment.clockInTime,
          actualClockOut: assignment.clockOutTime,
          expiredAt: assignment.expiredAt,
          missedReason: assignment.missedReason,
          status: lifecycleStatus,
        };
      })
    );
    res.json(projectedSchedules);
  });

  app.post('/api/schedules', (_req, res) => {
    res.status(410).json({ message: 'Legacy schedules are retired. Create a roster shift through /api/shift-plans.' });
  });

  app.delete('/api/schedules/:id', (_req, res) => {
    res.status(410).json({ message: 'Legacy schedules are read-only. Manage roster assignments through /api/shift-plans.' });
  });

  // Clock-in
  app.post('/api/shifts/clock-in', async (req: any, res) => {
    const { userId, pin, shiftType, openingCash, openingPumpReadings, openingTankDips, shiftPlanId } = req.body;
    const user = users.find((u) => u.id === userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!verifyStoredPin(user.pin, pin).valid) return res.status(401).json({ message: 'Invalid user or PIN.' });
    if (req.authUser?.id !== user.id && !hasPermission(req.authUser, 'CLOCK_IN_OTHER_USERS')) {
      return res.status(403).json({ message: 'You may only clock into your own shift.' });
    }
    if (!shiftPlanId) return res.status(400).json({ message: 'A roster shift must be selected before clock-in.' });
    reconcileShiftRosterStatuses();
    const assignment = getSqlite().prepare(`SELECT id, status, clock_in_time FROM shift_assignments
      WHERE shift_plan_id = ? AND user_id = ?`).get(shiftPlanId, user.id) as any;
    if (!assignment) return res.status(403).json({ message: 'You are not assigned to this shift.' });
    if (assignment.status === 'Stale') return res.status(409).json({ message: 'Clock-in denied because the assigned shift has expired.' });
    if (assignment.status !== 'Due') return res.status(403).json({ message: 'You are not assigned to this shift.' });
    const roster = getSqlite().prepare('SELECT shift_type, scheduled_start, scheduled_end FROM shift_plans WHERE id = ?').get(shiftPlanId) as any;
    if (!roster) return res.status(404).json({ message: 'Roster shift not found.' });
    const now = Date.now();
    if (assignment.clock_in_time) return res.status(409).json({ message: 'This assigned roster has already been activated.' });
    if (now < Date.parse(roster.scheduled_start)) return res.status(409).json({ message: 'This assigned roster is not yet available for clock-in.' });
    if (now > Date.parse(roster.scheduled_end)) {
      reconcileShiftRosterStatuses();
      return res.status(409).json({ message: 'Clock-in denied because the assigned shift has expired.' });
    }

    const existingActive = shifts.find((s) => s.staffId === user.id && s.status === 'Active');
    if (existingActive) {
      return res.json(existingActive);
    }

    let freshOpeningMeters:Map<string,number>;
    try{
      pumps=(db.pumpQueries.all() as PumpNozzle[])??[];
      freshOpeningMeters=await adapterManager.captureNozzleMeters(pumps.filter(pump=>pump.status==='Active').map(pump=>pump.id));
      pumps=(db.pumpQueries.all() as PumpNozzle[])??[];
    }catch(error){return res.status(503).json({code:'SHIFT_METER_REFRESH_FAILED',message:'Unable to read opening nozzle meters. '+(error instanceof Error?error.message:String(error))});}
    // Another request may have completed clock-in while controller I/O was pending.
    const alreadyOpened=db.shiftQueries.active().find((item:any)=>item.staffId===user.id);
    if(alreadyOpened)return res.json(alreadyOpened);
    const currentAssignment=getSqlite().prepare('SELECT status FROM shift_assignments WHERE shift_plan_id=? AND user_id=?').get(shiftPlanId,user.id) as any;
    if(currentAssignment?.status!=='Due'||Date.now()>Date.parse(roster.scheduled_end))return res.status(409).json({message:'This roster is no longer available for clock-in.'});
    const openingCapturedAt=new Date().toISOString();
    transactions=(db.transactionQueries.all() as any[]).map(normalizeStoredTransaction);
    const systemOpeningMeters=new Map(pumps.map(pump=>[pump.id,Number(pump.currentMeterReading)]));
    for(const [id,value] of freshOpeningMeters)systemOpeningMeters.set(id,value);
    let formattedOpeningPumps:ReturnType<typeof buildOpeningNozzleReadings>;
    try{formattedOpeningPumps=buildOpeningNozzleReadings(pumps.filter(pump=>pump.status==='Active'),openingPumpReadings||[],systemOpeningMeters,previousNozzleClosings(getSqlite()),transactions,openingCapturedAt);}
    catch(error){return res.status(400).json({message:error instanceof Error?error.message:String(error)});}
    formattedOpeningPumps=formattedOpeningPumps.map(reading=>{
      const state=getSqlite().prepare("SELECT current_reading_id,controller_id,last_source_occurred_at FROM automation_meter_current_state WHERE nozzle_id=? ORDER BY last_received_at DESC LIMIT 1").get(reading.pumpId) as any;
      return {...reading,meterReadingId:state?.current_reading_id,meterControllerId:state?.controller_id,meterSourceOccurredAt:state?.last_source_occurred_at};
    });
    const openingApprovals:ManagerApproval[]=[];

    const formattedOpeningTanks = (openingTankDips || []).map((td: any) => {
      const t = tanks.find((tnk) => tnk.id === td.tankId);
      const authoritativeQuantity = Number(t?.currentLevelLiters ?? 0);
      const reportedOpeningDip = td.openingDip !== undefined ? Number(td.openingDip) : authoritativeQuantity;
      return {
        tankId: td.tankId,
        tankName: td.tankName || t?.tankName || 'Fuel Tank',
        fuelName: td.fuelName || t?.fuelName || 'Fuel',
        openingDip: reportedOpeningDip,
        authoritativeQuantity,
        reportedOpeningDip,
        variance: reportedOpeningDip - authoritativeQuantity,
      };
    });

    const newShift: ShiftSession = {
      id: 'shift-' + Date.now(),
      staffId: user.id,
      staffName: user.name,
      staffRole: user.role as any,
      shiftType: roster.shift_type,
      startTime: openingCapturedAt,
      status: 'Active',
      openingCash: Number(openingCash || 0),
      openingPumpReadings: formattedOpeningPumps,
      openingTankDips: formattedOpeningTanks,
      totalFuelSales: 0,
      totalShopSales: 0,
      totalExpectedCash: Number(openingCash || 0),
      isLate: false,
    } as ShiftSession;

    try {
      const sqlite = getSqlite();
      const persistShift = sqlite.transaction(() => {
        db.shiftQueries.create({
          id: newShift.id,
          staffId: user.id,
          staffName: user.name,
          staffRole: user.role,
          shiftType: newShift.shiftType,
          date: new Date(newShift.startTime).toISOString().slice(0, 10),
          startTime: newShift.startTime,
          endTime: null,
          status: 'Active',
          openingCash: Number(openingCash || 0),
          closingCash: null,
          openingPumpReadingsJson: JSON.stringify(formattedOpeningPumps),
          openingTankDipsJson: JSON.stringify(formattedOpeningTanks),
        } as any);

        formattedOpeningPumps.forEach(reading=>{
          const nozzle=pumps.find(pump=>pump.id===reading.pumpId);
          if(!nozzle)return;
          db.nozzleReadingQueries.create({
            id:`reading-${newShift.id}-${nozzle.id}-open`,nozzleId:nozzle.id,pumpId:nozzle.physicalPumpId??null,
            tankId:nozzle.tankId,fuelProductId:nozzle.fuelProductId,shiftId:newShift.id,transactionId:null,
            previousReading:reading.openingMeter,quantityDispensed:0,currentReading:reading.openingMeter,
            readingType:'Opening',recordedBy:user.id,timestamp:newShift.startTime,
          } as any);
        });

        const insertVariance = getSqlite().prepare(`INSERT INTO reading_variances
          (id, shift_id, reading_type, tank_id, nozzle_id, reported_value, authoritative_value, variance, status, recorded_by, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Review Required', ?, ?)`);
        for(const reading of formattedOpeningPumps){
          const nozzle=pumps.find(pump=>pump.id===reading.pumpId);if(!nozzle)continue;
          const common={shiftId:newShift.id,userId:user.id,userName:user.name,nozzle,at:newShift.startTime};
          for(const review of [
            recordMeterReview(sqlite,{...common,stage:'Opening',reported:reading.reportedOpeningMeter,authoritative:reading.authoritativeOpeningMeter}),
            recordMeterReview(sqlite,{...common,stage:'Unattended',reported:reading.previousShiftId?reading.unattendedMeterLiters:undefined,authoritative:reading.unattendedSalesLiters}),
          ])if(review)openingApprovals.push(review);
          for(const transactionId of reading.unattendedTransactionIds){
            const claim=sqlite.prepare('UPDATE transactions SET meter_reconciliation_shift_id=? WHERE id=? AND dispensed_without_shift=1 AND meter_reconciliation_shift_id IS NULL').run(newShift.id,transactionId);
            if(claim.changes!==1)throw new Error('Unattended transaction already belongs to another reconciliation. Retry clock-in.');
            addAuditLog(user.id,user.name,user.role,'PTS2_TRANSACTION_ASSOCIATED_WITH_SHIFT','Shifts',JSON.stringify({transactionId,shiftId:newShift.id,nozzleId:reading.pumpId}));
          }
        }
        formattedOpeningTanks.filter((reading) => Math.abs(Number(reading.variance || 0)) > 0.000001).forEach((reading) => {
          insertVariance.run(`variance-${randomUUID()}`, newShift.id, 'Tank Dip', reading.tankId, null, reading.reportedOpeningDip, reading.authoritativeQuantity, reading.variance, user.id, newShift.startTime);
        });

        db.userQueries.update(user.id, { currentShiftId: newShift.id } as any);
        getSqlite().prepare(`UPDATE shift_assignments
          SET clock_in_shift_id = ?, clock_in_time = ?, status = 'In Progress', expired_at = NULL, missed_reason = NULL
          WHERE shift_plan_id = ? AND user_id = ? AND status = 'Due'`)
          .run(newShift.id, newShift.startTime, shiftPlanId, user.id);
        getSqlite().prepare(`UPDATE shift_plans SET status = 'Active', updated_at = ? WHERE id = ? AND status = 'Scheduled'`)
          .run(newShift.startTime, shiftPlanId);
      });

      persistShift();
      if(openingApprovals.length){
        const issues=openingApprovals.map((item,index)=>(index+1)+'. '+item.reason).join('\n');
        const bundled:any={
          id:"app-"+randomUUID(),
          timestamp:newShift.startTime,
          shiftId:newShift.id,
          type:"Shift Variance Review",
          reviewScope:"READING",
          requestedBy:user.name,
          reason:"Opening / unattended reading issues\n"+issues,
          amountOrQty:openingApprovals.length+" issue(s)",
          status:"Pending"
        };
        getSqlite().prepare("DELETE FROM manager_approvals WHERE shift_id=? AND review_scope='READING'").run(newShift.id);
        getSqlite().prepare("INSERT INTO manager_approvals(id,timestamp,shift_id,type,requested_by,reason,amount_or_qty,status,review_scope) VALUES(?,?,?,?,?,?,?,'Pending','READING')").run(bundled.id,bundled.timestamp,bundled.shiftId,bundled.type,bundled.requestedBy,bundled.reason,bundled.amountOrQty);
        openingApprovals.splice(0,openingApprovals.length,bundled);
      }
    } catch (error) {
      const existingPersistedShift = db.shiftQueries.active().find((shift: any) => shift.staffId === user.id);
      if (existingPersistedShift) {
        user.currentShiftId = existingPersistedShift.id;
        return res.json(existingPersistedShift);
      }

      console.error('Error saving active shift to database:', error);
      return res.status(500).json({ message: 'Unable to open the shift. Please try again.' });
    }

    approvals.unshift(...openingApprovals);
    shifts.unshift(newShift);
    user.currentShiftId = newShift.id;
    const activeUser=users.find(item=>item.id===user.id);if(activeUser)activeUser.currentShiftId=newShift.id;

    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'SHIFT_CLOCK_IN', 'Shifts', `${user.name} clocked in for ${shiftType} shift with KES ${openingCash} float. Recorded opening meters (${formattedOpeningPumps.length} pumps) & tank dips (${formattedOpeningTanks.length} tanks).`);
    formattedOpeningPumps.forEach((reading) => {
      addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'METER_READING_RECORDED', 'Shifts', `Shift ${newShift.id}, nozzle ${reading.pumpId}: reported ${reading.reportedOpeningMeter}, authoritative ${reading.authoritativeOpeningMeter}, variance ${reading.variance}.`);
      if (Math.abs(Number(reading.variance || 0)) > 0.000001) addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'METER_VARIANCE_DETECTED', 'Shifts', `Shift ${newShift.id}, nozzle ${reading.pumpId}: variance ${reading.variance}.`, 'Warning');
    });
    formattedOpeningTanks.forEach((reading) => {
      addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'DIP_READING_RECORDED', 'Shifts', `Shift ${newShift.id}, tank ${reading.tankId}: reported ${reading.reportedOpeningDip}, authoritative ${reading.authoritativeQuantity}, variance ${reading.variance}.`);
      if (Math.abs(Number(reading.variance || 0)) > 0.000001) addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'DIP_VARIANCE_DETECTED', 'Shifts', `Shift ${newShift.id}, tank ${reading.tankId}: variance ${reading.variance}.`, 'Warning');
    });

    res.json(newShift);
  });

  app.get('/api/reading-variances', (req: any, res) => {
    const roleCheck = requirePermission(req, res, 'VIEW_DIP_VARIANCE', 'view reading variances');
    if (roleCheck) return roleCheck;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 15)));
    const total = Number((getSqlite().prepare('SELECT COUNT(*) AS count FROM reading_variances').get() as any).count || 0);
    const records = getSqlite().prepare('SELECT * FROM reading_variances ORDER BY recorded_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize);
    res.json({ records, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  });

  app.post('/api/reading-variances/:id/review', (req: any, res) => {
    const roleCheck = requirePermission(req, res, 'REVIEW_DIP_VARIANCE', 'review a reading variance');
    if (roleCheck) return roleCheck;
    const variance = getSqlite().prepare('SELECT * FROM reading_variances WHERE id = ?').get(req.params.id) as any;
    if (!variance) return res.status(404).json({ message: 'Reading variance not found.' });
    if (variance.status === 'Resolved') return res.status(409).json({ message: 'Resolved variances cannot be reviewed again.' });
    const reviewedAt = new Date().toISOString();
    getSqlite().prepare(`UPDATE reading_variances SET status = 'Reviewed', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
      .run(req.authUser.id, reviewedAt, variance.id);
    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'DIP_VARIANCE_REVIEWED', 'Shifts', `Reviewed ${variance.reading_type} variance ${variance.id} for shift ${variance.shift_id}; reported ${variance.reported_value}, authoritative ${variance.authoritative_value}, variance ${variance.variance}.`);
    res.json(getSqlite().prepare('SELECT * FROM reading_variances WHERE id = ?').get(variance.id));
  });

  app.post('/api/reading-variances/:id/resolve', (req: any, res) => {
    const roleCheck = requirePermission(req, res, 'RESOLVE_DIP_VARIANCE', 'resolve a reading variance');
    if (roleCheck) return roleCheck;
    const variance = getSqlite().prepare('SELECT * FROM reading_variances WHERE id = ?').get(req.params.id) as any;
    if (!variance) return res.status(404).json({ message: 'Reading variance not found.' });
    if (variance.status === 'Resolved') return res.status(409).json({ message: 'Reading variance is already resolved.' });
    if(getSqlite().prepare("SELECT 1 FROM manager_approvals WHERE reading_variance_id=? AND status<>'Approved'").get(variance.id))return res.status(409).json({message:'Manager approval is required. Resolve the linked item in Manager Approvals.'});
    const resolvedAt = new Date().toISOString();
    const notes = String(req.body?.resolutionNotes || '').trim() || null;
    getSqlite().prepare(`UPDATE reading_variances
      SET status = 'Resolved', resolved_by = ?, resolved_at = ?, resolution_notes = ?
      WHERE id = ?`).run(req.authUser.id, resolvedAt, notes, variance.id);
    addAuditLog(req.authUser.id, req.authUser.name, req.authUser.role, 'DIP_VARIANCE_RESOLVED', 'Shifts', `Resolved ${variance.reading_type} variance ${variance.id} for shift ${variance.shift_id}; no inventory adjustment was made.${notes ? ` Notes: ${notes}` : ''}`);
    res.json(getSqlite().prepare('SELECT * FROM reading_variances WHERE id = ?').get(variance.id));
  });

  // Reconciliations
  app.get('/api/reconciliations', (req: any, res) => {
    const actor = req.authUser as User | undefined;
    if (!actor) return res.status(401).json({ message: 'Authentication is required to view reconciliations.' });
    const canViewAll = hasPermission(actor, 'VIEW_THREE_WAY_LEDGER');
    reconciliations = (db.reconciliationQueries.all() as any[]).map(normalizeStoredReconciliation);
    res.json(canViewAll ? reconciliations : reconciliations.filter((record) => record.staffId === actor.id));
  });

  app.post('/api/reconciliations', async (req, res) => {
    const {
      shiftId,
      staffId,
      staffName,
      cashCount,
      pumpReadings,
      tankDips,
      actorUserId,
      actorRole,
    } = req.body;

    let shift = shifts.find((s) => s.id === shiftId);
    if (!shift) return res.status(404).json({ message: 'Shift not found' });

    const actingUser = (req as any).authUser as User | undefined;
    const isAdminOrManager = actingUser && hasPermission(actingUser, 'MANAGE_THREE_WAY_LEDGER');
    const isOwnShift = actingUser && actingUser.id === shift.staffId;

    if (!actingUser || (!isOwnShift && !isAdminOrManager)) {
      return res.status(403).json({ message: 'Clock-out is restricted to the logged-in user or an admin/manager.' });
    }

    if(shift.status!=='Active')return res.status(409).json({message:'This shift is already closed.'});
    let freshClosingMeters=new Map<string,number>();
    let closingMeterError:string|undefined;
    try{
      freshClosingMeters=await adapterManager.captureNozzleMeters((shift.openingPumpReadings||[]).map(reading=>reading.pumpId));
      pumps=(db.pumpQueries.all() as PumpNozzle[])??[];
    }catch(error){closingMeterError=error instanceof Error?error.message:String(error);}
    pumps=(db.pumpQueries.all() as PumpNozzle[])??[];
    const persistedShift=getSqlite().prepare('SELECT status FROM shifts WHERE id=?').get(shift.id) as any;
    if(persistedShift?.status!=='Active')return res.status(409).json({message:'This shift is already closed.'});
    shift=shifts.find(item=>item.id===shiftId)||shift;
    transactions=(db.transactionQueries.all() as any[]).map(normalizeStoredTransaction);
    const latestSummary=rebuildShiftSummaries([shift],transactions)[0];
    if(latestSummary)Object.assign(shift,latestSummary);

    const notesSum =
      (cashCount.notes1000 || 0) * 1000 +
      (cashCount.notes500 || 0) * 500 +
      (cashCount.notes200 || 0) * 200 +
      (cashCount.notes100 || 0) * 100 +
      (cashCount.notes50 || 0) * 50 +
      (cashCount.coins || 0) +
      (cashCount.mpesaDirect || 0) +
      (cashCount.cardDirect || 0) +
      (cashCount.creditDirect || 0);

    const expectedCash = shift.totalExpectedCash;
    const cashVariance = notesSum - expectedCash;

    let processedPumps:ReturnType<typeof buildClosingNozzleReadings>;
    try{
      const systemClosingMeters=new Map(pumps.map(pump=>[pump.id,Number(pump.currentMeterReading)]));
      const hardware=pts2NozzleIds();
      if(closingMeterError)for(const id of hardware)systemClosingMeters.delete(id);
      for(const [id,value] of freshClosingMeters)systemClosingMeters.set(id,value);
      processedPumps=buildClosingNozzleReadings(shift.openingPumpReadings||[],pumpReadings||[],systemClosingMeters,transactions,shift.id,true).map(reading=>{
        const state=getSqlite().prepare("SELECT current_reading_id FROM automation_meter_current_state WHERE nozzle_id=? ORDER BY last_received_at DESC LIMIT 1").get(reading.pumpId) as any;
        const reset=getSqlite().prepare("SELECT id FROM automation_meter_readings WHERE nozzle_id=? AND source_occurred_at>=? AND anomaly_classification IN('METER_RESET','METER_DECREASE') LIMIT 1").get(reading.pumpId,shift!.startTime);
        const meterIssue=reading.meterIssue||(reset?'METER_SEQUENCE_REVIEW':null);
        return {...reading,meterIssue,meterSalesLiters:meterIssue?null:reading.meterSalesLiters,varianceLiters:meterIssue?null:reading.varianceLiters,staffedMeterLiters:meterIssue?null:reading.staffedMeterLiters,closingMeterReadingId:reading.closingMeter==null?null:state?.current_reading_id,closingMeterError:hardware.has(reading.pumpId)?closingMeterError:undefined};

      });
    }
    catch(error){return res.status(400).json({message:error instanceof Error?error.message:String(error)});}
    const closingApprovals:ManagerApproval[]=[];
    const outstandingReadingVariances=getSqlite().prepare("SELECT reading_type,reported_value,authoritative_value,variance FROM reading_variances WHERE shift_id=? AND status<>'Resolved' AND ABS(variance)>=0.001").all(shift.id) as any[];
    const hasUnresolvedMeterReview=outstandingReadingVariances.length>0||Boolean(getSqlite().prepare("SELECT 1 FROM manager_approvals WHERE shift_id=? AND review_scope='READING' AND status<>'Approved'").get(shift.id));
    const requiresMeterApproval=!!closingMeterError||hasUnresolvedMeterReview||processedPumps.some(reading=>!!reading.meterIssue||hasMeterVariance(reading.reportedVarianceLiters)||hasMeterVariance(reading.varianceLiters));
    const pumpIncomplete=processedPumps.some(reading=>reading.reportedClosingMeter==null||reading.closingMeter==null);
    const totalPumpVarLiters=pumpIncomplete?null:processedPumps.reduce((sum,reading)=>sum+Math.abs(Number(reading.varianceLiters)),0);

    let totalTankVarLiters = 0;
    const processedTanks = (tankDips || []).map((t: any) => {
      const calcUsage = Number(t.openingDip) - Number(t.closingDip);
      const varL = calcUsage - t.actualSales;
      totalTankVarLiters += Math.abs(varL);
      return {
        ...t,
        calculatedUsage: calcUsage,
        varianceLiters: varL,
      };
    });

    let status: ThreeWayReconciliation['status'] = 'Auto-Approved';
    const absCashVar = Math.abs(cashVariance);

    const anyVariance = Math.abs(cashVariance) > 0.005 || pumpIncomplete || (totalPumpVarLiters??0) > 0.0005 || totalTankVarLiters > 0.0005;
    if (requiresMeterApproval || anyVariance) {
      status = 'Pending Approval';
    }

    const rec: ThreeWayReconciliation = {
      id: 'rec-' + Date.now(),
      shiftId: shift.id,
      staffId: staffId || shift.staffId,
      staffName: staffName || shift.staffName,
      timestamp: new Date().toISOString(),
      expectedCash,
      cashCount,
      totalActualCash: notesSum,
      cashVariance,
      pumpReadings: processedPumps,
      totalPumpVarianceLiters: totalPumpVarLiters,
      tankDips: processedTanks,
      totalTankVarianceLiters: totalTankVarLiters,
      status,
    };

    const closedStatus = status==='Pending Approval' ? 'Pending Approval' : 'Completed';
    const exceptionDetails=processedPumps.filter(reading=>reading.meterIssue).map(reading=>reading.pumpName+': '+reading.meterIssue+' (opening '+reading.openingMeter+', closing '+(reading.closingMeter??'unavailable')+')').join('; ');
    const priorShiftApprovalEvidence = (getSqlite().prepare("SELECT type, reason, amount_or_qty, status FROM manager_approvals WHERE shift_id=? AND status<>'Approved'").all(shift.id) as any[])
      .map((item) => item.type + ': ' + item.amount_or_qty + (item.reason ? ' — ' + item.reason : ''));
    const shiftApproval:ManagerApproval|null=status==='Pending Approval'?{
      id:'app-'+randomUUID(),timestamp:rec.timestamp,shiftId:shift.id,
      type:'Shift Variance Review',requestedBy:shift.staffName,
      reason:[
        'Shift ' + shift.id + ' closed; one manager decision is required for all variances.',
        'Cash variance: KES ' + cashVariance.toFixed(2),
        'Pump variance: ' + (totalPumpVarLiters==null?'INCOMPLETE — missing user record':totalPumpVarLiters.toFixed(3)+' L'),
        'Tank variance: ' + totalTankVarLiters.toFixed(3) + ' L',
        exceptionDetails ? 'Controller/meter exception: ' + exceptionDetails : '',
        closingMeterError ? 'Controller read failed: ' + closingMeterError : '',
        hasUnresolvedMeterReview ? 'Opening/reading variances: ' + JSON.stringify(outstandingReadingVariances) : '',
        priorShiftApprovalEvidence.length ? 'Prior shift-linked review evidence:\n' + priorShiftApprovalEvidence.join('\n') : '',
        'Nozzle evidence: ' + JSON.stringify(processedPumps),
        'Tank evidence: ' + JSON.stringify(processedTanks),
      ].filter(Boolean).join('\n'),
      amountOrQty:'KES '+cashVariance.toFixed(2)+' / pump '+(totalPumpVarLiters==null?'INCOMPLETE':totalPumpVarLiters.toFixed(3)+' L')+' / tank '+totalTankVarLiters.toFixed(3)+' L',
      reviewScope:'SHIFT', status:'Pending'
    }:null;

    try {
      const persistReconciliation = getSqlite().transaction(() => {
        db.reconciliationQueries.create({
          id: rec.id,
          date: rec.timestamp.slice(0, 10),
          shiftId: rec.shiftId,
          staffId: rec.staffId,
          staffName: rec.staffName,
          tankDipBefore: processedTanks[0]?.openingDip ?? null,
          tankDipAfter: processedTanks[0]?.closingDip ?? null,
          tankExpectedLiters: processedTanks.reduce((sum, tank) => sum + Number(tank.actualSales ?? 0), 0),
          tankActualLiters: processedTanks.reduce((sum, tank) => sum + Number(tank.calculatedUsage ?? 0), 0),
          tankVariance: totalTankVarLiters,
          pumpMeterBefore: processedPumps[0]?.openingMeter ?? null,
          pumpMeterAfter: processedPumps[0]?.closingMeter ?? null,
          pumpExpectedLiters: processedPumps.reduce((sum, pump) => sum + Number(pump.posSalesLiters ?? 0), 0),
          pumpActualLiters: processedPumps.reduce((sum, pump) => sum + Number(pump.meterSalesLiters ?? 0), 0),
          pumpVariance: totalPumpVarLiters,
          cashExpected: expectedCash,
          cashActual: notesSum,
          cashVariance,
          varianceNotes: JSON.stringify({ timestamp: rec.timestamp, cashCount, pumpReadings: processedPumps, tankDips: processedTanks }),
          status,
          approvedBy: null,
          approvedByName: null,
        } as any);

        processedPumps.forEach((reading: any) => {
          const pump = pumps.find((item) => item.id === reading.pumpId);
          if (!pump) return;
          const review=reading.closingMeter==null?null:recordMeterReview(getSqlite(),{shiftId:shift!.id,userId:actingUser.id,userName:actingUser.name,nozzle:pump,stage:'Closing',reported:reading.reportedClosingMeter,authoritative:reading.closingMeter,at:rec.timestamp});
          if(review)closingApprovals.push(review);

          if(reading.closingMeter==null||reading.meterSalesLiters==null)return;
          db.nozzleReadingQueries.create({
            id: `reading-${Date.now()}-${pump.id}-close`,
            nozzleId: pump.id,
            pumpId: pump.physicalPumpId ?? null,
            tankId: pump.tankId,
            fuelProductId: pump.fuelProductId,
            shiftId: shift.id,
            transactionId: null,
            previousReading: Number(reading.openingMeter),
            quantityDispensed: Number(reading.meterSalesLiters),
            currentReading: Number(reading.closingMeter),
            readingType: 'Closing',
            recordedBy: shift.staffId,
            timestamp: rec.timestamp,
          } as any);
        });

        processedTanks.forEach((dip: any) => {
          const tank = tanks.find((item) => item.id === dip.tankId);
          if (!tank) return;
          db.tankQueries.update(tank.id, {
            lastDipReading: Number(dip.closingDip),
            lastDipTime: rec.timestamp,
          } as any);
        });
        if(shiftApproval){
          getSqlite().prepare("DELETE FROM manager_approvals WHERE shift_id=?").run(shiftApproval.shiftId);
          getSqlite().prepare("INSERT INTO manager_approvals(id,timestamp,shift_id,type,requested_by,reason,amount_or_qty,status,review_scope) VALUES(?,?,?,?,?,?,?,'Pending','SHIFT')").run(shiftApproval.id,shiftApproval.timestamp,shiftApproval.shiftId,shiftApproval.type,shiftApproval.requestedBy,shiftApproval.reason,shiftApproval.amountOrQty);
        }
        db.shiftQueries.update(shift!.id,{endTime:rec.timestamp,status:closedStatus,closingCash:notesSum,closingPumpReadingsJson:JSON.stringify(processedPumps),closingTankDipsJson:JSON.stringify(processedTanks)} as any);
        db.userQueries.update(shift!.staffId,{currentShiftId:null} as any);
        getSqlite().prepare("UPDATE shift_assignments SET clock_out_time=?,status='Completed',expired_at=NULL,missed_reason=NULL WHERE clock_in_shift_id=?").run(rec.timestamp,shift!.id);
      });

      persistReconciliation();
    } catch (error) {
      console.error('Error saving reconciliation to database:', error);
      return res.status(500).json({ message: 'Reconciliation could not be saved.' });
    }

    reconciliations.unshift(rec);
    approvals.unshift(...(shiftApproval?[shiftApproval]:[]));
    Object.assign(shift,{endTime:rec.timestamp,status:closedStatus,approvalStatus:shiftApproval?'Pending':'Approved',actualCashCount:notesSum,cashVariance,fuelVarianceLiters:totalPumpVarLiters,tankVarianceLiters:totalTankVarLiters,closingPumpReadings:processedPumps,closingTankDips:processedTanks});
    const usr=users.find(u=>u.id===shift!.staffId);
    if(usr)usr.currentShiftId=null;

    addAuditLog(
      actingUser.id,
      actingUser.name,
      actingUser.role,
      'SHIFT_CLOCK_OUT',
      'Reconciliation',
      `Completed shift clock-out reconciliation. Status: ${status}. Cash Variance: KES ${cashVariance.toFixed(2)}`,
      status === 'Pending Approval' ? 'Warning' : 'Info'
    );

    res.json({ reconciliation: rec, shift });
  });

  // Approvals
  app.use('/api/approvals', createApprovalRouter({
    db,
    getSqlite,
    getApprovals: () => approvals,
    setApprovals: (nextApprovals) => { approvals = nextApprovals; },
    getShifts: () => shifts,
    setShifts: (nextShifts) => { shifts = nextShifts; },
    setReconciliations: (nextReconciliations) => { reconciliations = nextReconciliations; },
    readPersistedManagerApprovals,
    normalizeStoredReconciliation,
    isAdminRole,
    hasPermission,
    getUserById,
    verifyStoredPin,
    addAuditLog,
  }));
  // Audit Logs
  app.get('/api/audit-logs', (req, res) => {
    const roleCheck = requirePermission(req as any, res, 'VIEW_AUDIT_TRAIL', 'audit log access');
    if (roleCheck) return roleCheck;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 15)));
    const search = String(req.query.search || '').trim();
    const module = String(req.query.module || '').trim();
    const severity = String(req.query.severity || '').trim();
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (search) {
      clauses.push('(action LIKE ? OR details LIKE ? OR user_name LIKE ? OR user_role LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    if (module && module !== 'All') {
      clauses.push('module = ?');
      params.push(module);
    }
    if (severity && severity !== 'All') {
      clauses.push('severity = ?');
      params.push(severity);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const sqlite = getSqlite();
    const total = Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs${where}`).get(...params) as any).count || 0);
    const records = sqlite.prepare(`SELECT * FROM audit_logs${where} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map((record: any) => ({
        id: record.id,
        timestamp: record.timestamp,
        userId: record.user_id || '',
        userName: record.user_name || 'System',
        userRole: record.user_role || 'System',
        action: record.action,
        module: record.module,
        details: record.details || '',
        ipAddress: record.ip_address || '',
        severity: record.severity || 'Info',
      }));
    res.json({ records, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  });

  // --- VITE MIDDLEWARE SETUP ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: 'localhost',
        port: VITE_HMR_PORT,
        strictPort: true,
        // SQLite updates its WAL/SHM sidecars during normal API and automation
        // activity. They are runtime data, not frontend source files; watching
        // them causes Vite to force a full renderer reload on every checkpoint.
        watch: {
          ignored: ['**/*.db', '**/*.db-wal', '**/*.db-shm', '**/*.db-journal'],
        },
        hmr: process.env.DISABLE_HMR === 'true'
          ? false
          : {
              host: 'localhost',
              port: VITE_HMR_PORT,
            },
      },
      appType: 'spa',
    });
    viteDevServer = vite;
    app.use(vite.middlewares);
  } else {
    app.use(express.static(staticDir));
    app.get('*', (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.get('/api/system/sync-database', (req, res) => {
    try {
      const allData = db.getAllData() as any;
      users = allData.users as User[];
      products = allData.products as FuelProduct[];
      tanks = allData.tanks as FuelTank[];
      pumps = allData.pumps as PumpNozzle[];
      shopItems = allData.shopItems as ShopItem[];
      shifts = (allData.shifts as any[]).map((shift:any)=>({
        ...shift,
        actualCashCount:Number(shift.actualCashCount??shift.closingCash??0),
        openingPumpReadings:parseReadingList(shift.openingPumpReadingsJson),openingTankDips:parseReadingList(shift.openingTankDipsJson),
        closingPumpReadings:parseReadingList(shift.closingPumpReadingsJson),closingTankDips:parseReadingList(shift.closingTankDipsJson),
      })) as ShiftSession[];
      schedules = allData.schedules as ShiftSchedule[];
      transactions = (allData.transactions as any[]).map(normalizeStoredTransaction);
      deliveries = (allData.deliveries as any[]).map(normalizeStoredDelivery);
      reconciliations = (allData.reconciliations as any[]).map(normalizeStoredReconciliation);
      approvals = readPersistedManagerApprovals();
      auditLogs = allData.auditLogs as AuditLog[];
      stationSettings = allData.settings as StationSettings;
      creditNotes = allData.creditNotes as CreditNote[];
      customers = allData.customers as CustomerAccount[];
      cashFlow = allData.cashFlow as CashFlowRecord[];
      suppliers = allData.suppliers as SupplierAccount[];
      hydrateShiftSummaries();

      res.json({
        success: true,
        message: 'Database synced successfully',
        dataLoaded: {
          users: users.length,
          tanks: tanks.length,
          products: products.length,
          transactions: transactions.length,
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync database' });
    }
  });

  await startup;
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  console.log(`DEITAX FMS.A Server listening on http://127.0.0.1:${port}`);

  return { port, close: closeServer };
}

const isDirectServerLaunch = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectServerLaunch) {
  startServer().catch((error) => {
    console.error('Server startup error:', error);
    process.exit(1);
  });
}
