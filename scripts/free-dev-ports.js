import { execFileSync } from 'node:child_process';

const backendPort = Number(process.env.PORT) || 3001;
const hmrPort = Number(process.env.VITE_HMR_PORT) || 24678;
const projectRoot = 'C:\\Users\\berna\\NEW FMS';
const ports = [...new Set([backendPort, hmrPort].filter((port) => Number.isInteger(port)))];

function runPowerShell(command) {
  try {
    return execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8' }
    ).trim();
  } catch (error) {
    return '';
  }
}

function getPidsForPort(port) {
  const output = runPowerShell('netstat -ano -p tcp');
  if (!output) return [];

  const matches = new Set();
  const target = String(port);

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/LISTENING/i.test(trimmed)) continue;

    const pidMatch = trimmed.match(/\b(\d+)\s*$/);
    if (!pidMatch) continue;

    const pid = Number(pidMatch[1]);
    if (!Number.isFinite(pid) || pid <= 0) continue;

    const local = trimmed.replace(/\s+LISTENING\s+\d+\s*$/, '').trim();
    const parts = local.split(/\s+/);
    const localAddress = parts[1] || '';
    const normalizedAddress = String(localAddress).trim();
    const localPort = normalizedAddress.includes(':')
      ? normalizedAddress.split(':').pop()
      : normalizedAddress;

    if (localPort === target) {
      matches.add(pid);
    }
  }

  return [...matches];
}

function getProcessInfo(pid) {
  const name = runPowerShell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty Name -ErrorAction SilentlyContinue) 2>$null`);
  const commandLine = runPowerShell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine -ErrorAction SilentlyContinue) 2>$null`);
  const executablePath = runPowerShell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty ExecutablePath -ErrorAction SilentlyContinue) 2>$null`);

  return {
    name: String(name || ''),
    commandLine: String(commandLine || ''),
    executablePath: String(executablePath || ''),
  };
}

function normalizeProcessString(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/%20/g, ' ')
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProjectOwnedProcess(pid) {
  const { name, commandLine, executablePath } = getProcessInfo(pid);
  const normalizedName = String(name || '').toLowerCase();
  const candidates = [commandLine, executablePath, name]
    .map((value) => normalizeProcessString(value))
    .join(' ');
  const projectRootNormalized = normalizeProcessString(projectRoot);
  const projectMarkers = [
    projectRootNormalized,
    'node_modules/tsx',
    'node_modules/vite',
    'node_modules/@esbuild',
    'new fms',
    'tsx',
    'vite',
    'server.ts',
  ];

  const hasProjectMarker = projectMarkers.some((marker) => marker && candidates.includes(marker));
  const isBlankNodeListener = normalizedName === 'node.exe' && !commandLine && !executablePath;
  const isRelevantNodeProcess = normalizedName === 'node.exe' && (
    candidates.includes('node_modules/tsx') ||
    candidates.includes('node_modules/vite') ||
    candidates.includes('server.ts') ||
    candidates.includes(projectRootNormalized)
  );

  return hasProjectMarker || isBlankNodeListener || isRelevantNodeProcess;
}

function terminatePid(pid) {
  if (!pid) return false;

  const commands = [
    ['taskkill', ['/PID', String(pid), '/T', '/F']],
    ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]],
    ['wmic', ['process', 'where', `processid=${pid}`, 'delete']],
  ];

  for (const [command, args] of commands) {
    try {
      execFileSync(command, args, { stdio: 'ignore' });
      return true;
    } catch (error) {
      // Continue to the next cleanup fallback.
    }
  }

  return false;
}

async function waitForPortToClear(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (getPidsForPort(port).length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return getPidsForPort(port).length === 0;
}

async function cleanup() {
  const portPids = new Map();
  for (const port of ports) {
    portPids.set(port, getPidsForPort(port));
  }

  const targets = [...new Set(
    ports.flatMap((port) => portPids.get(port) || [])
  )].filter((pid) => isProjectOwnedProcess(pid));

  if (targets.length === 0) {
    for (const port of ports) {
      const occupantCount = portPids.get(port)?.length ?? 0;
      if (occupantCount > 0) {
        console.error(`Port ${port} is occupied by a process that is not owned by this project. Refusing to kill unrelated processes.`);
        process.exit(1);
      }
      console.log(`Port ${port} is already free.`);
    }
    return;
  }

  for (const pid of targets) {
    console.log(`Cleaning stale development process (PID ${pid})...`);
    if (!terminatePid(pid)) {
      console.error(`Failed to terminate stale development process PID ${pid}.`);
      process.exit(1);
    }
  }

  for (const port of ports) {
    const cleared = await waitForPortToClear(port);
    if (!cleared) {
      console.error(`❌ Port ${port} is still occupied after cleanup. Manual intervention is required.`);
      process.exit(1);
    }
    console.log(`Port ${port} is free and ready.`);
  }
}

cleanup().catch((error) => {
  console.error('Development port cleanup failed:', error);
  process.exit(1);
});
