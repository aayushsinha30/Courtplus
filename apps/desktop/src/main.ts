import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { diagnosticsPassed, runDiagnostics, type DiagnosticsReport } from './diagnostics';
import { registerHandlers } from './ipc';
import { appUrl, developmentUrl, isSameOrigin, lockDownWindow, makeRendererSession, webPreferences } from './renderer';
import { openStore, type Store } from './store';
import { argumentSchemas, validateArguments } from './validation';

const diagnosticsFlag = '--courtplus-diagnostics';
const diagnosticsMode = process.argv.includes(diagnosticsFlag);
const profilePrefix = '--courtplus-diagnostics-profile=';
const diagnosticProfile = process.argv.find(arg => arg.startsWith(profilePrefix))?.slice(profilePrefix.length);

app.setName('CourtPlus');
app.enableSandbox();
app.commandLine.appendSwitch('disable-background-networking');
if (diagnosticsMode && diagnosticProfile) {
  const directory = resolve(diagnosticProfile);
  mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}

let store: Store | undefined;
let mainWindow: BrowserWindow | undefined;

async function start(): Promise<void> {
  const devUrl = diagnosticsMode ? undefined : developmentUrl();
  const rendererUrl = devUrl?.href ?? appUrl;
  const rendererSession = await makeRendererSession(devUrl);
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  const report = app.isPackaged || diagnosticsMode ? runDiagnostics(directory, rendererSession) : undefined;

  try {
    store = await openStore(directory, safeStorage);
    const isTrusted = (event: IpcMainInvokeEvent): boolean => {
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
      const frame = event.senderFrame;
      return frame !== null && frame === event.sender.mainFrame && isSameOrigin(frame.url, rendererUrl);
    };

    registerHandlers(store, isTrusted);
    if (diagnosticsMode && report) {
      ipcMain.handle('diag', (event, ...args: unknown[]) => {
        if (!isTrusted(event)) throw new Error('FORBIDDEN');
        validateArguments(argumentSchemas.role, args);
        return report;
      });
    }

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      show: !diagnosticsMode,
      webPreferences: {
        ...webPreferences,
        session: rendererSession,
        preload: join(__dirname, 'preload.js'),
        additionalArguments: diagnosticsMode ? [diagnosticsFlag] : [],
      },
    });
    lockDownWindow(mainWindow);
    await mainWindow.loadURL(rendererUrl);
    if (diagnosticsMode) {
      const results = await mainWindow.webContents.executeJavaScript(
        'window.courtplusDiagnostics.diag()',
      ) as DiagnosticsReport;
      store.close();
      app.exit(diagnosticsPassed(results) ? 0 : 1);
    } else {
      await report;
    }
  } catch (error) {
    await report;
    throw error;
  }
}

app.on('window-all-closed', () => {
  if (mainWindow) app.quit();
});
app.on('will-quit', () => { store?.close(); });
if (app.requestSingleInstanceLock()) {
  void app.whenReady().then(start).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (diagnosticsMode) console.error(message);
    else dialog.showErrorBox('CourtPlus could not start', message);
    app.exit(1);
  });
} else {
  app.exit(diagnosticsMode ? 1 : 0);
}
