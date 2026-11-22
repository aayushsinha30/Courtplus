import type { CourtPlusApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { contextBridge, ipcRenderer } from 'electron';

function invoke<K extends keyof CourtPlusApi>(
  name: K,
  ...args: Parameters<CourtPlusApi[K]>
): ReturnType<CourtPlusApi[K]> {
  return ipcRenderer.invoke(`courtplus:${name}`, ...args) as ReturnType<CourtPlusApi[K]>;
}

const courtplus: CourtPlusApi = {
  listPersons: () => invoke('listPersons'),
  listCases: () => invoke('listCases'),
  importOrder: file => invoke('importOrder', file),
  saveCase: (person, record) => invoke('saveCase', person, record),
  screen: (caseId, asOf) => invoke('screen', caseId, asOf),
  board: asOf => invoke('board', asOf),
  updateCard: (id, patch) => invoke('updateCard', id, patch),
  exportDraft: (kind, caseId, lang) => invoke('exportDraft', kind, caseId, lang),
  exportScReturn: (asOf, format) => invoke('exportScReturn', asOf, format),
  verify: bundle => invoke('verify', bundle),
  stats: () => invoke('stats'),
  role: () => invoke('role'),
};

contextBridge.exposeInMainWorld('courtplus', courtplus);
if (process.argv.includes('--courtplus-diagnostics')) {
  contextBridge.exposeInMainWorld('courtplusDiagnostics', {
    diag: () => ipcRenderer.invoke('diag'),
  });
}
