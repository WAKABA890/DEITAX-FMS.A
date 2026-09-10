import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';

const port = 3118;
const databasePath = path.join(process.cwd(), 'data', `authentication-integration-${randomUUID()}.db`);
const baseUrl = `http://localhost:${port}/api`;
const runnerDirectory=mkdtempSync(path.join(process.cwd(),'build','dt-fms-auth-runner-'));const serverRunner=path.join(runnerDirectory,'server.mjs');buildSync({entryPoints:[path.join(process.cwd(),'server.ts')],outfile:serverRunner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
if (existsSync(databasePath)) rmSync(databasePath);

let server: ReturnType<typeof spawn>;
let output = '';
server = spawn(process.execPath, [serverRunner], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), VITE_HMR_PORT: '24718', FMS_DB_PATH: databasePath, DISABLE_HMR: 'true' },
  stdio: 'pipe',
});
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/status`)).ok) return;
    } catch {
      // The test server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Authentication integration server did not start. ${output}`);
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
  return { ...result, cookie: result.response.headers.get('set-cookie')?.split(';')[0] };
};

try {
  await waitForServer();
  for (const endpoint of ['/audit-logs', '/reading-variances', '/shifts', '/users', '/stock/adjustments']) {
    assert.equal((await request(endpoint)).response.status, 401, `${endpoint} must require authentication.`);
  }
  const bootstrap = await request('/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Authentication Admin', email: 'auth-admin@example.test', phone: '0700000000', pin: '1234' }),
  });
  assert.equal(bootstrap.response.status, 200);
  assert.equal('pin' in bootstrap.body, false, 'User creation must not return a credential.');

  const legacyDatabase = new Database(databasePath);
  legacyDatabase.prepare(`INSERT INTO users (id, name, email, phone, role, pin, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)`).run('legacy-auth-user', 'Legacy Authentication User', 'legacy-auth@example.test', '0700000002', 'Normal User', '2468');
  legacyDatabase.close();
  const legacyLogin = await login('legacy-auth@example.test', '2468');
  assert.equal(legacyLogin.response.status, 200, 'A valid legacy credential must remain usable.');
  const upgradedLegacyDatabase = new Database(databasePath, { readonly: true });
  assert.ok((upgradedLegacyDatabase.prepare('SELECT pin FROM users WHERE id = ?').get('legacy-auth-user') as { pin: string }).pin.startsWith('scrypt$'), 'Legacy credential must upgrade after successful verification.');
  upgradedLegacyDatabase.close();

  const adminLogin = await login('  AUTH-ADMIN@EXAMPLE.TEST  ', '1234');
  assert.equal(adminLogin.response.status, 200);
  assert.ok(adminLogin.cookie, 'Successful login must set a session cookie.');
  assert.equal('pin' in adminLogin.body.user, false, 'Login must not return a credential.');
  assert.equal(adminLogin.body.user.role, 'Super Admin');

  const invalidPin = await login('auth-admin@example.test', '1235');
  assert.equal(invalidPin.response.status, 401);
  const unknownUser = await login('missing@example.test', '1234');
  assert.equal(unknownUser.response.status, 401);
  assert.equal(invalidPin.body.message, unknownUser.body.message, 'Authentication failures must not enumerate accounts.');
  const whitespacePin = await login('auth-admin@example.test', ' 1234');
  assert.equal(whitespacePin.response.status, 401, 'PIN whitespace must not be silently altered.');

  const userList = await request('/users', {}, adminLogin.cookie);
  assert.equal(userList.response.status, 200);
  const normalUser = await request('/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Authentication Normal', username: 'auth-normal', email: 'auth-normal@example.test', phone: '0700000001', role: 'Normal User', pin: '5678' }),
  }, adminLogin.cookie);
  assert.equal(normalUser.response.status, 200);
  const normalLogin = await login(' auth-normal ', '5678');
  assert.equal(normalLogin.response.status, 200);
  assert.deepEqual(normalLogin.body.user.permissions, []);
  assert.equal(normalLogin.body.user.mustChangePassword,true);
  const forcedGate=await request('/users',{},normalLogin.cookie);assert.equal(forcedGate.response.status,403);assert.equal(forcedGate.body.code,'PASSWORD_CHANGE_REQUIRED');
  const initialChange=await request('/auth/change-pin',{method:'POST',body:JSON.stringify({currentPin:'5678',newPin:'5680'})},normalLogin.cookie);assert.equal(initialChange.response.status,200);
  assert.equal((await login('auth-normal','5678')).response.status,401);
  const normalAfterChange=await login('auth-normal','5680');assert.equal(normalAfterChange.body.user.mustChangePassword,false);
  const normalAudit = await request('/audit-logs', {}, normalAfterChange.cookie);
  assert.equal(normalAudit.response.status, 403);

  const permissions = await request(`/users/${normalLogin.body.user.id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions: ['VIEW_AUDIT_TRAIL'] }),
  }, adminLogin.cookie);
  assert.equal(permissions.response.status, 200);
  const delegatedLogin = await login('auth-normal@example.test', '5680');
  assert.deepEqual(delegatedLogin.body.user.permissions, ['VIEW_AUDIT_TRAIL']);
  assert.equal((await request('/audit-logs', {}, delegatedLogin.cookie)).response.status, 200);
  assert.equal((await request('/reading-variances', {}, delegatedLogin.cookie)).response.status, 403);

  const reset = await request(`/users/${normalLogin.body.user.id}/reset-pin`, {
    method: 'POST',
    body: JSON.stringify({ newPin: '6789' }),
  }, adminLogin.cookie);
  assert.equal(reset.response.status, 200);
  assert.equal('pin' in reset.body, false);
  assert.equal((await request('/audit-logs', {}, delegatedLogin.cookie)).response.status, 401, 'Reset must invalidate sessions for the target user.');
  assert.equal((await login('auth-normal@example.test', '5678')).response.status, 401);
  const resetCredentialLogin = await login('auth-normal@example.test', '6789');
  assert.equal(resetCredentialLogin.response.status, 200);
  const selfChange = await request('/auth/change-pin', {
    method: 'POST',
    body: JSON.stringify({ currentPin: '6789', newPin: '7890' }),
  }, resetCredentialLogin.cookie);
  assert.equal(selfChange.response.status, 200);
  assert.equal((await login('auth-normal@example.test', '6789')).response.status, 401);
  assert.equal((await login('auth-normal@example.test', '7890')).response.status, 200);

  const logout = await request('/auth/logout', { method: 'POST' }, adminLogin.cookie);
  assert.equal(logout.response.status, 200);
  assert.equal((await request('/users', {}, adminLogin.cookie)).response.status, 401);

  const sqlite = new Database(databasePath, { readonly: true });
  const storedCredential = sqlite.prepare('SELECT pin FROM users WHERE email = ?').get('auth-admin@example.test') as { pin: string };
  assert.ok(storedCredential.pin.startsWith('scrypt$'), 'New credentials must be stored as scrypt hashes.');
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'USER_PASSWORD_RESET'`).get() as { count: number }).count, 1);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'USER_PASSWORD_CHANGED'`).get() as { count: number }).count, 2);
  sqlite.close();
  console.log('Authentication integration checks passed.');
} finally {
  server?.kill();
  try { if (existsSync(databasePath)) rmSync(databasePath); } catch { /* Windows may retain a short-lived SQLite handle. */ }
  try { rmSync(runnerDirectory,{recursive:true,force:true}); } catch {}
}
