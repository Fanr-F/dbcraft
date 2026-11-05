import { join } from 'node:path';
import { app, BrowserWindow, Menu, session } from 'electron';
import { registerIpcHandlers, bindMainWindow, releaseMainWindow } from './ipc/router';
import { closeAllSessions } from './services/ConnectionManager';
import { createLogger, resolveLogDirectory, resolveLogLevel } from './logging/logger';

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);
const isSmoke = process.env['DBCRAFT_SMOKE'] === '1';
const log = createLogger('app');

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

let mainWindow: BrowserWindow | null = null;
let quitting = false;

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

  bindMainWindow(window);
  log.info('主窗口已创建', { dev: isDev });

  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('渲染进程异常退出', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  window.on('closed', () => {
    releaseMainWindow(window);
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

    log.info('应用启动', {
      version: app.getVersion(),
      electron: process.versions.electron,
      dev: isDev,
      level: resolveLogLevel(),
      logDir: resolveLogDirectory(),
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('before-quit', (event) => {
    if (quitting) return;

    // 先等会话关闭（SQLite Worker、MySQL/MariaDB 连接），再真正退出。
    event.preventDefault();
    quitting = true;
    log.info('应用退出：关闭会话');
    void closeAllSessions().finally(() => {
      log.debug('会话已关闭，退出应用');
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
