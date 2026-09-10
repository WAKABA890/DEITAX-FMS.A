import {
  app,
  BrowserWindow,
  dialog,
} from 'electron';

import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

let serverProcess = null;
let mainWindow = null;
let isQuitting = false;

const log = (message, detail) => {
  console.log(
    `[DT-FMS Electron] ${message}`,
    detail ?? ''
  );
};

/**
 * Find an available localhost TCP port.
 */
const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();

    server.on('error', reject);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to determine available port.'));
        return;
      }

      const port = address.port;

      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });

/**
 * Wait until the FMS HTTP server is reachable.
 */
const waitForServer = (port, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const check = () => {
      const socket = net.createConnection({
        host: '127.0.0.1',
        port,
      });

      let settled = false;

      const finish = (error) => {
        if (settled) return;

        settled = true;

        socket.destroy();

        if (!error) {
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(
            new Error(
              `FMS server did not become available on port ${port} within ${timeoutMs}ms.`
            )
          );
          return;
        }

        setTimeout(check, 250);
      };

      socket.once('connect', () => finish(null));
      socket.once('error', () => finish(new Error('not ready')));

      socket.setTimeout(1000, () =>
        finish(new Error('connection timeout'))
      );
    };

    check();
  });

/**
 * Start the FMS server.
 *
 * Development:
 *   Node -> tsx -> server.ts
 *
 * Production:
 *   Node -> dist/server.mjs
 *
 * The server always runs under normal Node.js rather than
 * Electron so better-sqlite3 uses the normal Node native ABI.
 */
const startFmsServer = async () => {
  const port = await getAvailablePort();

  log('Selected FMS server port.', port);

  let serverEntry;
  let args;

  const nodeExecutable =
    process.env.npm_node_execpath || process.execPath;

  if (app.isPackaged) {
    /*
     * Packaged application:
     *
     * Electron resources
     *      ↓
     * dist/server.mjs
     *      ↓
     * better-sqlite3
     */

    serverEntry = path.join(
      process.resourcesPath,
      'app.asar',
      'dist',
      'server.mjs'
    );

    /*
     * electron-builder normally places the application
     * inside app.asar. Node can load JavaScript from there,
     * but native modules are unpacked separately.
     */

    if (!fs.existsSync(serverEntry)) {
      serverEntry = path.join(
        process.resourcesPath,
        'app',
        'dist',
        'server.mjs'
      );
    }

    if (!fs.existsSync(serverEntry)) {
      throw new Error(
        `Packaged FMS server not found. Expected: ${serverEntry}`
      );
    }

    args = [
      serverEntry,
    ];

    log(
      'Starting packaged FMS server.',
      serverEntry
    );
  } else {
    /*
     * Development mode.
     */

    const serverRunner = path.join(
      projectRoot,
      'electron',
      'server-runner.mjs'
    );

    serverEntry = path.join(
      projectRoot,
      'server.ts'
    );

    const tsxCli = path.join(
      projectRoot,
      'node_modules',
      'tsx',
      'dist',
      'cli.mjs'
    );

    if (!fs.existsSync(serverRunner)) {
      throw new Error(
        `Server runner not found: ${serverRunner}`
      );
    }

    if (!fs.existsSync(serverEntry)) {
      throw new Error(
        `FMS server entry not found: ${serverEntry}`
      );
    }

    if (!fs.existsSync(tsxCli)) {
      throw new Error(
        `tsx CLI not found: ${tsxCli}`
      );
    }

    args = [
      tsxCli,
      serverRunner,
      serverEntry,
      String(port),
    ];

    log(
      'Starting development FMS server.',
      serverEntry
    );
  }

  /*
   * Keep SQLite outside the packaged application.
   *
   * Development:
   *   existing data\fms.db
   *
   * Production:
   *   %APPDATA%\DT-FMS\fms.db
   */
  const databasePath = app.isPackaged
    ? path.join(
        app.getPath('userData'),
        'fms.db'
      )
    : process.env.FMS_DB_PATH || '';

  const environment = {
    ...process.env,

    NODE_ENV: app.isPackaged
      ? 'production'
      : 'development',

    PORT: String(port),

    FMS_SERVER_PORT: String(port),

    HOST: '127.0.0.1',

    FMS_DB_PATH: databasePath,
  };

  log(
    'Node executable.',
    nodeExecutable
  );

  log(
    'Starting FMS Node server process.'
  );

  serverProcess = spawn(
    nodeExecutable,
    args,
    {
      cwd: app.isPackaged
        ? process.resourcesPath
        : projectRoot,

      env: environment,

      stdio: [
        'ignore',
        'pipe',
        'pipe',
      ],

      windowsHide: true,
    }
  );

  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');

  let readyPort = null;

  serverProcess.stdout.on('data', (data) => {
    const text = String(data);

    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      console.log(
        `[DT-FMS Server] ${line}`
      );

      const readyMatch = line.match(
        /\[DT-FMS SERVER READY\]\s+(\d+)/
      );

      const listeningMatch = line.match(
        /DT-FMS Server listening on http:\/\/127\.0\.0\.1:(\d+)/
      );

      if (readyMatch) {
        readyPort = Number(
          readyMatch[1]
        );
      } else if (listeningMatch) {
        readyPort = Number(
          listeningMatch[1]
        );
      }
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const text = String(data);

    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      console.error(
        `[DT-FMS Server] ${line}`
      );
    }
  });

  serverProcess.on('error', (error) => {
    console.error(
      '[DT-FMS Electron] FMS server process error:',
      error
    );
  });

  const processExitPromise = new Promise((resolve) => {
    serverProcess.once(
      'exit',
      (code, signal) => {
        resolve({
          code,
          signal,
        });
      }
    );
  });

  /*
   * Wait for the server to announce its port.
   */
  const startupStarted = Date.now();

  while (!readyPort) {
    const result = await Promise.race([
      processExitPromise,

      new Promise((resolve) =>
        setTimeout(
          () => resolve(null),
          100
        )
      ),
    ]);

    if (result) {
      throw new Error(
        `FMS server exited during startup. Code=${result.code}, signal=${result.signal}`
      );
    }

    if (
      Date.now() - startupStarted >
      30000
    ) {
      throw new Error(
        'Timed out waiting for the FMS server to report its port.'
      );
    }
  }

  await waitForServer(
    readyPort
  );

  log(
    'FMS Node server is ready.',
    `http://127.0.0.1:${readyPort}`
  );

  return {
    port: readyPort,
    process: serverProcess,
  };
};

/**
 * Create Electron window.
 */
const createWindow = async () => {
  try {
    const fmsServer =
      await startFmsServer();

    const appUrl =
      `http://127.0.0.1:${fmsServer.port}`;

    mainWindow =
      new BrowserWindow({
        width: 1440,
        height: 920,

        minWidth: 1024,
        minHeight: 720,

        show: false,

        webPreferences: {
          preload: path.join(
            __dirname,
            'preload.mjs'
          ),

          contextIsolation: true,

          nodeIntegration: false,

          sandbox: true,
        },
      });

    mainWindow.once(
      'ready-to-show',
      () => {
        log(
          'Renderer is ready; displaying the desktop window.'
        );

        mainWindow.show();
      }
    );

    mainWindow.webContents.on(
      'did-fail-load',
      (
        _event,
        errorCode,
        errorDescription,
        validatedURL
      ) => {
        console.error(
          '[DT-FMS Electron] Renderer failed to load.',
          {
            errorCode,
            errorDescription,
            validatedURL,
          }
        );
      }
    );

    mainWindow.webContents.on(
      'render-process-gone',
      (_event, details) => {
        console.error(
          '[DT-FMS Electron] Renderer process exited.',
          details
        );
      }
    );

    log(
      'Loading FMS renderer.',
      appUrl
    );

    await mainWindow.loadURL(
      appUrl
    );

  } catch (error) {
    console.error(
      '[DT-FMS Electron] Unable to start desktop application:',
      error
    );

    await stopFmsServer();

    try {
      await dialog.showMessageBox({
        type: 'error',

        title:
          'DT-FMS Startup Error',

        message:
          'DT-FMS could not start.',

        detail:
          error instanceof Error
            ? error.message
            : String(error),
      });
    } catch {
      // Ignore dialog failure.
    }

    app.quit();
  }
};

/**
 * Stop Node server cleanly.
 */
const stopFmsServer = async () => {
  if (!serverProcess) {
    return;
  }

  const child =
    serverProcess;

  serverProcess = null;

  if (
    child.exitCode !== null
  ) {
    return;
  }

  log(
    'Stopping FMS Node server.'
  );

  await new Promise(
    (resolve) => {
      let finished = false;

      const finish = () => {
        if (finished) {
          return;
        }

        finished = true;

        resolve();
      };

      child.once(
        'exit',
        finish
      );

      try {
        child.kill(
          'SIGTERM'
        );
      } catch (error) {
        console.error(
          '[DT-FMS Electron] Failed to terminate FMS server:',
          error
        );

        finish();
      }

      setTimeout(
        () => {
          if (finished) {
            return;
          }

          try {
            child.kill();
          } catch {
            // Ignore force-kill errors.
          }

          finish();
        },
        5000
      );
    }
  );
};

/*
 * Electron startup.
 */
log(
  'Electron main process starting.'
);

app.whenReady()
  .then(() => {
    log(
      'Electron runtime is ready.'
    );

    return createWindow();
  })
  .catch((error) => {
    console.error(
      '[DT-FMS Electron] Electron startup failure:',
      error
    );

    app.quit();
  });

app.on(
  'window-all-closed',
  () => {
    app.quit();
  }
);

app.on(
  'before-quit',
  (event) => {
    if (isQuitting) {
      return;
    }

    isQuitting = true;

    if (!serverProcess) {
      return;
    }

    event.preventDefault();

    void stopFmsServer()
      .catch((error) => {
        console.error(
          '[DT-FMS Electron] Server shutdown error:',
          error
        );
      })
      .finally(() => {
        app.quit();
      });
  }
);