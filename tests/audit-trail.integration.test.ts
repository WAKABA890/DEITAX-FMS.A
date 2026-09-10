import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {buildSync} from 'esbuild';

const port = 3122;
const testDirectory=mkdtempSync(path.join(tmpdir(),'dt-fms-audit-'));
const runnerDirectory=mkdtempSync(path.join(process.cwd(),'build','audit-runner-'));
const databasePath = path.join(testDirectory, `audit-trail-${randomUUID()}.db`);
const serverRunner=path.join(runnerDirectory,'server.mjs');
buildSync({entryPoints:[path.join(process.cwd(),'server.ts')],outfile:serverRunner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const baseUrl = `http://localhost:${port}/api`;
if (existsSync(databasePath)) rmSync(databasePath);

let server: ReturnType<typeof spawn>;
let output = '';
server = spawn(process.execPath, [serverRunner], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), VITE_HMR_PORT: '24722', FMS_DB_PATH: databasePath, DISABLE_HMR: 'true' },
  stdio: 'pipe',
});
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/status`)).ok) return;
    } catch {
      // The temporary integration server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Audit trail integration server did not start. ${output}`);
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
  assert.equal(result.response.status, 200);
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return { user: result.body.user, cookie };
};

try {
  await waitForServer();
  const bootstrap = await request('/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Audit Admin', email: 'audit-admin@example.test', phone: '0700000000', pin: '1234' }),
  });
  assert.equal(bootstrap.response.status, 200);
  const admin = await login('audit-admin@example.test', '1234');

  const stockItem = await request('/shop', {
    method: 'POST',
    body: JSON.stringify({ name: 'Audit Water', code: 'AUDIT-SHOP', category: 'Drinks', unitPrice: 50, costPrice: 30, stockQty: 20, reorderLevel: 5 }),
  }, admin.cookie);
  assert.equal(stockItem.response.status, 200);

  let resetTargetId = '';
  for (let index = 0; index < 16; index += 1) {
    const user = await request('/users', {
      method: 'POST',
      body: JSON.stringify({ name: `Audit User ${index}`, email: `audit-user-${index}@example.test`, phone: `07000000${String(index).padStart(2, '0')}`, role: 'Cashier', pin: '5678' }),
    }, admin.cookie);
    assert.equal(user.response.status, 200);
    if (index === 0) resetTargetId = user.body.id;
  }

  const reset = await request(`/users/${resetTargetId}/reset-pin`, { method: 'POST', body: JSON.stringify({ newPin: '6789' }) }, admin.cookie);
  assert.equal(reset.response.status, 200);
  const adjustment = await request('/stock/adjustments', {
    method: 'POST',
    body: JSON.stringify({ type: 'Shop', itemId: stockItem.body.id, newQty: 24, reason: 'Audit pagination verification' }),
  }, admin.cookie);
  assert.equal(adjustment.response.status, 200);

  const firstPage = await request('/audit-logs?page=1&pageSize=15', {}, admin.cookie);
  const secondPage = await request('/audit-logs?page=2&pageSize=15', {}, admin.cookie);
  assert.equal(firstPage.response.status, 200);
  assert.equal(secondPage.response.status, 200);
  assert.equal(firstPage.body.pageSize, 15);
  assert.equal(firstPage.body.records.length, 15);
  assert.ok(secondPage.body.records.length > 0);
  assert.equal(firstPage.body.total, 21);
  assert.equal(firstPage.body.totalPages, 2);
  assert.equal(new Set([...firstPage.body.records, ...secondPage.body.records].map((record: any) => record.id)).size, 21, 'Pages must not overlap or omit records.');
  assert.ok(firstPage.body.records.every((record: any) => typeof record.userName === 'string' && typeof record.details === 'string'), 'Audit API must return frontend field names.');
  assert.ok(firstPage.body.records.some((record: any) => record.action === 'USER_PASSWORD_RESET'));
  assert.ok([...firstPage.body.records, ...secondPage.body.records].some((record: any) => record.action === 'STOCK_ADJUSTMENT_LOGGED'));

  const filtered = await request('/audit-logs?page=1&pageSize=15&search=STOCK_ADJUSTMENT_LOGGED&module=Stock', {}, admin.cookie);
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.body.total, 1, JSON.stringify(filtered.body));
  assert.equal(filtered.body.records[0].action, 'STOCK_ADJUSTMENT_LOGGED');

  const stockPage = await request('/stock/adjustments?page=1&pageSize=15', {}, admin.cookie);
  assert.equal(stockPage.response.status, 200);
  assert.equal(stockPage.body.pageSize, 15);
  assert.equal(stockPage.body.records.length, 1);
  assert.deepEqual(
    { previousQty: stockPage.body.records[0].previousQty, adjustedQty: stockPage.body.records[0].adjustedQty, differenceQty: stockPage.body.records[0].differenceQty, movementType: stockPage.body.records[0].movementType },
    { previousQty: 20, adjustedQty: 24, differenceQty: 4, movementType: 'Stock Increase' },
  );
  assert.ok(Number.isFinite(Date.parse(stockPage.body.records[0].timestamp)));

  for (const endpoint of ['/audit-logs/immutable', '/stock/adjustments/immutable']) {
    for (const method of ['PATCH', 'DELETE']) {
      const result = await request(endpoint, { method, body: JSON.stringify({ details: 'tamper' }) }, admin.cookie);
      assert.ok([404, 405].includes(result.response.status), `${method} ${endpoint} must reject audit history mutation.`);
    }
  }

  const sqlite = new Database(databasePath, { readonly: true });
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'USER_PASSWORD_RESET'").get() as { count: number }).count, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'STOCK_ADJUSTMENT_LOGGED'").get() as { count: number }).count, 1);
  sqlite.close();
  console.log('Audit trail integration checks passed.');
} finally {
  if(server&&server.exitCode===null){const exited=new Promise<void>(resolve=>server.once('exit',()=>resolve()));server.kill('SIGTERM');await Promise.race([exited,new Promise<void>(resolve=>setTimeout(resolve,5000))]);}
  try { rmSync(testDirectory,{recursive:true,force:true}); } catch { /* Windows may retain a SQLite handle briefly. */ }
  try { rmSync(runnerDirectory,{recursive:true,force:true}); } catch {}
}
