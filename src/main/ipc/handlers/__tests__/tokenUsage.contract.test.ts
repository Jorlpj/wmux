import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
  return { ipcMain, __handlers: handlers };
});

import { IPC } from '../../../../shared/constants';
import { registerTokenUsageQuotaHandlers } from '../tokenUsageQuota.handler';
import { registerTokenUsageSurfaceHandlers } from '../tokenUsageSurface.handler';
import { SURFACE_CAPABILITIES, capabilityFor } from '../../../../shared/tokenUsage/capabilities';
import type { QuotaReadResult } from '../../../../shared/tokenUsage/quotaTypes';
import type { ProviderInventory } from '../../../../shared/tokenUsage/surfaceTypes';

const CHANNELS = [
  IPC.TOKEN_QUOTA_READ,
  IPC.TOKEN_QUOTA_SENSOR_STATUS,
  IPC.TOKEN_QUOTA_SENSOR_INSTALL,
  IPC.TOKEN_SURFACE_INVENTORY,
  IPC.TOKEN_SURFACE_PREVIEW,
  IPC.TOKEN_SURFACE_APPLY,
];

async function handlers() {
  const electron = (await import('electron')) as unknown as {
    __handlers: Map<string, (...args: unknown[]) => unknown>;
  };
  return electron.__handlers;
}

describe('token usage IPC contract', () => {
  it('uses distinct channel names', () => {
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length);
  });

  it('registers every channel and removes them on cleanup', async () => {
    const cleanups = [registerTokenUsageQuotaHandlers(), registerTokenUsageSurfaceHandlers()];
    const map = await handlers();
    for (const channel of CHANNELS) expect(map.has(channel)).toBe(true);
    for (const cleanup of cleanups) cleanup();
    for (const channel of CHANNELS) expect(map.has(channel)).toBe(false);
  });

  it('skeleton quota read returns one unavailable reading per active provider', async () => {
    const cleanup = registerTokenUsageQuotaHandlers();
    const map = await handlers();
    const all = (await map.get(IPC.TOKEN_QUOTA_READ)!({}, undefined)) as QuotaReadResult;
    expect(all.readings.map((r) => r.quota.provider)).toEqual(['claude', 'codex', 'agy']);
    const one = (await map.get(IPC.TOKEN_QUOTA_READ)!({}, { providers: ['codex'] })) as QuotaReadResult;
    expect(one.readings).toHaveLength(1);
    expect(one.readings[0].quota.status).toBe('unavailable');
    cleanup();
  });

  it('inventory handler returns reader result and rejects unknown provider', async () => {
    const mockDeps = {
      homeDir: '/tmp/nonexistent-test-home',
      run: async () => '1.2.14',
    };
    const cleanup = registerTokenUsageSurfaceHandlers(mockDeps);
    const map = await handlers();
    const inv = (await map.get(IPC.TOKEN_SURFACE_INVENTORY)!({}, { provider: 'agy' })) as ProviderInventory;
    expect(inv.provider).toBe('agy');
    expect(inv.versionSupported).toBe(true);
    expect(inv.writable).toBe(true);

    await expect(
      map.get(IPC.TOKEN_SURFACE_INVENTORY)!({}, { provider: 'unknown' as any }),
    ).rejects.toThrow('Unknown provider');

    cleanup();
  });
});

describe('surface capabilities (phase-2 spike)', () => {
  it('covers every surface kind for every provider exactly once', () => {
    for (const [provider, caps] of Object.entries(SURFACE_CAPABILITIES)) {
      const kinds = caps.map((c) => c.kind);
      expect(new Set(kinds).size, provider).toBe(kinds.length);
      expect(kinds).toEqual(expect.arrayContaining(['mcp-server', 'plugin', 'skill', 'hook']));
    }
  });

  it('records the verified spike results', () => {
    expect(capabilityFor('agy', 'skill')?.mechanism).toMatch(/exact directory names/);
    expect(capabilityFor('agy', 'plugin')?.status).toBe('verified');
    expect(capabilityFor('agy', 'hook')?.status).toBe('verified');
    expect(capabilityFor('codex', 'skill')?.mechanism).toMatch(/SKILL\.md/);
  });
});
