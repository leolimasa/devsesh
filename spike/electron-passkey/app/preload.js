const { contextBridge, ipcRenderer } = require('electron')
// macOS only. Other platforms keep using the browser's own navigator.credentials / their own unlock provider.
if (process.platform === 'darwin') {
  contextBridge.exposeInMainWorld('nativeSE', {
    call: (cmd, arg, reason) => ipcRenderer.invoke('se:call', cmd, arg, reason),
  })
  if (process.argv.includes('--spike-apple')) {
    contextBridge.exposeInMainWorld('nativeWebAuthn', {
      create: (o) => ipcRenderer.invoke('webauthn:create', o),
      get: (o) => ipcRenderer.invoke('webauthn:get', o),
    })
  }
}
