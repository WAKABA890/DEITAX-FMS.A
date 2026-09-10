import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {buildSync} from 'esbuild';

const port = 3121;
const testDirectory=mkdtempSync(path.join(tmpdir(),'dt-fms-critical-flows-'));
const databasePath = path.join(testDirectory, `critical-user-flows-${randomUUID()}.db`);
const runnerDirectory=mkdtempSync(path.join(process.cwd(),'build','critical-flow-runner-'));
const serverRunner=path.join(runnerDirectory,'server.mjs');
buildSync({entryPoints:[path.join(process.cwd(),'server.ts')],outfile:serverRunner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const baseUrl = `http://localhost:${port}/api`;

if (existsSync(databasePath)) rmSync(databasePath);

let server: ReturnType<typeof spawn>;
let serverOutput = '';

const startServer = () => {
  serverOutput = '';
  server = spawn(process.execPath, [serverRunner], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VITE_HMR_PORT: '24721', FMS_DB_PATH: databasePath, DISABLE_HMR: 'true' },
    stdio: 'pipe',
  });
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
};

const stopServer = async () => {
  const child=server;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled=false;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
    const timer=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');finish();},5000);
    child.once('exit',finish);
    child.kill('SIGTERM');
  });
};

const restartServer = async () => {
  await stopServer();
  startServer();
  await waitForServer();
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/status`)).ok) return;
    } catch {
      // The temporary integration server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Critical user flows server did not start. ${serverOutput}`);
};

const request = async (endpoint: string, options: RequestInit = {}, cookie?: string) => {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
  });
  return { response, body: await response.json().catch(() => null) };
};

const login = async (identifier: string, pin: string) => {
  const result = await request('/auth/verify-pin', { method: 'POST', body: JSON.stringify({ identifier, pin }) });
  assert.equal(result.response.status, 200, `Expected ${identifier} to authenticate.`);
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Successful login must provide a session cookie.');
  return { user: result.body.user, cookie };
};

try {
  startServer();
  await waitForServer();

  const bootstrap = await request('/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Flow Admin', email: 'flow-admin@example.test', phone: '0700000000', pin: '1234' }),
  });
  assert.equal(bootstrap.response.status, 200);
  let admin = await login('flow-admin@example.test', '1234');

  const inventory = new Database(databasePath);
  inventory.exec(`
    INSERT INTO fuel_products (id, code, name, price_per_liter, cost_per_liter, tax_rate, tax_code, unit, color)
    VALUES ('flow-fuel', 'FLOW-FUEL', 'Flow Petrol', 170, 150, 0.16, 'B', 'L', '#10b981');
    INSERT INTO fuel_tanks (id, tank_name, fuel_product_id, fuel_name, capacity_liters, current_level_liters, reorder_level_liters, last_dip_reading)
    VALUES ('flow-tank', 'Flow Tank', 'flow-fuel', 'Flow Petrol', 10000, 5000, 1000, 5000);
    INSERT INTO shop_items (id, code, name, category, unit_price, cost_price, stock_qty, reorder_level, require_shift_count)
    VALUES ('flow-shop', 'FLOW-WATER', 'Flow Water', 'Drinks', 50, 30, 20, 5, 0);
  `);
  inventory.close();
  const initialSessionCookie=admin.cookie;
  await restartServer();
  const restoredSession=await request('/auth/me',{},initialSessionCookie);
  assert.equal(restoredSession.response.status,200,'Session must survive a server restart.');
  assert.equal(restoredSession.body.user.id,admin.user.id);
  admin = await login('flow-admin@example.test', '1234');

  const shiftPlan = await request('/shift-plans', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Flow Morning Roster',
      shiftType: 'Morning',
      scheduledStart: '2026-08-21T06:00:00.000Z',
      scheduledEnd: '2026-08-21T14:00:00.000Z',
      userIds: [admin.user.id],
    }),
  }, admin.cookie);
  assert.equal(shiftPlan.response.status, 201);
  const clockIn = await request('/shifts/clock-in', {
    method: 'POST',
    body: JSON.stringify({ userId: admin.user.id, pin: '1234', shiftType: 'Morning', openingCash: 0, shiftPlanId: shiftPlan.body.id }),
  }, admin.cookie);
  assert.equal(clockIn.response.status, 200);
  const activeShiftId = clockIn.body.id;

  // Full shop-cart checkout: one sale, linked shift, shift/dashboard shop totals, then UI success callbacks.
  const shopCheckout = await request('/sales', {
    method: 'POST',
    body: JSON.stringify({
      shiftId: activeShiftId,
      staffId: admin.user.id,
      staffName: admin.user.name,
      type: 'Shop',
      paymentMethod: 'Cash',
      documentType: 'Receipt',
      items: [{ itemId: 'flow-shop', name: 'Flow Water', type: 'Shop', qty: 2, unitPrice: 50, taxCode: 'A' }],
    }),
  }, admin.cookie);
  assert.equal(shopCheckout.response.status, 200);
  const checkoutTransaction = shopCheckout.body;

  const checkoutDatabase = new Database(databasePath, { readonly: true });
  assert.equal((checkoutDatabase.prepare('SELECT COUNT(*) AS count FROM transactions WHERE id = ?').get(checkoutTransaction.id) as { count: number }).count, 1);
  assert.equal((checkoutDatabase.prepare('SELECT shift_id FROM transactions WHERE id = ?').get(checkoutTransaction.id) as { shift_id: string }).shift_id, activeShiftId);
  checkoutDatabase.close();
  const activeShift = await request('/shifts/active', {}, admin.cookie);
  assert.equal(activeShift.body.id, activeShiftId);
  assert.equal(activeShift.body.totalShopSales, checkoutTransaction.totalAmount);
  const dashboard = await request('/dashboard-summary', {}, admin.cookie);
  const dashboardShift = dashboard.body.activeShifts.find((shift: any) => shift.shiftId === activeShiftId);
  assert.equal(dashboardShift.totalShopSales, checkoutTransaction.totalAmount);
  assert.equal(dashboard.body.today.shopRevenue, checkoutTransaction.totalAmount);

  const pointOfSaleSource = readFileSync(path.join(process.cwd(), 'src', 'components', 'PointOfSale.tsx'), 'utf8');
  const checkoutStart = pointOfSaleSource.indexOf('const handleCartCheckout = async () => {');
  const checkoutEnd = pointOfSaleSource.indexOf('// Filter Shop Items', checkoutStart);
  const checkoutHandler = pointOfSaleSource.slice(checkoutStart, checkoutEnd);
  assert.ok(checkoutHandler.indexOf('const newTx = await onProcessSale(salePayload);') < checkoutHandler.indexOf('setUnifiedCart([]);'), 'The cart must clear only after checkout succeeds.');
  assert.ok(checkoutHandler.indexOf('setUnifiedCart([]);') < checkoutHandler.indexOf('onOpenReceipt(newTx);'), 'Successful cart checkout must open the shared receipt preview for the persisted transaction.');

  // A delivery must only create payable inventory; the confirmed supplier payout creates one durable outflow.
  const supplier = await request('/suppliers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Flow Supplier', phone: '0700000002', status: 'Active' }),
  }, admin.cookie);
  assert.equal(supplier.response.status, 200);
  const delivery = await request('/deliveries', {
    method: 'POST',
    body: JSON.stringify({ tankId: 'flow-tank', supplierId: supplier.body.id, deliveryNoteNo: 'FLOW-DEL-001', litersReceived: 100, costPerLiter: 150, receivedBy: admin.user.name, userId: admin.user.id, userRole: admin.user.role }),
  }, admin.cookie);
  assert.equal(delivery.response.status, 200);
  const supplierDatabase = new Database(databasePath, { readonly: true });
  assert.equal((supplierDatabase.prepare("SELECT COUNT(*) AS count FROM cash_flow_records WHERE type = 'Outflow' AND category = 'Supplier Payment'").get() as { count: number }).count, 0);
  supplierDatabase.close();
  const payout = await request('/suppliers/payment', {
    method: 'POST',
    body: JSON.stringify({ supplierId: supplier.body.id, amount: 5000, paymentMethod: 'Bank Transfer', referenceNo: 'FLOW-PAYOUT-001', deliveryNoteNo: 'FLOW-DEL-001' }),
  }, admin.cookie);
  assert.equal(payout.response.status, 200);
  const payoutDatabase = new Database(databasePath, { readonly: true });
  const payoutOutflow = payoutDatabase.prepare("SELECT amount, related_payment_id FROM cash_flow_records WHERE type = 'Outflow' AND category = 'Supplier Payment'").all() as Array<{ amount: number; related_payment_id: string }>;
  assert.deepEqual(payoutOutflow, [{ amount: 5000, related_payment_id: payout.body.payment.id }]);
  payoutDatabase.close();

  // Movement labels must follow the persisted quantity deltas, with valid persisted timestamps.
  for (const newQty of [25, 18]) {
    const adjustment = await request('/stock/adjustments', {
      method: 'POST',
      body: JSON.stringify({ type: 'Shop', itemId: 'flow-shop', newQty, reason: 'Flow regression adjustment', userId: admin.user.id, userName: admin.user.name, userRole: admin.user.role }),
    }, admin.cookie);
    assert.equal(adjustment.response.status, 200);
  }
  const adjustmentDatabase = new Database(databasePath, { readonly: true });
  const adjustments = adjustmentDatabase.prepare("SELECT previous_quantity, adjustment_quantity, new_quantity, movement_type, created_at FROM stock_adjustments WHERE reference_id = 'flow-shop' AND source = 'Manual Adjustment' ORDER BY created_at ASC, id ASC").all() as Array<{ previous_quantity: number; adjustment_quantity: number; new_quantity: number; movement_type: string; created_at: string }>;
  assert.equal(adjustments.length, 2);
  for (const adjustment of adjustments) {
    const actualDelta = adjustment.new_quantity - adjustment.previous_quantity;
    assert.equal(adjustment.adjustment_quantity, actualDelta);
    assert.equal(adjustment.movement_type, actualDelta > 0 ? 'Stock Increase' : 'Stock Decrease');
    assert.ok(Number.isFinite(Date.parse(adjustment.created_at)), 'Stock adjustment timestamp must be a valid persisted date.');
  }
  adjustmentDatabase.close();

  // Save Permissions and Edit User use the same API callbacks as User Management and survive an application reload.
  const user = await request('/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Flow Cashier', username: 'flow-cashier', email: 'flow-cashier@example.test', phone: '0700000003', role: 'Cashier', pin: '5678' }),
  }, admin.cookie);
  assert.equal(user.response.status, 200);
  const savedPermissions = await request(`/users/${user.body.id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions: ['VIEW_AUDIT_TRAIL', 'ADJUST_STOCK'] }),
  }, admin.cookie);
  assert.equal(savedPermissions.response.status, 200);
  assert.deepEqual([...savedPermissions.body.permissions].sort(), ['ADJUST_STOCK', 'VIEW_AUDIT_TRAIL']);
  const editedUser = await request(`/users/${user.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Flow Senior Cashier', username: 'flow-senior-cashier', email: 'flow-senior-cashier@example.test', phone: '0700000099', role: 'Cashier', department: 'Shop', jobTitle: 'Lead Cashier', employeeId: 'FLOW-99', status: 'Active' }),
  }, admin.cookie);
  assert.equal(editedUser.response.status, 200);

  const userManagementSource = readFileSync(path.join(process.cwd(), 'src', 'components', 'UserManagement.tsx'), 'utf8');
  assert.ok(userManagementSource.includes('await onUpdatePermissions(selectedUser.id, selectedPermissions)'), 'Save Permissions must call the user-management API callback.');
  assert.ok(userManagementSource.includes('await onUpdateUser(user.id, { role: nextRole })'), 'Edit User role changes must call and await the user-management API callback.');

  const permissionSessionCookie=admin.cookie;
  await restartServer();
  const restoredPermissionSession=await request('/auth/me',{},permissionSessionCookie);
  assert.equal(restoredPermissionSession.response.status,200,'Permission-bearing session must survive restart.');
  assert.deepEqual([...restoredPermissionSession.body.user.permissions].sort(),[...admin.user.permissions].sort());
  admin = {user:restoredPermissionSession.body.user,cookie:permissionSessionCookie};
  const reloadedPermissions = await request(`/users/${user.body.id}/permissions`, {}, admin.cookie);
  assert.deepEqual([...reloadedPermissions.body.permissions].sort(), ['ADJUST_STOCK', 'VIEW_AUDIT_TRAIL']);
  const reloadedUsers = await request('/users', {}, admin.cookie);
  const reloadedUser = reloadedUsers.body.find((item: any) => item.id === user.body.id);
  assert.deepEqual(
    { name: reloadedUser.name, username: reloadedUser.username, email: reloadedUser.email, phone: reloadedUser.phone, department: reloadedUser.department, jobTitle: reloadedUser.jobTitle, employeeId: reloadedUser.employeeId },
    { name: 'Flow Senior Cashier', username: 'flow-senior-cashier', email: 'flow-senior-cashier@example.test', phone: '0700000099', department: 'Shop', jobTitle: 'Lead Cashier', employeeId: 'FLOW-99' },
  );

  console.log('Critical user flow regression checks passed.');
} finally {
  await stopServer();
  try { rmSync(testDirectory,{recursive:true,force:true}); } catch { /* Windows may retain a short-lived SQLite handle. */ }
  try { rmSync(runnerDirectory,{recursive:true,force:true}); } catch { /* runner may briefly remain locked */ }
}
