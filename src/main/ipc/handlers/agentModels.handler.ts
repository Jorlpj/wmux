import { ipcMain } from 'electron';
import { IPC } from '../../../shared/constants';
import { wrapHandler } from '../wrapHandler';
import { ModelCatalog } from '../../agents/ModelCatalog';
import type { ModelCatalogResult } from '../../../shared/modelCatalog';

/** Agent CLI model discovery for Settings (see main/agents/ModelCatalog). */
export function registerAgentModelsHandlers(catalog: ModelCatalog = new ModelCatalog()): void {
  ipcMain.removeHandler(IPC.AGENT_MODELS_LIST);
  ipcMain.handle(
    IPC.AGENT_MODELS_LIST,
    wrapHandler(IPC.AGENT_MODELS_LIST, (_event: Electron.IpcMainInvokeEvent, raw: unknown): Promise<ModelCatalogResult> => {
      const req = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const agent = typeof req.agent === 'string' ? req.agent.trim().toLowerCase() : '';
      return catalog.list(agent, { refresh: req.refresh === true });
    }),
  );
}
