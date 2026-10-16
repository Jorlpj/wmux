// Local-mode twin of #2241 / #2251: revealing a workspace refits its panes
// (pty:resize -> markResize), and an idle TUI answers with a full repaint well
// over the activity threshold. In the local fallback that repaint used to
// broadcast 'running', and the unmarked 'idle' 5s later left the renderer's
// two-minute activity stamp holding the pane lit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // Same recording stand-in for metadata.handler.ts's funnel as
  // PTYBridge.staleRunning.test.ts: onActiveToIdle defers to the last
  // broadcast status, so a bare `vi.fn()` would change what it does.
  const lastBroadcastAgentStatus = new Map<string, string>();
  const broadcastMetadataUpdate = vi.fn(
    (_win: unknown, payload: { ptyId?: string; agentStatus?: string }) => {
      if (payload.ptyId && payload.agentStatus !== undefined) {
        lastBroadcastAgentStatus.set(payload.ptyId, payload.agentStatus);
      }
    },
  );
  return {
    toastManager: { show: vi.fn() },
    broadcastMetadataUpdate,
    sendNotification: vi.fn(),
    lastBroadcastAgentStatus,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: class {},
}));

vi.mock('../../pipe/handlers/notify.rpc', () => ({
  toastManager: mocks.toastManager,
}));

vi.mock('../../ipc/handlers/metadata.handler', () => ({
  updateCwd: vi.fn(),
  removeCwd: vi.fn(),
  updateBranch: vi.fn(),
  removeBranch: vi.fn(),
  broadcastMetadataUpdate: mocks.broadcastMetadataUpdate,
  getLastBroadcastAgentStatus: (ptyId: string) => mocks.lastBroadcastAgentStatus.get(ptyId),
  clearLastBroadcastAgentStatus: (ptyId: string) => { mocks.lastBroadcastAgentStatus.delete(ptyId); },
}));

vi.mock('../../notification/sendNotification', () => ({
  sendNotification: mocks.sendNotification,
}));

vi.mock('../../notification/rendererNotificationReadiness', () => ({
  isRendererNotificationListenerReady: () => true,
}));

import { PTYBridge } from '../PTYBridge';
import type { PTYManager, PTYInstance } from '../PTYManager';
import { clearPty, markResize } from '../../notification/idleSuppression';
import { HookSignalRouter } from '../../hooks/HookSignalRouter';
import { SignalLatencyMeter } from '../../../shared/hooks/SignalLatencyMeter';

function makeBridge(router?: HookSignalRouter) {
  let dataCb: ((data: string) => void) | null = null;
  const proc = {
    onData: (cb: (data: string) => void) => { dataCb = cb; },
    // No-op: this fixture is never exercised through the exit path.
    onExit: () => undefined,
  };
  const instance: PTYInstance = {
    id: 'p1',
    process: proc as unknown as PTYInstance['process'],
    shell: 'bash',
  };
  const manager = {
    get: vi.fn(() => instance),
    remove: vi.fn(),
    onDispose: vi.fn(),
  } as unknown as PTYManager;
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } };
  const bridge = new PTYBridge(manager, () => win as never, router ? () => router : undefined);
  bridge.setupDataForwarding('p1');
  // Let the 50ms micro-batch reach ActivityMonitor.
  const emit = (data: string) => {
    dataCb?.(data);
    vi.advanceTimersByTime(50);
  };
  return { bridge, emit };
}

function statuses(): Array<string | undefined> {
  return mocks.broadcastMetadataUpdate.mock.calls
    .map((c) => c[1] as { ptyId?: string; agentStatus?: string })
    .filter((p) => p.ptyId === 'p1' && p.agentStatus !== undefined)
    .map((p) => p.agentStatus);
}

describe('PTYBridge (local mode): a resize repaint is not a running turn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.broadcastMetadataUpdate.mockClear();
    mocks.lastBroadcastAgentStatus.clear();
    clearPty('p1');
  });
  afterEach(() => {
    clearPty('p1');
    vi.useRealTimers();
  });

  it('a repaint burst inside the resize-redraw guard window broadcasts neither running nor the idle after it', () => {
    const { emit } = makeBridge();
    markResize('p1');
    emit('x'.repeat(3000));
    vi.advanceTimersByTime(5_100);
    expect(statuses()).toEqual([]);
  });

  it('control: the same burst with no resize before it is broadcast running', () => {
    const { emit } = makeBridge();
    emit('x'.repeat(3000));
    expect(statuses()).toEqual(['running']);
  });

  it('a real turn that keeps writing past the guard window still reports running', () => {
    const { emit } = makeBridge();
    markResize('p1');
    emit('x'.repeat(3000));
    // 700 bytes every 250ms for 6s: no 5s idle gap, so the handed-back cycle
    // re-crosses the threshold once the guard window has elapsed.
    for (let i = 0; i < 24; i++) {
      vi.advanceTimersByTime(250);
      emit('y'.repeat(700));
    }
    expect(statuses()).toEqual(['running']);
  });

  // The daemon fix (#2251) exempts a cycle that a hook's running edge armed.
  // Local mode has no such cycle: nothing here calls beginTurn. A hook-governed
  // pane is kept running by its hook latch instead, and the byte path neither
  // broadcasts running for it nor clears it on idle. Guard rail, not a
  // regression case: it passes with and without the resize guard.
  it('a hook-governed turn with sparse output after a repaint stays running on its hook', () => {
    const router = new HookSignalRouter({ latencyMeter: new SignalLatencyMeter() });
    router.noteHookTurnStart('p1', Date.now(), 'claude');
    const { emit } = makeBridge(router);
    markResize('p1');
    emit('x'.repeat(3000));
    // 200 bytes a second for 10s: under the activity threshold, then silence.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1_000);
      emit('y'.repeat(200));
    }
    vi.advanceTimersByTime(5_100);
    expect(statuses()).toEqual([]);
    expect(router.governsRunningState('p1')).toBe(true);
  });
});
