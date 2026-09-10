import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import electronPath from 'electron';
import { buildSync } from 'esbuild';

const runnerDirectory = mkdtempSync(path.join(process.cwd(), 'build', 'dt-fms-db-validation-'));
const runnerPath = path.join(runnerDirectory, 'db-validate.mjs');

try {
  buildSync({
    entryPoints: [path.join(process.cwd(), 'scripts', 'db-validate.ts')],
    outfile: runnerPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  });

  const result = spawnSync(electronPath, [runnerPath], {
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(runnerDirectory, { recursive: true, force: true });
}

