# FMS Database System Documentation

## Overview

The FMS (Fuel Management System) now includes a complete SQLite database system for persistent data storage. This replaces the in-memory data storage used previously, allowing all data to persist across server restarts.

## Architecture

### Technology Stack
- **Database**: SQLite 3 (better-sqlite3)
- **ORM**: Drizzle ORM
- **Location**: `./data/fms.db` (created automatically)
- **Schema**: Defined in `src/database/schema.ts`
- **Queries**: Helper functions in `src/database/queries.ts`

### Directory Structure
```
src/database/
├── schema.ts          # Database schema definitions
├── db.ts              # Database initialization and connection
├── queries.ts         # Query helper functions for all tables
├── seed.ts            # Database seeding and initialization
└── index.ts           # Central export file
```

## Database Tables

### 1. **Users** (Authentication & Staff)
Stores all staff members and system users.

```typescript
users {
  id: string (PRIMARY KEY)
  name: string
  email: string (UNIQUE)
  phone: string
  role: string (Admin | Station Manager | Auditor | Fuel Attendant | Shop Attendant | Cashier)
  pin: string (4-6 digits)
  active: boolean
  currentShiftId?: string
  assignedPumps?: string[] (JSON)
  createdAt: string (TIMESTAMP)
  updatedAt: string (TIMESTAMP)
}
```

### 2. **Fuel Products** (Inventory Management)
Fuel types and products available at the station.

```typescript
fuelProducts {
  id: string (PRIMARY KEY)
  code: string (UNIQUE) // e.g., PET-UNL
  name: string // e.g., Super Petrol UNL 95
  pricePerLiter: number
  costPerLiter: number
  taxRate: number // 0.16 for 16% VAT
  unit: string // "L" (Liters)
  color: string // UI badge color
  createdAt: string
  updatedAt: string
}
```

### 3. **Fuel Tanks** (Storage)
Physical fuel storage tanks at the station.

```typescript
fuelTanks {
  id: string (PRIMARY KEY)
  tankName: string
  fuelProductId: string (FOREIGN KEY → fuelProducts)
  fuelName: string
  capacityLiters: number
  currentLevelLiters: number
  reorderLevelLiters: number
  lastDipReading: number
  lastDipTime: string
  createdAt: string
  updatedAt: string
}
```

### 4. **Pump Nozzles** (Sales Points)
Fuel pumps connected to tanks for customer sales.

```typescript
pumpNozzles {
  id: string (PRIMARY KEY)
  pumpNumber: integer
  pumpName: string
  tankId: string (FOREIGN KEY → fuelTanks)
  fuelProductId: string (FOREIGN KEY → fuelProducts)
  fuelName: string
  openingMeterReading: number
  currentMeterReading: number
  status: string (Active | Maintenance | Offline)
  createdAt: string
  updatedAt: string
}
```

### 5. **Transactions** (Sales Records)
All fuel and shop sales transactions.

```typescript
transactions {
  id: string (PRIMARY KEY)
  date: string (YYYY-MM-DD)
  time: string (HH:mm:ss)
  pumpId?: string
  productId?: string (FOREIGN KEY → fuelProducts)
  quantity: number
  unitPrice: number
  subtotal: number
  tax: number
  totalAmount: number
  paymentMethod: string (Cash | Card | Mpesa | Credit)
  attendantId?: string (FOREIGN KEY → users)
  attendantName?: string
  meterReadingBefore?: number
  meterReadingAfter?: number
  receiptNumber: string (UNIQUE)
  status: string (Completed | Pending | Cancelled)
  shiftId?: string (FOREIGN KEY → shifts)
  customerId?: string (FOREIGN KEY → customers)
  notes?: string
  createdAt: string
  updatedAt: string
}
```

### 6. **Customers** (Credit Accounts)
Retail and wholesale customer accounts for credit purchases.

```typescript
customers {
  id: string (PRIMARY KEY)
  businessName: string
  contactPerson: string
  email?: string
  phone: string
  address?: string
  accountType: string (Retail | Wholesale | Corporate)
  creditLimit: number
  currentDebt: number
  status: string (Active | Suspended | Closed)
  taxId?: string
  createdAt: string
  updatedAt: string
}
```

### 7. **Suppliers** (Fuel & Stock Suppliers)
Fuel suppliers and shop item vendors.

```typescript
suppliers {
  id: string (PRIMARY KEY)
  supplierName: string
  contactPerson: string
  email?: string
  phone: string
  address?: string
  paymentTerms?: string (COD | Net 30 | Net 60)
  accountBalance: number
  status: string (Active | Inactive | Suspended)
  taxId?: string
  bankName?: string
  bankAccount?: string
  createdAt: string
  updatedAt: string
}
```

### 8. **Fuel Deliveries** (Supplier Receipts)
Records of fuel deliveries from suppliers.

```typescript
fuelDeliveries {
  id: string (PRIMARY KEY)
  supplierId: string (FOREIGN KEY → suppliers)
  supplierName: string
  tankId: string (FOREIGN KEY → fuelTanks)
  fuelProductId: string (FOREIGN KEY → fuelProducts)
  quantity: number (liters)
  unitPrice: number
  totalCost: number
  deliveryDate: string
  deliveryTime?: string
  invoiceNumber?: string
  driverName?: string
  driverPhone?: string
  vehicleReg?: string
  receivedBy?: string (FOREIGN KEY → users)
  receivedByName?: string
  status: string (Pending | Received | Verified | Completed)
  notes?: string
  createdAt: string
  updatedAt: string
}
```

### 9. **Shifts** (Shift Sessions)
Staff shift sessions with opening and closing details.

```typescript
shifts {
  id: string (PRIMARY KEY)
  staffId: string (FOREIGN KEY → users)
  staffName: string
  staffRole: string
  shiftType: string (Morning | Evening | Night)
  date: string (YYYY-MM-DD)
  startTime: string
  endTime?: string
  status: string (Active | Completed | Cancelled)
  openingCash: number
  closingCash?: number
  createdAt: string
  updatedAt: string
}
```

### 10. **Shift Schedules** (Staff Scheduling)
Planned shift schedules for staff members.

```typescript
shiftSchedules {
  id: string (PRIMARY KEY)
  staffId: string (FOREIGN KEY → users)
  staffName: string
  role: string
  shiftType: string (Morning | Evening | Night)
  date: string (YYYY-MM-DD)
  startTime: string
  endTime: string
  status: string (Scheduled | In Progress | Completed | Missed)
  createdAt: string
  updatedAt: string
}
```

### 11. **Shop Items** (Inventory)
Shop products (lubricants, snacks, car care items, etc.).

```typescript
shopItems {
  id: string (PRIMARY KEY)
  code: string (UNIQUE)
  name: string
  category: string (Lubricants | Snacks & Drinks | Car Care | Gas Cylinders | General)
  unitPrice: number
  costPrice: number
  stockQty: integer
  reorderLevel: integer
  requireShiftCount: boolean
  createdAt: string
  updatedAt: string
}
```

### 12. **Cash Flow Records** (Financial Transactions)
All income and expense records for accounting.

```typescript
cashFlowRecords {
  id: string (PRIMARY KEY)
  date: string (YYYY-MM-DD)
  type: string (Income | Expense | Transfer)
  category: string (Sales | Supplier Payment | Utilities | Rent | etc.)
  description: string
  amount: number
  accountingMethod: string (Cash | Check | Bank Transfer | Mpesa)
  relatedTransactionId?: string
  relatedDeliveryId?: string
  relatedPaymentId?: string
  recordedBy: string (FOREIGN KEY → users)
  recordedByName: string
  approvedBy?: string (FOREIGN KEY → users)
  approvedByName?: string
  notes?: string
  status: string (Recorded | Verified | Reconciled)
  createdAt: string
  updatedAt: string
}
```

### 13. **Reconciliations** (End-of-Shift)
Three-way reconciliation records (tanks, pumps, cash).

```typescript
reconciliations {
  id: string (PRIMARY KEY)
  date: string (YYYY-MM-DD)
  shiftId?: string (FOREIGN KEY → shifts)
  staffId: string (FOREIGN KEY → users)
  staffName: string
  // Tank reconciliation
  tankDipBefore: number
  tankDipAfter: number
  tankExpectedLiters: number
  tankActualLiters: number
  tankVariance: number
  // Pump reconciliation
  pumpMeterBefore: number
  pumpMeterAfter: number
  pumpExpectedLiters: number
  pumpActualLiters: number
  pumpVariance: number
  // Cash reconciliation
  cashExpected: number
  cashActual: number
  cashVariance: number
  // Summary
  varianceNotes?: string
  status: string (Pending | Approved | Rejected)
  approvedBy?: string (FOREIGN KEY → users)
  approvedByName?: string
  createdAt: string
  updatedAt: string
}
```

### 14. **Approvals** (Workflow)
Pending manager approvals for price changes, adjustments, etc.

```typescript
approvals {
  id: string (PRIMARY KEY)
  type: string (Price Change | Credit Note | Adjustment | etc.)
  referenceId: string
  description: string
  requestedBy: string (FOREIGN KEY → users)
  requestedByName: string
  requestedAt: string
  details: JSON blob
  status: string (Pending | Approved | Rejected)
  approvedBy?: string (FOREIGN KEY → users)
  approvedByName?: string
  approvedAt?: string
  approvalNotes?: string
  createdAt: string
  updatedAt: string
}
```

### 15. **Audit Logs** (Compliance & Tracking)
Comprehensive audit trail of all system activities.

```typescript
auditLogs {
  id: string (PRIMARY KEY)
  timestamp: string (ISO 8601)
  userId: string (FOREIGN KEY → users)
  userName: string
  userRole: string
  action: string (USER_CREATED | SALE_RECORDED | SHIFT_STARTED | etc.)
  module: string (Auth | Sales | Shifts | Reconciliation | Tanks | Shop | Approvals | Settings | Suppliers | Stock)
  details: string
  ipAddress: string
  severity: string (Info | Warning | Critical)
  createdAt: string
}
```

### 16. **Stock Adjustments** (Inventory Tracking)
Records of fuel and shop item adjustments (wastage, theft, etc.).

```typescript
stockAdjustments {
  id: string (PRIMARY KEY)
  type: string (Fuel Tank | Shop Item)
  referenceId: string
  referenceName: string
  previousQuantity: number
  adjustmentQuantity: number
  newQuantity: number
  reason: string (Wastage | Breakage | Theft | Audit | etc.)
  recordedBy: string (FOREIGN KEY → users)
  recordedByName: string
  notes?: string
  createdAt: string
  updatedAt: string
}
```

### 17. **Credit Notes** (Customer Credits)
Credit memos issued to customers.

```typescript
creditNotes {
  id: string (PRIMARY KEY)
  customerId: string (FOREIGN KEY → customers)
  amount: number
  reason: string
  status: string (Issued | Applied | Cancelled)
  issuedBy: string (FOREIGN KEY → users)
  issuedByName: string
  approvedBy?: string (FOREIGN KEY → users)
  approvedByName?: string
  appliedToTransactionId?: string
  createdAt: string
  updatedAt: string
}
```

### 18. **Supplier Payments** (Payment Records)
Records of payments made to suppliers.

```typescript
supplierPayments {
  id: string (PRIMARY KEY)
  supplierId: string (FOREIGN KEY → suppliers)
  amount: number
  paymentMethod: string (Bank Transfer | Cash | Check)
  referenceNumber?: string
  date: string (YYYY-MM-DD)
  approvedBy?: string (FOREIGN KEY → users)
  approvedByName?: string
  notes?: string
  status: string (Completed | Pending | Cancelled)
  createdAt: string
  updatedAt: string
}
```

### 19. **Station Settings** (Configuration)
Global station configuration (store name, tax ID, etc.).

```typescript
stationSettings {
  id: string (PRIMARY KEY, default: "station-1")
  stationName: string
  tagline?: string
  taxPin: string
  cuSerial: string (CU serial number)
  address: string
  phone: string
  email?: string
  invoiceTerms?: string
  paybillNumber?: string
  tillNumber?: string
  createdAt: string
  updatedAt: string
}
```

## Usage

### 1. Initialize Database
The database is automatically initialized when the server starts:

```typescript
import { initializeDatabaseIfNeeded } from './src/database/seed.js';

// Called automatically on server startup
initializeDatabaseIfNeeded();
```

### 2. Query Data
Use the query helpers in your server endpoints:

```typescript
import { 
  userQueries, 
  transactionQueries, 
  tankQueries 
} from './src/database/queries.ts';

// Get all users
const users = userQueries.all();

// Get user by ID
const user = userQueries.byId('usr-1');

// Get active users
const activeUsers = userQueries.active();

// Create a user
userQueries.create({
  id: 'usr-new',
  name: 'John Doe',
  email: 'john@example.com',
  phone: '+254712345678',
  role: 'Fuel Attendant',
  pin: '1234',
  active: true
});
```

### 3. Common Query Patterns

#### Get Today's Transactions
```typescript
import { transactionQueries } from './src/database/queries.ts';

const today = new Date().toISOString().split('T')[0];
const todayTransactions = transactionQueries.byDate(today);
const totalSales = todayTransactions.reduce((sum, t) => sum + t.totalAmount, 0);
```

#### Get Completed Transactions
```typescript
const completed = transactionQueries.completed();
```

#### Get Active Shifts
```typescript
import { shiftQueries } from './src/database/queries.ts';

const activeShifts = shiftQueries.active();
```

#### Get Pending Approvals
```typescript
import { approvalQueries } from './src/database/queries.ts';

const pending = approvalQueries.pending();
```

#### Record Cash Flow
```typescript
import { cashFlowQueries } from './src/database/queries.ts';

cashFlowQueries.create({
  id: 'cf-' + Date.now(),
  date: new Date().toISOString().split('T')[0],
  type: 'Income',
  category: 'Sales',
  description: 'Fuel sale',
  amount: 15000,
  accountingMethod: 'Cash',
  recordedBy: 'usr-1',
  recordedByName: 'John Doe',
  status: 'Recorded',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});
```

## Data Persistence

- **Location**: `./data/fms.db`
- **Format**: SQLite 3 binary database
- **Size**: Grows with data volume (typically < 50MB for a year of operations)
- **Access**: Only through Drizzle ORM or SQLite CLI
- **Backup**: Copy `./data/fms.db` file to backup location

### Backup Database
```bash
# Unix/Linux/Mac
cp ./data/fms.db ./backups/fms-$(date +%Y%m%d-%H%M%S).db

# Windows
copy data\fms.db backups\fms-%date:~-10,2%%date:~-7,2%%date:~-4,4%-%time::=%.db
```

## Reset Database

To reset the database to initial state:

```typescript
import { resetDatabase } from './src/database/seed.ts';

resetDatabase(); // Clears all data and reloads seed data
```

Or via API endpoint:
```
POST /api/system/reset-database
```

## Database Statistics

Get database statistics:

```typescript
import { getDatabaseStats } from './src/database/seed.ts';

const stats = getDatabaseStats();
console.log(stats);
// Output:
// {
//   users: 7,
//   products: 3,
//   tanks: 2,
//   pumps: 6,
//   shopItems: 15,
//   transactions: 45,
//   customers: 12,
//   suppliers: 8,
//   shifts: 28,
//   auditLogs: 342
// }
```

## Audit Trail

Every important action is logged to the `auditLogs` table for compliance:

```typescript
import { auditLogQueries } from './src/database/queries.ts';

// Get all critical events
const critical = auditLogQueries.critical();

// Get logs by user
const userLogs = auditLogQueries.byUserId('usr-1');

// Get logs by module
const saleLogs = auditLogQueries.byModule('Sales');
```

## Performance Tips

1. **Indexes**: Primary keys and foreign keys are automatically indexed
2. **Batch Operations**: Use transactions for multiple related inserts
3. **Query Efficiency**: Always filter data at the database level, not in application code
4. **Pagination**: Implement pagination for large result sets
5. **Archive**: Archive old transactions (> 1 year) to separate database

## Troubleshooting

### Database Locked Error
```
Error: database is locked
```
This occurs when multiple processes try to write simultaneously. Solutions:
- Ensure only one server instance is running
- Increase `busy_timeout` in database connection
- Use write queuing for concurrent operations

### Foreign Key Constraint Error
```
Error: FOREIGN KEY constraint failed
```
Ensure referenced records exist before creating dependent records.

### Database Not Found
```
Error: database disk image is malformed
```
Solutions:
1. Check file permissions on `./data/fms.db`
2. Ensure disk has free space
3. Restore from backup
4. Delete corrupted file and let system recreate it

## Migration Guide

To migrate from in-memory to database:

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Update imports in server.ts**:
   ```typescript
   import { userQueries, transactionQueries, ... } from './src/database/queries.js';
   ```

3. **Replace data access**:
   ```typescript
   // Old: users.push(newUser)
   // New:
   userQueries.create(newUser);
   ```

4. **Test all endpoints**:
   - Verify data persists across server restarts
   - Check audit logs are being recorded
   - Validate data integrity

## Support

For issues or questions:
1. Check audit logs: `auditLogQueries.critical()`
2. Review server console for error messages
3. Verify database file integrity: `sqlite3 ./data/fms.db ".tables"`
4. Check disk space and file permissions
