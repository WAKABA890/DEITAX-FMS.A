import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';

const root = process.cwd();
const runnerDir = mkdtempSync(path.join(root, 'build', 'roles-test-'));
const runner = path.join(runnerDir, 'server.mjs');
buildSync({ entryPoints: [path.join(root, 'server.ts')], outfile: runner, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
process.once('exit', () => { try { rmSync(runnerDir, { recursive: true, force: true }); } catch {} });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('custom roles persist/inherit permissions and shift history is newest first', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dt-fms-role-history-'));
  const databasePath = path.join(directory, 'fms.db');
  const port = 3152;
  const base = `http://127.0.0.1:${port}/api`;
  let server: ReturnType<typeof spawn> | null = null;
  const request = async (url: string, options: RequestInit = {}, cookie?: string) => {
    const response = await fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
    return { response, body: await response.json().catch(() => null) };
  };
  try {
    server = spawn(process.execPath, [runner], { cwd: root, env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FMS_DB_PATH: databasePath, FMS_SKIP_SEEDING: 'true', FMS_STATIC_DIR: path.join(root, 'dist') }, stdio: 'pipe' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/status')).ok) break; } catch {} await delay(100); }
    await request('/users', { method: 'POST', body: JSON.stringify({ name: 'Role Super', username: 'role-super', email: 'role@test.local', phone: '0700', pin: '1234' }) });
    const login = await request('/auth/verify-pin', { method: 'POST', body: JSON.stringify({ identifier: 'role-super', pin: '1234' }) });
    const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const role = await request('/roles', { method: 'POST', body: JSON.stringify({ name: 'Shift Supervisor', description: 'Custom role', permissions: ['VIEW_SHIFT_USERS', 'VIEW_REPORTS'] }) }, cookie);
    assert.equal(role.response.status, 201, JSON.stringify(role.body));
    const user = await request('/users', { method: 'POST', body: JSON.stringify({ name: 'Custom User', username: 'custom-user', email: 'custom@test.local', phone: '0701', pin: '2345', role: 'Shift Supervisor' }) }, cookie);
    assert.equal(user.response.status, 200, JSON.stringify(user.body));
    assert.ok(user.body.permissions.includes('VIEW_SHIFT_USERS'));
    const admin = await request('/users', { method: 'POST', body: JSON.stringify({ name: 'Approval Admin', username: 'approval-admin', email: 'approval-admin@test.local', phone: '0702', pin: '3456', role: 'Admin' }) }, cookie);
    assert.equal(admin.response.status, 200, JSON.stringify(admin.body));
    const db = new Database(databasePath);
    const insert = db.prepare(`INSERT INTO shifts(id,staff_id,staff_name,staff_role,shift_type,date,start_time,end_time,status,opening_cash,closing_cash) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('older', user.body.id, 'Custom User', 'Shift Supervisor', 'Day', '2026-08-01', '2026-08-01T08:00:00.000Z', '2026-08-01T16:00:00.000Z', 'Completed', 0,0);
    insert.run('latest', user.body.id, 'Custom User', 'Shift Supervisor', 'Day', '2026-08-30', '2026-08-30T08:00:00.000Z', '2026-08-30T16:00:00.000Z', 'Completed', 0,0);
    insert.run('bulk-shift', user.body.id, 'Custom User', 'Shift Supervisor', 'Day', '2026-08-31', '2026-08-31T08:00:00.000Z', '2026-08-31T16:00:00.000Z', 'Pending Approval', 0,0);
    db.prepare(`INSERT INTO reconciliations(id,date,shift_id,staff_id,staff_name,cash_expected,cash_actual,cash_variance,status) VALUES('rec-latest','2026-08-30','latest',?,?,3000,2500,-500,'Approved')`).run(user.body.id,'Custom User');
    db.prepare(`INSERT INTO reconciliations(id,date,shift_id,staff_id,staff_name,cash_expected,cash_actual,cash_variance,status) VALUES('rec-bulk','2026-08-31','bulk-shift',?,?,1000,900,-100,'Pending Approval')`).run(user.body.id,'Custom User');
    const insertApproval = db.prepare(`INSERT INTO manager_approvals(id,timestamp,type,requested_by,reason,amount_or_qty,status) VALUES(?,?,?,?,?,?,'Pending')`);
    insertApproval.run('approval-super', '2026-08-30T17:00:00.000Z', 'Cash Variance', user.body.id, 'Super Admin authorization test', 'KES 500');
    insertApproval.run('approval-admin', '2026-08-30T17:01:00.000Z', 'Cash Variance', user.body.id, 'Admin authorization test', 'KES 500');
    db.prepare(`INSERT INTO manager_approvals(id,timestamp,shift_id,type,requested_by,reason,amount_or_qty,status,review_scope) VALUES(?,?,?,?,?,?,?,'Pending','SHIFT')`).run('bulk-shift-review', '2026-08-31T17:00:00.000Z', 'bulk-shift', 'Shift Variance Review', user.body.id, 'Bulk shift review', 'KES 100');
    db.prepare(`INSERT INTO manager_approvals(id,timestamp,shift_id,type,requested_by,reason,amount_or_qty,status) VALUES(?,?,?,?,?,?,?,'Pending')`).run('bulk-fuel-review', '2026-08-31T17:01:00.000Z', 'bulk-shift', 'Fuel Discrepancy', user.body.id, 'Bulk fuel review', '10 L');
    db.close();
    server.kill(); await new Promise(resolve => server?.once('exit', resolve));
    server = spawn(process.execPath, [runner], { cwd: root, env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FMS_DB_PATH: databasePath, FMS_SKIP_SEEDING: 'true', FMS_STATIC_DIR: path.join(root, 'dist') }, stdio: 'pipe' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/status')).ok) break; } catch {} await delay(100); }
    const relogin=await request('/auth/verify-pin',{method:'POST',body:JSON.stringify({identifier:'role-super',pin:'1234'})});
    const cookieAfterRestart=relogin.response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookieAfterRestart);
    const approvalsForSuper = await request('/approvals', {}, cookieAfterRestart);
    assert.equal(approvalsForSuper.response.status, 200, JSON.stringify(approvalsForSuper.body));
    const superResolution = await request('/approvals/resolve', {method:'POST',body:JSON.stringify({approvalId:'approval-super',action:'Approved',managerId:relogin.body.user.id,managerName:relogin.body.user.name,managerPin:'1234',notes:'Approved by Super Admin'})}, cookieAfterRestart);
    assert.equal(superResolution.response.status, 200, JSON.stringify(superResolution.body));
    const bulkResolution = await request('/approvals/bulk-resolve', {method:'POST',body:JSON.stringify({approvalIds:['bulk-fuel-review','bulk-shift-review'],action:'Approved',managerId:relogin.body.user.id,managerName:relogin.body.user.name,managerPin:'1234',notes:'Approved together after manager review.'})}, cookieAfterRestart);
    assert.equal(bulkResolution.response.status, 200, JSON.stringify(bulkResolution.body));
    assert.equal(bulkResolution.body.resolved.length, 2);
    assert.deepEqual(bulkResolution.body.affectedShiftIds, ['bulk-shift']);
    const bulkLedger = (await request('/reconciliations', {}, cookieAfterRestart)).body.find((record:any)=>record.shiftId==='bulk-shift');
    assert.equal(bulkLedger.status, 'Approved');
    const bulkAuditPage = await request('/audit-logs?page=1&pageSize=100', {}, cookieAfterRestart);
    assert.equal(bulkAuditPage.response.status, 200, JSON.stringify(bulkAuditPage.body));
    const bulkAudit = bulkAuditPage.body.records.find((record:any) => record.action === 'BULK_APPROVAL_APPROVED');
    assert.equal(bulkAudit.details, 'Bulk approved 2 approval records.');
    assert.doesNotMatch(bulkAudit.details, /bulk-fuel-review|bulk-shift-review/);
    const adminLogin=await request('/auth/verify-pin',{method:'POST',body:JSON.stringify({identifier:'approval-admin',pin:'3456'})});
    let adminCookie=adminLogin.response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(adminCookie);
    const adminFirstLoginReset=await request('/auth/change-pin',{method:'POST',body:JSON.stringify({currentPin:'3456',newPin:'3457'})},adminCookie);
    assert.equal(adminFirstLoginReset.response.status,200,JSON.stringify(adminFirstLoginReset.body));
    const adminRelogin=await request('/auth/verify-pin',{method:'POST',body:JSON.stringify({identifier:'approval-admin',pin:'3457'})});
    adminCookie=adminRelogin.response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(adminCookie);
    const impersonationAttempt = await request('/approvals/resolve', {method:'POST',body:JSON.stringify({approvalId:'approval-admin',action:'Rejected',managerId:relogin.body.user.id,managerName:relogin.body.user.name,managerPin:'1234',notes:'Wrong identity'})}, adminCookie);
    assert.equal(impersonationAttempt.response.status, 403);
    const adminResolution = await request('/approvals/resolve', {method:'POST',body:JSON.stringify({approvalId:'approval-admin',action:'Rejected',managerId:admin.body.id,managerName:admin.body.name,managerPin:'3457',notes:'Rejected by Admin'})}, adminCookie);
    assert.equal(adminResolution.response.status, 200, JSON.stringify(adminResolution.body));
    const shiftHistory=(await request('/shifts', {}, cookieAfterRestart)).body;
    assert.equal(shiftHistory[0].id, 'bulk-shift');
    const latestShift=shiftHistory.find((shift:any)=>shift.id==='latest');
    assert.equal(latestShift.actualCashCount,2500);
    assert.equal(latestShift.cashVariance,-500);
    server.kill(); await new Promise(resolve => server?.once('exit', resolve)); server = null;
    const persisted = new Database(databasePath, { readonly: true });
    assert.equal((persisted.prepare(`SELECT COUNT(*) count FROM custom_roles WHERE name='Shift Supervisor'`).get() as any).count, 1);
    assert.equal((persisted.prepare(`SELECT status FROM manager_approvals WHERE id='approval-super'`).get() as any).status, 'Approved');
    assert.equal((persisted.prepare(`SELECT status FROM manager_approvals WHERE id='approval-admin'`).get() as any).status, 'Rejected');
    assert.equal((persisted.prepare(`SELECT status FROM manager_approvals WHERE id='bulk-shift-review'`).get() as any).status, 'Approved');
    assert.equal((persisted.prepare(`SELECT status FROM manager_approvals WHERE id='bulk-fuel-review'`).get() as any).status, 'Approved');
    assert.equal((persisted.prepare(`SELECT status FROM reconciliations WHERE id='rec-bulk'`).get() as any).status, 'Approved');
    assert.equal((persisted.prepare(`SELECT status FROM shifts WHERE id='bulk-shift'`).get() as any).status, 'Completed');
    assert.equal(persisted.pragma('foreign_key_check').length, 0); persisted.close();
  } finally {
    if (server && server.exitCode === null) server.kill();
    try { rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});
