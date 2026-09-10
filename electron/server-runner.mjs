import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const serverPath = process.argv[2];
const port = process.argv[3] || '56726';

if (!serverPath) {
  console.error('[DT-FMS Server Runner] Missing server path.');
  process.exit(1);
}

const absoluteServerPath = path.resolve(projectRoot, serverPath);

console.log(
  '[DT-FMS Server Runner] Starting FMS server through tsx:',
  absoluteServerPath
);

const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    absoluteServerPath,
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: port,
      HOST: '127.0.0.1',
    },
    stdio: 'inherit',
    windowsHide: false,
  }
);

child.on('error', (error) => {
  console.error(
    '[DT-FMS Server Runner] Failed to start FMS server:',
    error
  );
  process.exit(1);
});

child.on('exit', (code, signal) => {
  console.log(
    `[DT-FMS Server Runner] FMS server exited. Code=${code}, signal=${signal}`
  );
  process.exit(code ?? 1);
});

const shutdown = () => {
  if (!child.killed) {
    child.kill();
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);