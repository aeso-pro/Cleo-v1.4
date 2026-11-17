/* Cleo POS for Windows: the Cleo app in its own window, served from this computer, and kept up to date.

   - The app's files (web/, copied by tools/build-app-web.js) are served to the window from
     http://127.0.0.1:47823 by tools/serve.js, with the website's own security headers. The address is
     fixed because Cleo's sign-in allow list (Supabase › Authentication › URL Configuration) names it.
   - Cleo's pages stay in the window. Anything else (Google sign-in, the payment page, links) opens in the
     computer's browser: Google refuses sign-in inside an app window.
   - Back from Google, the browser lands on this computer's address with a one-time code. The browser gets a
     short "return to Cleo" page, and the window finishes the sign-in with the key it kept (PKCE).
   - Updates: electron-updater reads the latest GitHub release (latest.yml), downloads a newer installer in
     the background, and offers to restart. Releases are made by .github/workflows/release.yml. */
'use strict';
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const HOST = '127.0.0.1';
const PORT = 47823;
const ORIGIN = `http://${HOST}:${PORT}`;
const { serveStatic } = require(path.join(__dirname, 'web', 'tools', 'serve.js'));

let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const ownPage = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
const openOutside = (url) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); };

/* what comes back from a sign-in or payment page, in the browser, to this computer's address */
const RETURN_KEYS = ['code', 'error', 'error_description', 'billing'];
function localServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN);
    const fromBrowser = !/\bElectron\//.test(String(req.headers['user-agent'] || ''));
    if (fromBrowser && url.pathname === '/index.html' && RETURN_KEYS.some((k) => url.searchParams.has(k))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
      res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cleo POS</title>'
        + '<body style="font:16px/1.5 system-ui,sans-serif;margin:18vh auto;max-width:440px;padding:0 20px;text-align:center;color:#1d1d1f">'
        + '<h1 style="font-size:22px;margin:0 0 8px">Back to Cleo POS</h1><p>Return to the Cleo POS app to continue. You can close this tab.</p></body>');
      if (win) {
        win.loadURL(`${ORIGIN}/index.html${url.search}`);
        if (win.isMinimized()) win.restore();
        win.focus();
      }
      return;
    }
    serveStatic(req, res);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 1024, minHeight: 640,
    title: 'Cleo POS', backgroundColor: '#f5f5f7', autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!ownPage(url)) { event.preventDefault(); openOutside(url); } });
  win.webContents.on('will-redirect', (event, url) => { if (!ownPage(url)) { event.preventDefault(); openOutside(url); } });
  win.on('closed', () => { win = null; });
  win.loadURL(`${ORIGIN}/index.html`);
}

function permissions() {
  // the camera, for scanning barcodes, and nothing else; only for Cleo's own pages
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'media' && ownPage(details.requestingUrl || contents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => permission === 'media' && origin === ORIGIN);
}

function updates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1, noLink: true,
      title: 'Update ready', message: `Cleo POS ${info.version} is ready to install`,
      detail: 'Finish the sale in progress, then restart. Later installs it the next time Cleo POS closes.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', () => { /* offline, or no release yet: the next check tries again */ });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  permissions();
  const server = localServer();
  server.on('error', async (error) => {
    await dialog.showMessageBox({ type: 'error', title: 'Cleo POS', message: 'Cleo POS couldn’t start',
      detail: error.code === 'EADDRINUSE' ? `Another program is using port ${PORT} on this computer. Close it, then open Cleo POS again.` : String(error.message || error) });
    app.quit();
  });
  server.listen(PORT, HOST, () => { createWindow(); updates(); });
});
app.on('window-all-closed', () => app.quit());
