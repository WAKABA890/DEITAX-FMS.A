/**
 * Database Integration Guide for Server.ts
 * 
 * This file shows how to update the existing Express server to use the database
 * instead of in-memory arrays.
 */

// ===========================
// STEP 1: Add imports at the top of server.ts
// ===========================

import {
  getDatabase,
  userQueries,
  productQueries,
  tankQueries,
  pumpQueries,
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
} from './src/database/index.js';

// ===========================
// STEP 2: Replace in-memory data initialization with database
// ===========================

// OLD CODE (remove):
// let users: User[] = JSON.parse(JSON.stringify(INITIAL_USERS));
// let products: FuelProduct[] = JSON.parse(JSON.stringify(INITIAL_PRODUCTS));
// ... etc

// NEW CODE (add after app initialization):
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Initialize database (this loads all data from SQLite)
  const db = getDatabase();

  // ===========================
  // STEP 3: Helper function to add audit logs (using database)
  // ===========================

  const addAuditLog = (
    userId: string,
    userName: string,
    userRole: any,
    action: string,
    module: 'Auth' | 'Sales' | 'Shifts' | 'Reconciliation' | 'Tanks' | 'Shop' | 'Approvals' | 'Settings' | 'Suppliers' | 'Stock',
    details: string,
    severity: 'Info' | 'Warning' | 'Critical' = 'Info'
  ) => {
    try {
      auditLogQueries.create({
        id: 'log-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        userId,
        userName,
        userRole,
        action,
        module,
        details,
        ipAddress: '127.0.0.1',
        severity,
      });
    } catch (error) {
      console.error('Error creating audit log:', error);
    }
  };

  // ===========================
  // STEP 4: Update API endpoints to use database
  // ===========================

  // Example 1: Get Status Endpoint
  app.get('/api/status', (req, res) => {
    try {
      const activeShifts = shiftQueries.active();
      const pendingApprovals = approvalQueries.pending();
      const completedTransactions = transactionQueries.completed();

      const totalSalesToday = completedTransactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0);

      res.json({
        status: 'online',
        system: 'DT-FMS (Fuel Management System)',
        activeShiftsCount: activeShifts.length,
        pendingApprovalsCount: pendingApprovals.length,
        totalSalesToday,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  // Example 2: Get Users Endpoint
  app.get('/api/users', (req, res) => {
    try {
      const users = userQueries.all();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // Example 3: Create User Endpoint
  app.post('/api/users', (req, res) => {
    try {
      const newUser = {
        id: 'usr-' + Date.now(),
        ...req.body,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      userQueries.create(newUser as any);
      addAuditLog('sys', 'System', 'Admin', 'USER_CREATED', 'Settings', `Created user ${newUser.name}`);

      res.json(newUser);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  // Example 4: Get Tanks Endpoint
  app.get('/api/tanks', (req, res) => {
    try {
      const tanks = tankQueries.all();
      res.json(tanks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tanks' });
    }
  });

  // Example 5: Record Dip Endpoint
  app.post('/api/tanks/dip', (req, res) => {
    try {
      const { tankId, dipReadingLiters, userId, userName, userRole } = req.body;

      const tank = tankQueries.byId(tankId);
      if (!tank) {
        return res.status(404).json({ error: 'Tank not found' });
      }

      const prevLevel = tank.currentLevelLiters;

      // Update tank with new reading
      tankQueries.update(tankId, {
        currentLevelLiters: Number(dipReadingLiters),
        lastDipReading: Number(dipReadingLiters),
        lastDipTime: new Date().toISOString(),
      });

      addAuditLog(
        userId || 'sys',
        userName || 'User',
        userRole || 'Admin',
        'TANK_DIP_RECORDED',
        'Tanks',
        `Recorded dip for ${tank.tankName}: ${dipReadingLiters}L (prev: ${prevLevel}L)`
      );

      const updatedTank = tankQueries.byId(tankId);
      res.json(updatedTank);
    } catch (error) {
      res.status(500).json({ error: 'Failed to record dip' });
    }
  });

  // Example 6: Get Transactions Endpoint
  app.get('/api/transactions', (req, res) => {
    try {
      const transactions = transactionQueries.all();
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  });

  // Example 7: Create Transaction Endpoint
  app.post('/api/sales', (req, res) => {
    try {
      const { pumpId, productId, quantity, unitPrice, paymentMethod, attendantId, attendantName, shiftId, customerId } = req.body;

      const subtotal = quantity * unitPrice;
      const tax = subtotal * 0.16; // 16% VAT
      const totalAmount = subtotal + tax;

      const newTransaction = {
        id: 'tx-' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        time: new Date().toISOString().split('T')[1],
        pumpId,
        productId,
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        subtotal,
        tax,
        totalAmount,
        paymentMethod,
        attendantId,
        attendantName,
        receiptNumber: 'RCP-' + Date.now(),
        status: 'Completed',
        shiftId,
        customerId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      transactionQueries.create(newTransaction as any);

      // Update customer debt if applicable
      if (customerId && paymentMethod !== 'Cash') {
        const customer = customerQueries.byId(customerId);
        if (customer) {
          customerQueries.update(customerId, {
            currentDebt: customer.currentDebt + totalAmount,
          });
        }
      }

      // Record cash flow
      cashFlowQueries.create({
        id: 'cf-' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        type: 'Income',
        category: 'Sales',
        description: `Fuel sale - ${quantity}L at ${unitPrice}/L`,
        amount: totalAmount,
        accountingMethod: paymentMethod,
        relatedTransactionId: newTransaction.id,
        recordedBy: attendantId || 'sys',
        recordedByName: attendantName || 'System',
        status: 'Recorded',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

      addAuditLog(
        attendantId || 'sys',
        attendantName || 'System',
        'Fuel Attendant',
        'SALE_RECORDED',
        'Sales',
        `Sale: ${quantity}L @ ${unitPrice}/L = ${totalAmount} KES`
      );

      res.json(newTransaction);
    } catch (error) {
      console.error('Error creating transaction:', error);
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  });

  // Example 8: Get Audit Logs Endpoint
  app.get('/api/audit-logs', (req, res) => {
    try {
      const { userId, module, limit = 100 } = req.query;

      let logs: any;
      if (userId) {
        logs = auditLogQueries.byUserId(userId as string);
      } else if (module) {
        logs = auditLogQueries.byModule(module as string);
      } else {
        logs = auditLogQueries.all();
      }

      res.json(logs.slice(0, parseInt(limit as string)));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  // ===========================
  // STEP 5: Update handlers to use database
  // ===========================

  // Example handler for processing a sale
  const handleProcessSale = async (saleData: any) => {
    try {
      const newTransaction = {
        id: 'tx-' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        time: new Date().toISOString().split('T')[1],
        ...saleData,
        status: 'Completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      transactionQueries.create(newTransaction as any);

      // Record cash flow
      if (saleData.totalAmount) {
        cashFlowQueries.create({
          id: 'cf-' + Date.now(),
          date: newTransaction.date,
          type: 'Income',
          category: 'Sales',
          description: `Fuel sale - ${saleData.quantity}L`,
          amount: saleData.totalAmount,
          accountingMethod: saleData.paymentMethod || 'Cash',
          relatedTransactionId: newTransaction.id,
          recordedBy: saleData.attendantId || 'sys',
          recordedByName: saleData.attendantName || 'System',
          status: 'Recorded',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as any);
      }

      return newTransaction;
    } catch (error) {
      console.error('Error processing sale:', error);
      throw error;
    }
  };

  // Example handler for clock in
  const handleClockIn = async (userId: string, pin: string, shiftType: string, openingCash: number) => {
    try {
      const user = userQueries.byId(userId);
      if (!user) throw new Error('User not found');

      const newShift = {
        id: 'shift-' + Date.now(),
        staffId: userId,
        staffName: user.name,
        staffRole: user.role,
        shiftType,
        date: new Date().toISOString().split('T')[0],
        startTime: new Date().toISOString(),
        endTime: '',
        status: 'Active',
        openingCash,
        closingCash: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      shiftQueries.create(newShift as any);

      // Record in cash flow
      cashFlowQueries.create({
        id: 'cf-' + Date.now(),
        date: newShift.date,
        type: 'Income',
        category: 'Opening Cash',
        description: `Opening cash for ${user.name} - ${shiftType} shift`,
        amount: openingCash,
        accountingMethod: 'Cash',
        recordedBy: userId,
        recordedByName: user.name,
        status: 'Recorded',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

      addAuditLog(userId, user.name, user.role, 'SHIFT_STARTED', 'Shifts', `Started ${shiftType} shift with ${openingCash} KES opening cash`);

      return newShift;
    } catch (error) {
      console.error('Error clocking in:', error);
      throw error;
    }
  };

  // ===========================
  // STEP 6: Replace all remaining endpoints
  // ===========================
  // Follow the same pattern for:
  // - /api/products
  // - /api/pumps
  // - /api/shop-items
  // - /api/customers
  // - /api/suppliers
  // - /api/deliveries
  // - /api/approvals
  // - /api/reconciliations
  // - /api/cash-flow
  // - etc.

  return app;
}

export { startServer };
