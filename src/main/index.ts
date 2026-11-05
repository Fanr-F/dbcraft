import { join } from 'node:path';
import { app, BrowserWindow, Menu, session } from 'electron';
import { registerIpcHandlers } from './ipc/router';
import { closeAllSessions } from './services/ConnectionManager';

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);
const isSmoke = process.env['DBCRAFT_SMOKE'] === '1';

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'DBCraft',
    backgroundColor: '#0b1120',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (isDev) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        window.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  if (isDev) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'] as string);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (isSmoke) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeCheck(window);
      }, 800);
    });
  }

  return window;
}

async function runSmokeCheck(window: BrowserWindow): Promise<void> {
  try {
    const result = (await window.webContents.executeJavaScript(`({
      shell: Boolean(document.querySelector('[data-testid="app-shell"]')),
      bridge: Boolean(window.dbcraft),
      title: document.title
    })`)) as { shell: boolean; bridge: boolean; title: string };

    console.log('[smoke]', JSON.stringify(result));
    app.exit(result.shell && result.bridge ? 0 : 1);
  } catch (error) {
    console.error('[smoke] renderer check failed:', error);
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dbcraft.app');
    Menu.setApplicationMenu(null);

    if (!isDev) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [PRODUCTION_CSP],
          },
        });
      });
    }

    registerIpcHandlers();
    mainWindow = createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('before-quit', () => {
    void closeAllSessions();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
