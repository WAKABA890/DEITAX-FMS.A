import { contextBridge, ipcRenderer } from 'electron';

// Stage 1 deliberately exposed no desktop capabilities to the existing UI —
// the frontend talked only to its local /api routes.
//
// Stage 2: adds a single, narrow capability — saving a generated Excel
// workbook via a native Save As dialog. This is needed because
// XLSX.writeFile()'s browser-style download is unreliable in this
// sandboxed/contextIsolated renderer. Everything else the UI does still
// goes through /api as before; this is the only IPC surface exposed.
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  saveExcelFile: (fileBuffer, fileName) =>
    ipcRenderer.invoke('save-excel-file', fileBuffer, fileName),
}));
