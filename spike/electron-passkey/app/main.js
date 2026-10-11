const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// Where the web app lives. The page's origin is also the passkey RP ID.
const START_URL = process.env.SPIKE_URL || 'https://devsesh-spike.example.net/'
const ORIGIN = new URL(START_URL).origin
// SPIKE_MODE=apple    -> Apple AuthenticationServices addon (needs the association file)
// SPIKE_MODE=chromium -> Electron's built-in Touch ID authenticator (default)
const MODE = process.env.SPIKE_MODE || 'chromium'
// Spike only: trust our throwaway leaf by key hash (Chromium here ignores the keychain trust).
try { app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', require('./spki.json').spki) } catch {}
const KEYCHAIN_GROUP = '9YDT4ML5X7.com.leosa.devseshspike.webauthn'

if (MODE === 'chromium' && process.platform === 'darwin') {
  app.configureWebAuthn({ touchID: { keychainAccessGroup: KEYCHAIN_GROUP } })
  // Several discoverable credentials match: let the user choose (here: just take the first).
  app.on('session-created', (session) => {
    session.on('select-webauthn-account', (event, accounts, callback) => {
      console.log('select-webauthn-account', JSON.stringify(accounts))
      try { callback(accounts[0] && accounts[0].id) } catch (e) { callback() }
    })
  })
}

const webauthn = MODE === 'apple' ? require('electron-webauthn-mac') : null
const trusted = (e) => {
  try { return new URL(e.senderFrame.url).origin === ORIGIN } catch { return false }
}
if (webauthn) {
  ipcMain.handle('webauthn:create', (e, o) => { if (!trusted(e)) throw new Error('untrusted sender'); return webauthn.createCredential(o) })
  ipcMain.handle('webauthn:get', (e, o) => { if (!trusted(e)) throw new Error('untrusted sender'); return webauthn.getCredential(o) })
}


// Secure Enclave helper: a small signed app inside our bundle. Only a fixed set of commands is allowed.
const { execFile } = require('child_process')
const SE_HELPER = path.join(process.resourcesPath, '..', 'Helpers', 'SEHelper.app', 'Contents', 'MacOS', 'se-helper')
const SE_COMMANDS = new Set(['status', 'create', 'wrap', 'unwrap', 'selftest', 'delete'])
ipcMain.handle('se:call', (e, cmd, arg, reason) => {
  if (!trusted(e)) throw new Error('untrusted sender')
  if (process.platform !== 'darwin' || !SE_COMMANDS.has(cmd)) throw new Error('unsupported')
  const args = [cmd]
  if (arg !== undefined) args.push(String(arg))
  if (reason !== undefined) args.push(String(reason))
  return new Promise((resolve) => {
    // The helper prints JSON for both success and failure.
    execFile(SE_HELPER, args, { timeout: 120000 }, (err, stdout) => {
      try { resolve(JSON.parse(stdout)) } catch { resolve({ ok: false, error: String((err && err.message) || 'helper gave no output') }) }
    })
  })
})
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 900, height: 700,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      // The Secure Enclave bridge is always there; the Apple passkey bridge only in apple mode.
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: MODE === 'apple' ? ['--spike-apple'] : [],
    },
  })
  win.webContents.on('will-navigate', (ev, url) => { if (new URL(url).origin !== ORIGIN) ev.preventDefault() })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.loadURL(START_URL)
})
app.on('window-all-closed', () => app.quit())
