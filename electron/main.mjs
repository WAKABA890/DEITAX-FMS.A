import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
} from 'electron';

import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const projectRoot = path.resolve(
  __dirname,
  '..'
);

// Keep the Automated Station edition completely separate from the legacy
// Deitax Fms.A desktop profile. This controls Electron's default userData folder,
// where this edition stores its own fms.db and startup log.
app.setName('Deitax Fms.A');

// Supports isolated production-startup verification without touching the
// operator's normal Electron profile or database. Normal launches are
// unchanged because the override is opt-in.
const userDataOverride = String(process.env.FMS_USER_DATA_PATH || '').trim();
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride));

let serverProcess = null;
let mainWindow = null;
let isQuitting = false;
const startupLogLines = [];

const writeStartupLog = (line) => {
  startupLogLines.push(`${new Date().toISOString()} ${line}`);
  if (startupLogLines.length > 500) startupLogLines.shift();

  if (!app.isReady()) return;

  try {
    const logPath = path.join(app.getPath('userData'), 'startup.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, `${startupLogLines.join('\n')}\n`, 'utf8');
  } catch {
    // Console logging remains available if the user-data directory is unavailable.
  }
};

const log = (message, detail) => {
  writeStartupLog(`[DEITAX FMS.A Electron] ${message}${detail === undefined ? '' : ` ${String(detail)}`}`);
  console.log(
    `[DEITAX FMS.A Electron] ${message}`,
    detail ?? ''
  );
};

/**
 * --------------------------------------------------
 * FIND AVAILABLE PORT
 * --------------------------------------------------
 */

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();

    server.on(
      'error',
      reject
    );

    server.listen(
      0,
      '127.0.0.1',
      () => {
        const address = server.address();

        if (
          !address ||
          typeof address === 'string'
        ) {
          server.close();

          reject(
            new Error(
              'Unable to determine available port.'
            )
          );

          return;
        }

        const port = address.port;

        server.close(
          (error) => {
            if (error) {
              reject(error);
            } else {
              resolve(port);
            }
          }
        );
      }
    );
  });

/**
 * --------------------------------------------------
 * WAIT FOR SERVER
 * --------------------------------------------------
 */

const waitForServer = (
  port,
  timeoutMs = 30000
) =>
  new Promise(
    (resolve, reject) => {
      const startedAt = Date.now();

      const check = () => {
        const socket =
          net.createConnection({
            host: '127.0.0.1',
            port,
          });

        let settled = false;

        const finish = (error) => {
          if (settled) {
            return;
          }

          settled = true;

          socket.destroy();

          if (!error) {
            resolve();
            return;
          }

          if (
            Date.now() - startedAt >=
            timeoutMs
          ) {
            reject(
              new Error(
                `FMS server did not become available on port ${port} within ${timeoutMs}ms.`
              )
            );

            return;
          }

          setTimeout(
            check,
            250
          );
        };

        socket.once(
          'connect',
          () => finish(null)
        );

        socket.once(
          'error',
          () =>
            finish(
              new Error(
                'not ready'
              )
            )
        );

        socket.setTimeout(
          1000,
          () =>
            finish(
              new Error(
                'connection timeout'
              )
            )
        );
      };

      check();
    }
  );

/**
 * --------------------------------------------------
 * START FMS SERVER
 * --------------------------------------------------
 */

const startFmsServer =
  async () => {

    const port =
      await getAvailablePort();

    log(
      'Selected FMS server port.',
      port
    );

    let serverEntry;
    let args;

    const isPackaged =
      app.isPackaged;

    /**
     * --------------------------------------------------
     * NODE EXECUTABLE
     * --------------------------------------------------
     *
     * Development:
     * use normal Node executable.
     *
     * Packaged:
     * Electron itself is used as the executable.
     *
     * ELECTRON_RUN_AS_NODE=1 makes Electron behave
     * like Node for the FMS server process.
     */

    const nodeExecutable =
      process.env.npm_node_execpath ||
      process.execPath;

    /**
     * --------------------------------------------------
     * PACKAGED SERVER
     * --------------------------------------------------
     */

    if (isPackaged) {

      /**
       * Primary packaged location.
       */

      serverEntry =
        path.join(
          process.resourcesPath,
          'app.asar',
          'dist',
          'server.mjs'
        );

      /**
       * Fallback packaged location.
       */

      if (
        !fs.existsSync(
          serverEntry
        )
      ) {
        serverEntry =
          path.join(
            process.resourcesPath,
            'app',
            'dist',
            'server.mjs'
          );
      }

      /**
       * Additional fallback.
       */

      if (
        !fs.existsSync(
          serverEntry
        )
      ) {
        serverEntry =
          path.join(
            process.resourcesPath,
            'dist',
            'server.mjs'
          );
      }

      if (
        !fs.existsSync(
          serverEntry
        )
      ) {
        throw new Error(
          [
            'Packaged FMS server was not found.',
            '',
            'Checked:',
            path.join(
              process.resourcesPath,
              'app.asar',
              'dist',
              'server.mjs'
            ),
            path.join(
              process.resourcesPath,
              'app',
              'dist',
              'server.mjs'
            ),
            path.join(
              process.resourcesPath,
              'dist',
              'server.mjs'
            ),
          ].join('\n')
        );
      }

      /**
       * server.mjs receives the selected port.
       */

      args = [
        serverEntry,
        String(port),
      ];

      log(
        'Starting packaged FMS server.',
        serverEntry
      );

    } else {

      /**
       * --------------------------------------------------
       * DEVELOPMENT SERVER
       * --------------------------------------------------
       */

      const serverRunner =
        path.join(
          projectRoot,
          'electron',
          'server-runner.mjs'
        );

      serverEntry =
        path.join(
          projectRoot,
          'server.ts'
        );

      const tsxCli =
        path.join(
          projectRoot,
          'node_modules',
          'tsx',
          'dist',
          'cli.mjs'
        );

      if (
        !fs.existsSync(
          serverRunner
        )
      ) {
        throw new Error(
          `Server runner not found: ${serverRunner}`
        );
      }

      if (
        !fs.existsSync(
          serverEntry
        )
      ) {
        throw new Error(
          `FMS server entry not found: ${serverEntry}`
        );
      }

      if (
        !fs.existsSync(
          tsxCli
        )
      ) {
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

    /**
     * --------------------------------------------------
     * DATABASE
     * --------------------------------------------------
     *
     * Development:
     * existing FMS_DB_PATH or server default.
     *
     * Production:
     * %APPDATA%\DEITAX FMS.A\fms.db
     */

    const databasePath =
      isPackaged
        ? path.join(
            app.getPath(
              'userData'
            ),
            'fms.db'
          )
        : process.env
            .FMS_DB_PATH ||
          '';

    /**
     * --------------------------------------------------
     * SERVER ENVIRONMENT
     * --------------------------------------------------
     */

    const environment = {
      ...process.env,

      NODE_ENV:
        isPackaged
          ? 'production'
          : 'development',

      PORT:
        String(port),

      FMS_SERVER_PORT:
        String(port),

      HOST:
        '127.0.0.1',

      FMS_DB_PATH:
        databasePath,
    };

    /**
     * --------------------------------------------------
     * ELECTRON AS NODE
     * --------------------------------------------------
     */

    if (isPackaged) {
      environment.ELECTRON_RUN_AS_NODE =
        '1';
    }

    log(
      'Node executable.',
      nodeExecutable
    );

    log(
      'Packaged mode.',
      isPackaged
    );

    log(
      'Server entry.',
      serverEntry
    );

    log(
      'Server port.',
      port
    );

    log(
      'Database path.',
      databasePath
    );

    log(
      'Starting FMS Node server process.'
    );

    /**
     * --------------------------------------------------
     * SPAWN SERVER
     * --------------------------------------------------
     */

    serverProcess =
      spawn(
        nodeExecutable,
        args,
        {
          cwd:
            isPackaged
              ? process.resourcesPath
              : projectRoot,

          env:
            environment,

          stdio: [
            'ignore',
            'pipe',
            'pipe',
          ],

          windowsHide:
            true,
        }
      );

    serverProcess.stdout
      .setEncoding('utf8');

    serverProcess.stderr
      .setEncoding('utf8');

    let readyPort = null;

    /**
     * --------------------------------------------------
     * SERVER STDOUT
     * --------------------------------------------------
     */

    let serverStderr = '';

    serverProcess.stdout.on(
      'data',
      (data) => {

        const text =
          String(data);

        for (
          const line of
            text.split(
              /\r?\n/
            )
        ) {

          if (
            !line.trim()
          ) {
            continue;
          }

          console.log(
            `[DEITAX FMS.A Server] ${line}`
          );
          writeStartupLog(`[DEITAX FMS.A Server] ${line}`);

          /**
           * Explicit ready signal.
           */

          const readyMatch =
            line.match(
              /\[DEITAX FMS.A SERVER READY\]\s+(\d+)/
            );

          /**
           * Existing server message.
           */

          const listeningMatch =
            line.match(
              /DEITAX FMS.A Server listening on http:\/\/127\.0\.0\.1:(\d+)/
            );

          /**
           * Alternative localhost format.
           */

          const localhostMatch =
            line.match(
              /(?:localhost|127\.0\.0\.1):(\d+)/
            );

          if (
            readyMatch
          ) {

            readyPort =
              Number(
                readyMatch[1]
              );

            log(
              'Detected explicit FMS server ready signal.',
              readyPort
            );

          } else if (
            listeningMatch
          ) {

            readyPort =
              Number(
                listeningMatch[1]
              );

            log(
              'Detected FMS listening port.',
              readyPort
            );

          } else if (
            localhostMatch &&
            /listening|started|running/i.test(
              line
            )
          ) {

            readyPort =
              Number(
                localhostMatch[1]
              );

            log(
              'Detected FMS localhost listening port.',
              readyPort
            );
          }
        }
      }
    );

    /**
     * --------------------------------------------------
     * SERVER STDERR
     * --------------------------------------------------
     */

    serverProcess.stderr.on(
      'data',
      (data) => {

        const text =
          String(data);

        for (
          const line of
            text.split(
              /\r?\n/
            )
        ) {

          if (
            !line.trim()
          ) {
            continue;
          }

          console.error(
            `[DEITAX FMS.A Server] ${line}`
          );
          serverStderr = `${serverStderr}${line}\n`.slice(-12000);
          writeStartupLog(`[DEITAX FMS.A Server stderr] ${line}`);
        }
      }
    );

    /**
     * --------------------------------------------------
     * PROCESS ERROR
     * --------------------------------------------------
     */

    serverProcess.on(
      'error',
      (error) => {

        console.error(
          '[DEITAX FMS.A Electron] FMS server process error:',
          error
        );
        writeStartupLog(`[DEITAX FMS.A Electron] FMS server process error: ${error.stack || error.message || String(error)}`);
      }
    );

    /**
     * --------------------------------------------------
     * PROCESS EXIT
     * --------------------------------------------------
     */

    const processExitPromise =
      new Promise(
        (resolve) => {

          serverProcess.once(
            'exit',
            (
              code,
              signal
            ) => {

              resolve({
                code,
                signal,
              });
            }
          );
        }
      );

    /**
     * --------------------------------------------------
     * WAIT FOR SERVER READY
     * --------------------------------------------------
     */

    const startupStarted =
      Date.now();

    while (
      !readyPort
    ) {

      const result =
        await Promise.race([
          processExitPromise,

          new Promise(
            (resolve) =>
              setTimeout(
                () =>
                  resolve(
                    null
                  ),
                100
              )
          ),
        ]);

      /**
       * Server exited before announcing readiness.
       */

      if (result) {

        throw new Error(
          [
            'FMS server exited during startup.',
            `Code=${result.code}`,
            `Signal=${result.signal}`,
            `Server=${serverEntry}`,
            `Startup log=${path.join(app.getPath('userData'), 'startup.log')}`,
            serverStderr ? `stderr=${serverStderr.trim()}` : 'stderr=(no output captured)',
          ].join(
            ' | '
          )
        );
      }

      /**
       * Timeout.
       */

      if (
        Date.now() -
          startupStarted >
        30000
      ) {

        throw new Error(
          [
            'Timed out waiting for the FMS server to report its port.',
            '',
            `Expected port: ${port}`,
            `Server entry: ${serverEntry}`,
            `Packaged: ${isPackaged}`,
          ].join(
            '\n'
          )
        );
      }
    }

    /**
     * --------------------------------------------------
     * VERIFY HTTP SERVER
     * --------------------------------------------------
     */

    await waitForServer(
      readyPort
    );

    log(
      'FMS Node server is ready.',
      `http://127.0.0.1:${readyPort}`
    );

    return {
      port:
        readyPort,

      process:
        serverProcess,
    };
  };

/**
 * --------------------------------------------------
 * IPC: SAVE EXCEL FILE (NATIVE SAVE AS DIALOG)
 * --------------------------------------------------
 *
 * The renderer builds the workbook with SheetJS and sends it here as
 * raw bytes, since XLSX.writeFile()'s browser-style download is
 * unreliable in a sandboxed/contextIsolated renderer. This handler
 * owns the native dialog and the disk write.
 * --------------------------------------------------
 */

const registerIpcHandlers = () => {

  ipcMain.handle(
    'save-excel-file',
    async (event, fileBuffer, suggestedName) => {

      try {

        const win =
          BrowserWindow.fromWebContents(
            event.sender
          );

        const {
          canceled,
          filePath,
        } =
          await dialog.showSaveDialog(
            win,
            {
              title:
                'Save Excel Report',

              defaultPath:
                path.join(
                  app.getPath(
                    'documents'
                  ),
                  suggestedName
                ),

              filters: [
                {
                  name: 'Excel Workbook',
                  extensions: ['xlsx'],
                },
              ],
            }
          );

        if (
          canceled ||
          !filePath
        ) {

          return {
            success: false,
            canceled: true,
          };
        }

        const buffer =
          Buffer.from(
            fileBuffer
          );

        await fsPromises.writeFile(
          filePath,
          buffer
        );

        log(
          'Excel report saved.',
          filePath
        );

        return {
          success: true,
          canceled: false,
          filePath,
        };

      } catch (
        error
      ) {

        console.error(
          '[DEITAX FMS.A Electron] save-excel-file failed:',
          error
        );

        return {
          success: false,
          canceled: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error while saving file.',
        };
      }
    }
  );
};

/**
 * --------------------------------------------------
 * CREATE ELECTRON WINDOW
 * --------------------------------------------------
 */

const createWindow =
  async () => {

    try {

      const fmsServer =
        await startFmsServer();

      const appUrl =
        `http://127.0.0.1:${fmsServer.port}`;

      /**
       * --------------------------------------------------
       * APPLICATION ICON
       * --------------------------------------------------
       */

      const iconPath =
        path.join(
          projectRoot,
          'build',
          'icon.ico'
        );

      if (
        !fs.existsSync(
          iconPath
        )
      ) {

        console.warn(
          '[DEITAX FMS.A Electron] Icon file not found:',
          iconPath
        );
      }

      /**
       * --------------------------------------------------
       * ELECTRON WINDOW
       * --------------------------------------------------
       */

      mainWindow =
        new BrowserWindow({

          width: 1440,

          height: 920,

          minWidth: 1024,

          minHeight: 720,

          show: false,

          icon:
            iconPath,

          autoHideMenuBar:
            true,

          webPreferences: {

            preload:
              path.join(
                __dirname,
                'preload.mjs'
              ),

            contextIsolation:
              true,

            nodeIntegration:
              false,

            sandbox:
              true,
          },
        });

      /**
       * --------------------------------------------------
       * REMOVE ELECTRON MENU
       * --------------------------------------------------
       */

      mainWindow.setMenu(
        null
      );

      mainWindow.setMenuBarVisibility(
        false
      );

      /**
       * --------------------------------------------------
       * DEITAX FMS.A ZOOM CONTROLS
       * --------------------------------------------------
       *
       * Ctrl + +  = Zoom in
       * Ctrl + -  = Zoom out
       * Ctrl + 0  = Reset to 100%
       *
       * Zoom range:
       * 50% - 200%
       *
       * Step:
       * 10%
       * --------------------------------------------------
       */

      mainWindow.webContents.on(
        'before-input-event',
        (event, input) => {

          /**
           * Only handle Ctrl-based
           * keyboard shortcuts.
           */

          if (
            !input.control ||
            input.type !== 'keyDown'
          ) {
            return;
          }

          /**
           * ------------------------------------------------
           * ZOOM IN
           * ------------------------------------------------
           *
           * "=" also handles the "+" key
           * on standard keyboards.
           */

          if (
            input.key === '+' ||
            input.key === '='
          ) {

            event.preventDefault();

            const currentZoom =
              mainWindow.webContents
                .getZoomFactor();

            const nextZoom =
              Math.min(
                currentZoom + 0.1,
                2
              );

            mainWindow.webContents
              .setZoomFactor(
                nextZoom
              );

            log(
              'Zoom changed.',
              `${Math.round(nextZoom * 100)}%`
            );

            return;
          }

          /**
           * ------------------------------------------------
           * ZOOM OUT
           * ------------------------------------------------
           */

          if (
            input.key === '-' ||
            input.key === '_'
          ) {

            event.preventDefault();

            const currentZoom =
              mainWindow.webContents
                .getZoomFactor();

            const nextZoom =
              Math.max(
                currentZoom - 0.1,
                0.5
              );

            mainWindow.webContents
              .setZoomFactor(
                nextZoom
              );

            log(
              'Zoom changed.',
              `${Math.round(nextZoom * 100)}%`
            );

            return;
          }

          /**
           * ------------------------------------------------
           * RESET ZOOM
           * ------------------------------------------------
           */

          if (
            input.key === '0'
          ) {

            event.preventDefault();

            mainWindow.webContents
              .setZoomFactor(
                1
              );

            log(
              'Zoom reset.',
              '100%'
            );
          }
        }
      );

      /**
       * --------------------------------------------------
       * ZOOM WITH CTRL + MOUSE WHEEL
       * --------------------------------------------------
       */

      mainWindow.webContents.on(
        'before-input-event',
        (event, input) => {

          if (
            input.type !== 'mouseWheel' ||
            !input.control
          ) {
            return;
          }

          event.preventDefault();

          const currentZoom =
            mainWindow.webContents
              .getZoomFactor();

          let nextZoom =
            currentZoom;

          if (
            input.deltaY < 0
          ) {

            nextZoom =
              Math.min(
                currentZoom + 0.1,
                2
              );

          } else if (
            input.deltaY > 0
          ) {

            nextZoom =
              Math.max(
                currentZoom - 0.1,
                0.5
              );
          }

          mainWindow.webContents
            .setZoomFactor(
              nextZoom
            );

          log(
            'Zoom changed.',
            `${Math.round(nextZoom * 100)}%`
          );
        }
      );

      /**
       * --------------------------------------------------
       * SHOW WINDOW WHEN READY
       * --------------------------------------------------
       */

      mainWindow.once(
        'ready-to-show',
        () => {

          log(
            'Renderer is ready; displaying the desktop window.'
          );

          mainWindow.show();
        }
      );

      /**
       * --------------------------------------------------
       * RENDERER LOADING ERRORS
       * --------------------------------------------------
       */

      mainWindow.webContents.on(
        'did-fail-load',
        (
          _event,
          errorCode,
          errorDescription,
          validatedURL
        ) => {

          console.error(
            '[DEITAX FMS.A Electron] Renderer failed to load.',
            {
              errorCode,
              errorDescription,
              validatedURL,
            }
          );
        }
      );

      /**
       * --------------------------------------------------
       * RENDERER PROCESS CRASH
       * --------------------------------------------------
       */

      mainWindow.webContents.on(
        'render-process-gone',
        (
          _event,
          details
        ) => {

          console.error(
            '[DEITAX FMS.A Electron] Renderer process exited.',
            details
          );
        }
      );

      /**
       * --------------------------------------------------
       * LOAD FMS APPLICATION
       * --------------------------------------------------
       */

      log(
        'Loading FMS renderer.',
        appUrl
      );

      await mainWindow.loadURL(
        appUrl
      );

    } catch (
      error
    ) {

      console.error(
        '[DEITAX FMS.A Electron] Unable to start desktop application:',
        error
      );

      await stopFmsServer();

      try {

        await dialog.showMessageBox({

          type:
            'error',

          title:
            'Deitax Fms.A Startup Error',

          message:
            'Deitax Fms.A could not start.',

          detail:
            error instanceof Error
              ? error.message
              : String(
                  error
                ),
        });

      } catch {
        // Ignore dialog failure.
      }

      app.quit();
    }
  };

/**
 * --------------------------------------------------
 * STOP FMS SERVER CLEANLY
 * --------------------------------------------------
 */

const stopFmsServer =
  async () => {

    if (
      !serverProcess
    ) {
      return;
    }

    const child =
      serverProcess;

    serverProcess =
      null;

    if (
      child.exitCode !==
      null
    ) {
      return;
    }

    log(
      'Stopping FMS Node server.'
    );

    await new Promise(
      (resolve) => {

        let finished =
          false;

        const finish =
          () => {

            if (
              finished
            ) {
              return;
            }

            finished =
              true;

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

        } catch (
          error
        ) {

          console.error(
            '[DEITAX FMS.A Electron] Failed to terminate FMS server:',
            error
          );

          finish();
        }

        setTimeout(
          () => {

            if (
              finished
            ) {
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

/**
 * --------------------------------------------------
 * ELECTRON STARTUP
 * --------------------------------------------------
 */

Menu.setApplicationMenu(
  null
);

log(
  'Electron main process starting.'
);

app.whenReady()
  .then(() => {

    log(
      'Electron runtime is ready.'
    );

    Menu.setApplicationMenu(
      null
    );

    registerIpcHandlers();

    return createWindow();
  })
  .catch(
    (error) => {

      console.error(
        '[DEITAX FMS.A Electron] Electron startup failure:',
        error
      );

      app.quit();
    }
  );

/**
 * --------------------------------------------------
 * WINDOW CLOSED
 * --------------------------------------------------
 */

app.on(
  'window-all-closed',
  () => {

    app.quit();
  }
);

/**
 * --------------------------------------------------
 * APPLICATION QUIT
 * --------------------------------------------------
 */

app.on(
  'before-quit',
  (event) => {

    if (
      isQuitting
    ) {
      return;
    }

    isQuitting =
      true;

    if (
      !serverProcess
    ) {
      return;
    }

    event.preventDefault();

    void stopFmsServer()
      .catch(
        (error) => {

          console.error(
            '[DEITAX FMS.A Electron] Server shutdown error:',
            error
          );
        }
      )
      .finally(
        () => {

          app.quit();
        }
      );
  }
);
