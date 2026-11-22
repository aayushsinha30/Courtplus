import type { CourtPlusApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { Store } from './store';
import { argumentSchemas, validateArguments } from './validation';

function route<Args extends unknown[], Result>(
  schema: z.ZodType<Args>,
  handler: (...args: NoInfer<Args>) => Result,
) {
  return (args: unknown[]): Result => handler(...validateArguments(schema, args));
}

function notImplemented(): never {
  throw new Error('NOT_IMPLEMENTED');
}

export function registerHandlers(store: Store, isTrusted: (event: IpcMainInvokeEvent) => boolean): void {
  const routes = {
    listPersons: route(argumentSchemas.listPersons, store.listPersons),
    listCases: route(argumentSchemas.listCases, store.listCases),
    saveCase: route(argumentSchemas.saveCase, store.saveCase),
    role: route(argumentSchemas.role, store.role),
    importOrder: route(argumentSchemas.importOrder, notImplemented),
    screen: route(argumentSchemas.screen, notImplemented),
    board: route(argumentSchemas.board, notImplemented),
    updateCard: route(argumentSchemas.updateCard, notImplemented),
    exportDraft: route(argumentSchemas.exportDraft, notImplemented),
    exportScReturn: route(argumentSchemas.exportScReturn, notImplemented),
    verify: route(argumentSchemas.verify, notImplemented),
    stats: route(argumentSchemas.stats, notImplemented),
  } satisfies {
    [K in keyof CourtPlusApi]: (args: unknown[]) => Awaited<ReturnType<CourtPlusApi[K]>>;
  };

  for (const [name, handle] of Object.entries(routes)) {
    ipcMain.handle(`courtplus:${name}`, (event, ...args: unknown[]) => {
      if (!isTrusted(event)) throw new Error('FORBIDDEN');
      try {
        return handle(args);
      } catch (error) {
        if (error instanceof Error
          && (error.message.startsWith('INVALID_ARGUMENT') || error.message === 'NOT_IMPLEMENTED')) {
          throw error;
        }
        throw new Error('INTERNAL_ERROR');
      }
    });
  }
}
