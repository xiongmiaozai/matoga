const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  selectFolder: (side) => ipcRenderer.invoke('dialog:selectFolder', side),
  readEntries: (p, ignore) => ipcRenderer.invoke('folder:readEntries', p, ignore),
  readRecursive: (p, ignore) => ipcRenderer.invoke('folder:readRecursive', p, ignore),
  hashFile: (p) => ipcRenderer.invoke('file:hash', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  clearConfig: () => ipcRenderer.invoke('config:clear'),
  copyFile: (src, dest) => ipcRenderer.invoke('file:copy', src, dest),
  backupFile: (p) => ipcRenderer.invoke('file:backup', p),
  deleteFile: (p) => ipcRenderer.invoke('file:delete', p),
  selectFile: () => ipcRenderer.invoke('dialog:selectFile'),
  selectHDRFile: () => ipcRenderer.invoke('dialog:selectHDR'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  createFolder: (p) => ipcRenderer.invoke('folder:create', p)
})