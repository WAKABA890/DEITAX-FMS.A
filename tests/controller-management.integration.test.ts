import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';

const workspace = process.cwd();
const runnerDirectory = mkdtempSync(path.join(workspace, 'build', 'dt-fms-controller-test-'));
const serverRunner = path.join(runnerDirectory, 'server.mjs');
const validationRunner = path.join(runnerDirectory, 'db-validation.mjs');

buildSync({ entryPoints: [path.join(workspace, 'server.ts')], outfile: serverRunner, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
buildSync({ entryPoints: [path.join(workspace, 'scripts', 'db-validate-target.ts')], outfile: validationRunner, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
process.once('exit', () => rmSync(runnerDirectory, { recursive: true, force: true }));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('controller management API enforces permissions, persistence, redaction and simulator-only testing', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dt-fms-controller-api-'));
  const databasePath = path.join(directory, 'fms.db');
  const port = 3137;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  let server: ReturnType<typeof spawn> | null = null;
  let output = '';

  const start = async () => {
    output = '';
    server = spawn(process.execPath, [serverRunner], {
      cwd: workspace,
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FMS_DB_PATH: databasePath, FMS_STATIC_DIR: path.join(workspace, 'dist'), FMS_SKIP_SEEDING: 'true' },
      stdio: 'pipe',
    });
    server.stdout.on('data', (chunk) => { output += chunk.toString(); });
    server.stderr.on('data', (chunk) => { output += chunk.toString(); });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if ((await fetch(`${baseUrl}/status`)).ok) return; } catch { /* starting */ }
      await delay(100);
    }
    throw new Error(`Server failed to start. ${output}`);
  };

  const stop = async () => {
    if (!server || server.exitCode !== null) return;
    server.kill();
    await Promise.race([new Promise((resolve) => server?.once('exit', resolve)), delay(3000)]);
    server = null;
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

  const controllerInput = (name: string, mode: 'SUCCESS' | 'FAILURE' = 'SUCCESS') => ({
    stationId: 'station-1',
    name,
    controllerType: 'SIMULATOR',
    host: null,
    port: null,
    connectionType: 'SIMULATOR',
    timeoutMs: 5000,
    configuration: { simulatorMode: mode },
    capabilities: ['PUMP_STATUS_READ', 'EQUIPMENT_HEALTH_READ'],
    firmwareVersion: 'sim-1',
  });

  try {
    await start();
    const bootstrap = await request('/users', { method: 'POST', body: JSON.stringify({ name: 'Phase Two Super', username: 'phase2-super', email: 'phase2-super@example.test', phone: '0700000100', pin: '1234' }) });
    assert.equal(bootstrap.response.status, 200);
    const stationDb = new Database(databasePath);
    stationDb.prepare(`INSERT INTO station_settings (id, station_name, tax_pin, address, phone) VALUES (?, ?, ?, ?, ?)`)
      .run('station-1', 'Phase Two Test Station', 'P000000000A', 'Test Address', '0700000000');
    stationDb.close();
    const superLogin = await login('phase2-super', '1234');
    assert.ok(superLogin.cookie);

    const createUser = async (username: string, role: string, pin: string) => {
      const result = await request('/users', { method: 'POST', body: JSON.stringify({ name: username, username, email: `${username}@example.test`, phone: '0700000101', role, pin }) }, superLogin.cookie);
      assert.equal(result.response.status, 200);
      return result.body;
    };
    const admin = await createUser('phase2-admin', 'Admin', '2345');
    const viewer = await createUser('phase2-viewer', 'Normal User', '3456');
    const unauthorized = await createUser('phase2-unauthorized', 'Normal User', '4567');
    await request(`/users/${admin.id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: ['VIEW_AUTOMATION', 'MANAGE_CONTROLLERS', 'VIEW_AUTOMATION_LOGS', 'VIEW_AUDIT_TRAIL'] }) }, superLogin.cookie);
    await request(`/users/${viewer.id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: ['VIEW_AUTOMATION'] }) }, superLogin.cookie);

    const activateLogin=async(identifier:string,assignedPin:string,newPin:string)=>{const initial=await login(identifier,assignedPin);assert.ok(initial.cookie);const changed=await request('/auth/change-pin',{method:'POST',body:JSON.stringify({currentPin:assignedPin,newPin})},initial.cookie);assert.equal(changed.response.status,200);return login(identifier,newPin);};
    const adminLogin = await activateLogin('phase2-admin', '2345','2346');
    const viewerLogin = await activateLogin('phase2-viewer', '3456','3457');
    const unauthorizedLogin = await activateLogin('phase2-unauthorized', '4567','4568');
    assert.equal((await request('/automation/controllers', {}, unauthorizedLogin.cookie)).response.status, 403);
    assert.equal((await request('/automation/controllers', {}, viewerLogin.cookie)).response.status, 200);
    assert.equal((await request('/automation/controllers', { method: 'POST', body: JSON.stringify(controllerInput('Denied')) }, viewerLogin.cookie)).response.status, 403);

    const created = await request('/automation/controllers', { method: 'POST', body: JSON.stringify(controllerInput('Simulator A')) }, adminLogin.cookie);
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'DISABLED');
    assert.equal(created.body.enabled, false);
    assert.equal(created.body.authenticationConfigured, false);
    assert.equal('credentialRef' in created.body, false);
    const controllerId = created.body.id;
    assert.equal((await request(`/automation/controllers/${controllerId}`, {}, viewerLogin.cookie)).response.status, 200);
    assert.equal((await request(`/automation/runtime/${controllerId}/connect`, { method: 'POST' }, viewerLogin.cookie)).response.status, 403);
    const runtimeConnected = await request(`/automation/runtime/${controllerId}/connect`, { method: 'POST' }, adminLogin.cookie);
    assert.equal(runtimeConnected.response.status, 200, JSON.stringify(runtimeConnected.body));
    assert.equal(runtimeConnected.body.runtimeStatus, 'CONNECTED');
    assert.equal(runtimeConnected.body.health.healthy, true);
    assert.equal((await request(`/automation/runtime/${controllerId}/scenario`, { method: 'POST', body: JSON.stringify({ scenario: 'DISPENSING' }) }, adminLogin.cookie)).body.length, 3);
    assert.equal((await request(`/automation/runtime/${controllerId}/disconnect`, { method: 'POST' }, adminLogin.cookie)).body.runtimeStatus, 'DISCONNECTED');

    const duplicate = await request('/automation/controllers', { method: 'POST', body: JSON.stringify(controllerInput('Simulator A')) }, adminLogin.cookie);
    assert.equal(duplicate.response.status, 409);
    const second = await request('/automation/controllers', { method: 'POST', body: JSON.stringify(controllerInput('Simulator B')) }, adminLogin.cookie);
    assert.equal(second.response.status, 201);
    assert.equal((await request('/automation/controllers', {}, adminLogin.cookie)).body.length, 2);

    const invalidHost = await request('/automation/controllers', { method: 'POST', body: JSON.stringify({ ...controllerInput('Bad Host'), controllerType: 'GENERIC', connectionType: 'TCP', host: 'http://unsafe/path', port: 9000, configuration: {} }) }, adminLogin.cookie);
    assert.equal(invalidHost.response.status, 400);
    const invalidPort = await request('/automation/controllers', { method: 'POST', body: JSON.stringify({ ...controllerInput('Bad Port'), controllerType: 'GENERIC', connectionType: 'TCP', host: '192.168.1.10', port: 70000, configuration: {} }) }, adminLogin.cookie);
    assert.equal(invalidPort.response.status, 400);
    const secretAttempt = await request('/automation/controllers', { method: 'POST', body: JSON.stringify({ ...controllerInput('Secret Attempt'), configuration: { password: 'TOP-SECRET-VALUE' } }) }, adminLogin.cookie);
    assert.equal(secretAttempt.response.status, 400);

    const enabled = await request(`/automation/controllers/${controllerId}/enable`, { method: 'POST' }, adminLogin.cookie);
    assert.equal(enabled.body.enabled, true);
    assert.equal(enabled.body.status, 'UNKNOWN');
    const successfulTest = await request(`/automation/controllers/${controllerId}/test`, { method: 'POST' }, adminLogin.cookie);
    assert.equal(successfulTest.response.status, 200);
    assert.equal(successfulTest.body.success, true);
    assert.equal(successfulTest.body.controller.status, 'UNKNOWN', 'A simulator test must not claim a persistent ONLINE connection.');
    assert.ok(successfulTest.body.controller.lastSuccessfulConnectionAt);

    const failedEdit = await request(`/automation/controllers/${controllerId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Simulator A Updated', configuration: { simulatorMode: 'FAILURE' }, timeoutMs: 2500 }) }, adminLogin.cookie);
    assert.equal(failedEdit.response.status, 200);
    assert.equal(failedEdit.body.name, 'Simulator A Updated');
    const failedTest = await request(`/automation/controllers/${controllerId}/test`, { method: 'POST' }, adminLogin.cookie);
    assert.equal(failedTest.response.status, 422);
    assert.equal(failedTest.body.success, false);
    assert.equal((await request('/status')).response.status, 200, 'Simulator failure must not crash core DT-FMS.');
    const disabled = await request(`/automation/controllers/${controllerId}/disable`, { method: 'POST' }, adminLogin.cookie);
    assert.equal(disabled.body.status, 'DISABLED');

    assert.equal((await request(`/automation/controllers/${controllerId}/logs`, {}, viewerLogin.cookie)).response.status, 403);
    const logs = await request(`/automation/controllers/${controllerId}/logs`, {}, adminLogin.cookie);
    assert.equal(logs.response.status, 200);
    assert.ok(logs.body.some((entry: any) => entry.category === 'CONNECTION_TEST'));

    const audits = await request('/audit-logs?page=1&pageSize=100&module=Automation', {}, adminLogin.cookie);
    assert.equal(audits.response.status, 200);
    assert.ok(audits.body.records.some((entry: any) => entry.action === 'AUTOMATION_CONTROLLER_CREATED'));

    const sqlite = new Database(databasePath, { readonly: true });
    const storedText = [
      ...sqlite.prepare('SELECT configuration_json, credential_ref, last_error FROM automation_controllers').all(),
      ...sqlite.prepare('SELECT message, details_json FROM automation_logs').all(),
      ...sqlite.prepare("SELECT details FROM audit_logs WHERE module = 'Automation'").all(),
    ].map((row) => JSON.stringify(row)).join('\n');
    assert.equal(storedText.includes('TOP-SECRET-VALUE'), false);
    sqlite.close();

    await stop();
    await start();
    const afterRestartLogin = await login('phase2-admin', '2346');
    const afterRestart = await request('/automation/controllers', {}, afterRestartLogin.cookie);
    assert.equal(afterRestart.response.status, 200);
    assert.equal(afterRestart.body.length, 2);
    const persisted = afterRestart.body.find((controller: any) => controller.id === controllerId);
    assert.equal(persisted.name, 'Simulator A Updated');
    assert.equal(persisted.timeoutMs, 2500);
    assert.equal(persisted.enabled, false);
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('migration 024 upgrades a Phase 1 controller record without data loss', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dt-fms-controller-migration-'));
  const databasePath = path.join(directory, 'fms.db');
  try {
    const source = new Database(path.join(workspace, 'data', 'fms.db'), { readonly: true });
    await source.backup(databasePath);
    source.close();
    const sqlite = new Database(databasePath);
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(`
      DROP TABLE IF EXISTS automation_controllers_phase1;
      CREATE TABLE automation_controllers_phase1 (
        id TEXT PRIMARY KEY, station_id TEXT NOT NULL, name TEXT NOT NULL,
        adapter_type TEXT NOT NULL, host TEXT, port INTEGER,
        connection_type TEXT NOT NULL DEFAULT 'TCP', credential_ref TEXT,
        configuration_json TEXT, status TEXT NOT NULL DEFAULT 'DISABLED',
        enabled INTEGER NOT NULL DEFAULT 0, last_communication_at TEXT,
        firmware_version TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(station_id) REFERENCES station_settings(id)
      );
      INSERT INTO automation_controllers_phase1(id,station_id,name,adapter_type,host,port,connection_type,credential_ref,configuration_json,status,enabled,last_communication_at,firmware_version,created_at,updated_at)
        SELECT id,station_id,name,adapter_type,host,port,connection_type,credential_ref,configuration_json,status,enabled,last_communication_at,firmware_version,created_at,updated_at FROM automation_controllers;
      INSERT INTO automation_controllers_phase1 (
        id, station_id, name, adapter_type, connection_type, configuration_json, status, enabled
      ) VALUES ('phase1-controller', 'station-1', 'Preserved Phase 1', 'SIMULATOR', 'SIMULATOR', '{"simulatorMode":"SUCCESS"}', 'DISABLED', 0);
      DROP TABLE automation_controllers;
      ALTER TABLE automation_controllers_phase1 RENAME TO automation_controllers;
      CREATE UNIQUE INDEX idx_automation_controllers_station_name ON automation_controllers(station_id, name);
      CREATE INDEX idx_automation_controllers_station_enabled ON automation_controllers(station_id, enabled);
      DELETE FROM schema_migrations WHERE migration_name = '024_expand_controller_management';
    `);
    sqlite.close();

    const result = spawnSync(process.execPath, [validationRunner], {
      cwd: workspace,
      env: { ...process.env, FMS_DB_PATH: databasePath, FMS_SKIP_SEEDING: 'true' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const upgraded = new Database(databasePath, { readonly: true });
    const controller = upgraded.prepare(`SELECT name, timeout_ms, status, enabled, capabilities_json FROM automation_controllers WHERE id = 'phase1-controller'`).get() as any;
    const foreignKeyViolations = upgraded.pragma('foreign_key_check').length;
    upgraded.close();
    assert.deepEqual(controller, { name: 'Preserved Phase 1', timeout_ms: 5000, status: 'DISABLED', enabled: 0, capabilities_json: '[]' });
    assert.equal(foreignKeyViolations, 0);
  } finally {
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* Windows can briefly retain SQLite handles. */ }
  }
});
