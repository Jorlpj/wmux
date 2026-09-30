import { ipcMain } from 'electron';
import { IPC } from '../../../shared/constants';
import { wrapHandler } from '../wrapHandler';
import type {
  ProviderInventory,
  SurfaceApplyResult,
  SurfaceChangeRequest,
  SurfaceInventoryRequest,
  SurfacePreview,
} from '../../../shared/tokenUsage/surfaceTypes';

// Skeleton: owned by the inventory work item (read side) and, later, the writers (preview/apply).
// Replace the bodies; keep the channels and result types.

export function registerTokenUsageSurfaceHandlers(): () => void {
  ipcMain.removeHandler(IPC.TOKEN_SURFACE_INVENTORY);
  ipcMain.handle(
    IPC.TOKEN_SURFACE_INVENTORY,
    wrapHandler(
      IPC.TOKEN_SURFACE_INVENTORY,
      async (_event, request: SurfaceInventoryRequest): Promise<ProviderInventory> => ({
        provider: request.provider,
        cliVersion: null,
        versionSupported: false,
        writable: false,
        items: [],
        warnings: ['Inventory is not implemented yet.'],
        scannedAtMs: Date.now(),
      }),
    ),
  );

  ipcMain.removeHandler(IPC.TOKEN_SURFACE_PREVIEW);
  ipcMain.handle(
    IPC.TOKEN_SURFACE_PREVIEW,
    wrapHandler(
      IPC.TOKEN_SURFACE_PREVIEW,
      async (_event, request: SurfaceChangeRequest): Promise<SurfacePreview> => ({
        provider: request.provider,
        edits: [],
        rejected: request.changes.map((c) => ({ itemId: c.itemId, reason: 'Writing is not implemented yet.' })),
        requiresNewSession: true,
      }),
    ),
  );

  ipcMain.removeHandler(IPC.TOKEN_SURFACE_APPLY);
  ipcMain.handle(
    IPC.TOKEN_SURFACE_APPLY,
    wrapHandler(
      IPC.TOKEN_SURFACE_APPLY,
      async (_event, request: SurfaceChangeRequest): Promise<SurfaceApplyResult> => ({
        provider: request.provider,
        ok: false,
        appliedItemIds: [],
        backups: [],
        error: 'Writing is not implemented yet.',
      }),
    ),
  );

  return () => {
    ipcMain.removeHandler(IPC.TOKEN_SURFACE_INVENTORY);
    ipcMain.removeHandler(IPC.TOKEN_SURFACE_PREVIEW);
    ipcMain.removeHandler(IPC.TOKEN_SURFACE_APPLY);
  };
}
