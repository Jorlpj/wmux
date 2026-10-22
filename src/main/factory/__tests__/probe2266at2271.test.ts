// Probe (issues agent run 318, not for upstream): #2266 against #2271's head
// 64de068eb. A resumed WSL worker (daemon-1) whose record also holds the
// owner's split of the worker pane (daemon-2, recorded at reclaim because its
// spawnCwd is the task folder). Does the resumed-worker idle sweep close the
// owner's split?
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry } from '../../../shared/ledger';
import {
  RESUMED_IDLE_MS,
  ReclaimedWorkers,
  createResumedIdleSweep,
  resumedAgentAlive,
  type PaneActivity,
  type WorkerSessionInfo,
} from '../workerReclaim';

const BOT = 'bot-0000000a';
const TASK = 'wtask-abc-12345678';
const UUID = '2eca904b-b4cc-4243-81d3-67a121351892';
const MIN = 60_000;
const WSL = { distribution: 'Ubuntu' };

function row(status: LedgerEntry['status']): LedgerEntry {
  return {
    schemaVersion: 1, id: TASK, taskWorkspaceId: 'ws-task', ownerWorkspaceId: 'ws-owner', title: 'perf-A',
    status, rev: 3, updatedAt: 1_000, updatedBy: { kind: 'brain', workspaceId: 'ws-owner' },
    dispatch: { origin: { kind: 'bot', botId: BOT }, preset: 'default' },
  };
}

let dir: string;
let store: ReclaimedWorkers;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-2266-'));
  store = ReclaimedWorkers.at(dir);
  await store.put({
    taskId: TASK, botId: BOT, ownerWorkspaceId: 'ws-owner', taskWorkspaceId: 'ws-task', title: 'perf-A', threadId: `task:${TASK}` as never,
    ended: 'completed', state: 'resumed', at: 0, endRev: 3,
    sessions: [
      { sessionId: 'daemon-1', cwd: '/mnt/c/x', resumeSessionId: UUID },
      { sessionId: 'daemon-2', cwd: '/mnt/c/x' },
    ],
  });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function rig(activity: Record<string, PaneActivity>) {
  let at = 0;
  // The daemon answers `unsupported` for any wslTarget pane (src/daemon/index.ts stopAgent).
  const stopAgent = vi.fn(async () => ({ ok: false, code: 'unsupported' }));
  const closePane = vi.fn(async () => undefined);
  const sweep = createResumedIdleSweep({
    store,
    row: () => row('completed'),
    stopAgent,
    closePane,
    workspacePanes: (ws) => (ws === 'ws-task' ? ['daemon-1', 'daemon-2'] : null),
    now: () => at,
    paneActivity: (id) => ({ ...(activity[id] ?? {}) }),
    viewed: () => false,
    log: () => undefined,
  });
  return { sweep: (t: number, s: WorkerSessionInfo[]) => { at = t; return sweep.sweep(s); }, stopAgent, closePane };
}

// The worker: WSL, its launch line running, its resumed agent settled a minute in.
const worker: WorkerSessionInfo = { id: 'daemon-1', wslTarget: WSL, commandRunning: true };
const workerEnded: PaneActivity = { status: 'idle', turnEndAt: MIN };

describe('#2266 at #2271 64de068eb: the owner\'s split in a resumed worker\'s record', () => {
  it('A: split runs a plain command (no turn evidence): the worker is never idle-stopped, nothing is closed', async () => {
    const r = rig({ 'daemon-1': workerEnded });
    const split: WorkerSessionInfo = { id: 'daemon-2', wslTarget: WSL, commandRunning: true };
    for (const t of [RESUMED_IDLE_MS + MIN, 60 * MIN, 24 * 60 * MIN]) expect(await r.sweep(t, [worker, split])).toEqual([]);
    expect(r.stopAgent).not.toHaveBeenCalled();
    expect(r.closePane).not.toHaveBeenCalled();
    expect(store.get(TASK)?.state).toBe('resumed');
  });

  it('B: split runs a hooked agent that reported its turn end: both panes are closed', async () => {
    const r = rig({ 'daemon-1': workerEnded, 'daemon-2': { status: 'complete', turnStartAt: 0, turnEndAt: MIN } });
    const split: WorkerSessionInfo = { id: 'daemon-2', wslTarget: WSL, commandRunning: true };
    expect(await r.sweep(RESUMED_IDLE_MS + MIN, [worker, split])).toEqual([TASK]);
    expect(r.closePane.mock.calls.map((c) => c[0])).toEqual(['daemon-1', 'daemon-2']);
    expect(store.get(TASK)?.state).toBe('stopped');
  });

  it('C: split at its prompt: the worker pane is closed, the split is not, the record stays resumed and the exit sweep takes it', async () => {
    const r = rig({ 'daemon-1': workerEnded });
    const split: WorkerSessionInfo = { id: 'daemon-2', wslTarget: WSL, commandRunning: false };
    expect(await r.sweep(RESUMED_IDLE_MS + MIN, [worker, split])).toEqual([]);
    expect(r.closePane.mock.calls.map((c) => c[0])).toEqual(['daemon-1']);
    expect(r.stopAgent.mock.calls.map((c) => c[0])).toEqual(['daemon-1', 'daemon-2']);
    expect(store.get(TASK)?.state).toBe('resumed');
    // Next pass: daemon-1 is gone, the split at its prompt is not a worker pane.
    expect(await r.sweep(RESUMED_IDLE_MS + 2 * MIN, [split])).toEqual([]);
    expect(r.closePane).toHaveBeenCalledTimes(1);
    expect(resumedAgentAlive(store.get(TASK)!, [split])).toBe(false);
  });
});
