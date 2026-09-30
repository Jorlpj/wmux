import { ipcMain } from 'electron';
import { IPC } from '../../../shared/constants';
import { wrapHandler } from '../wrapHandler';
import {
  QUOTA_PROVIDERS,
  type AgySensorInstallResult,
  type AgySensorStatus,
  type ProviderQuotaReading,
  type QuotaProviderId,
  type QuotaReadRequest,
  type QuotaReadResult,
} from '../../../shared/tokenUsage/quotaTypes';

// Skeleton: owned by the quota work item. Replace the bodies; keep the channels and result types.

function unavailableReading(provider: QuotaProviderId): ProviderQuotaReading {
  return {
    quota: {
      provider,
      status: 'unavailable',
      windows: [],
      planLabel: null,
      creditsLabel: null,
      capturedAtMs: null,
      fetchedAtMs: Date.now(),
      contextUsage: null,
      avgTokensPerMessage: null,
      message: 'Quota reporting is not implemented yet.',
    },
    deltas: [],
  };
}

export function registerTokenUsageQuotaHandlers(): () => void {
  ipcMain.removeHandler(IPC.TOKEN_QUOTA_READ);
  ipcMain.handle(
    IPC.TOKEN_QUOTA_READ,
    wrapHandler(IPC.TOKEN_QUOTA_READ, async (_event, request?: QuotaReadRequest): Promise<QuotaReadResult> => {
      const wanted = request?.providers?.length ? request.providers : [...QUOTA_PROVIDERS];
      return { readings: wanted.map(unavailableReading) };
    }),
  );

  ipcMain.removeHandler(IPC.TOKEN_QUOTA_SENSOR_STATUS);
  ipcMain.handle(
    IPC.TOKEN_QUOTA_SENSOR_STATUS,
    wrapHandler(IPC.TOKEN_QUOTA_SENSOR_STATUS, async (): Promise<AgySensorStatus> => ({
      state: 'error',
      settingsPath: '',
      hasData: false,
      message: 'Not implemented yet.',
    })),
  );

  ipcMain.removeHandler(IPC.TOKEN_QUOTA_SENSOR_INSTALL);
  ipcMain.handle(
    IPC.TOKEN_QUOTA_SENSOR_INSTALL,
    wrapHandler(IPC.TOKEN_QUOTA_SENSOR_INSTALL, async (): Promise<AgySensorInstallResult> => ({
      ok: false,
      action: 'failed',
      message: 'Not implemented yet.',
      status: { state: 'error', settingsPath: '', hasData: false, message: 'Not implemented yet.' },
    })),
  );

  return () => {
    ipcMain.removeHandler(IPC.TOKEN_QUOTA_READ);
    ipcMain.removeHandler(IPC.TOKEN_QUOTA_SENSOR_STATUS);
    ipcMain.removeHandler(IPC.TOKEN_QUOTA_SENSOR_INSTALL);
  };
}
