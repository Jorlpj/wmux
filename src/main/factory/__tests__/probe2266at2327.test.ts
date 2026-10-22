// Probe (issues agent run 452, not for upstream): #2266 case B against
// #2327's head 9ceecb8de, through reclaimWorker (run 318 seeded the record
// directly). daemon-1: the task's own WSL worker (its bot worker session
// record names the task); daemon-3: the owner's WSL split in the task
// workspace, cd'd into the task folder, running its own hooked claude, which
// the daemon attributed (agentProcessAlive true, its own resume binding).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry } from '../../../shared/ledger';
import {
  ReclaimedWorkers,
  reclaimWorker,
  resumeWorker,
  type WorkerReclaimPorts,
  type WorkerSessionInfo,
} from '../workerReclaim';

vi.mock('../../ipc/handlers/metadata.handler', () => ({
  getLastBroadcastAgentStatus: () => undefined,
  hasOutstandingRunningClaim: () => false,
  broadcastMetadataUpdate: () => undefined,
}));

const BOT = 'bot-0000000a';
const TASK = 'wtask-abc-12345678';
const WORKER_UUID = '2eca904b-b4cc-4243-81d3-67a121351892';
const OWNER_UUID = '7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const WSL = { distribution: 'Ubuntu-24.04', user: 'me' };

function row(status: LedgerEntry['status']): LedgerEntry {
  return {
    schemaVersion: 1, id: TASK, taskWorkspaceId: 'ws-task', ownerWorkspaceId: 'ws-owner', title: 'perf-A',
    status, rev: 3, updatedAt: 1_000, updatedBy: { kind: 'brain', workspaceId: 'ws-owner' },
    dispatch: { origin: { kind: 'bot', botId: BOT }, preset: 'default' },
  };
}

let dir: string;
let wt: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-2266-2327-'));
  wt = path.join(dir, 'wt');
  fs.mkdirSync(wt);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));

const worker = (over: Partial<WorkerSessionInfo> = {}): WorkerSessionInfo => ({
  id: 'daemon-1', pid: 10, spawnCwd: wt, wslTarget: WSL, commandRunning: true, agentProcessAlive: undefined,
  resumeBinding: { agent: 'claude', sessionId: WORKER_UUID, cwd: wt, permissionMode: 'bypassPermissions' }, ...over,
});
const ownerSplit = (over: Partial<WorkerSessionInfo> = {}): WorkerSessionInfo => ({
  id: 'daemon-3', pid: 30, spawnCwd: wt, wslTarget: WSL, commandRunning: true, agentProcessAlive: true,
  resumeBinding: { agent: 'claude', sessionId: OWNER_UUID, cwd: wt, permissionMode: 'default' }, ...over,
});
const both = (ws: string) => (ws === 'ws-task' ? ['daemon-1', 'daemon-3'] : []);
const sessionRecordOf = (id: string) => (id === 'daemon-1' ? { taskId: TASK } : null);

async function reclaim(store: ReclaimedWorkers, sessions: WorkerSessionInfo[]) {
  // The daemon refuses a stop of an unattributed WSL agent; an attributed one stops.
  const stopAgent = vi.fn(async (id: string) => (id === 'daemon-3' ? { ok: true, stopped: true } : { ok: false, code: 'unsupported' }));
  const closePane = vi.fn(async () => undefined);
  const ports: WorkerReclaimPorts = {
    onTransition: () => () => undefined,
    store,
    worktreeOf: async () => wt,
    listSessions: async () => sessions,
    stopAgent: stopAgent as never,
    closePane,
    workspacePanes: both,
    sessionRecordOf,
    note: vi.fn(),
    now: () => 5_000,
    log: () => undefined,
  };
  const rec = await reclaimWorker(ports, row('completed'), 'completed');
  return { rec, stopAgent, closePane };
}

async function resume(store: ReclaimedWorkers, live: WorkerSessionInfo[]) {
  const typeLine = vi.fn(() => true);
  const respawn = vi.fn(async () => ({ ok: true as const, workspaceId: 'ws-new', sessionId: 'daemon-9' }));
  const r = await resumeWorker({ store, listSessions: async () => live, typeLine, respawn, folderExists: () => true, now: () => 9_000, sessionRecordOf }, TASK, { kind: 'owner' });
  return { r, typeLine, respawn };
}

// After the stop: the owner's split at its prompt (its claude exited), the worker's pane closed.
const splitAtPrompt = () => ownerSplit({ agentProcessAlive: false, commandRunning: false, cwd: wt });

describe('#2266 case B at #2327 9ceecb8de, through the reclaim', () => {
  it('B1: the attributed split is stopped (not closed) and recorded with its own conversation', async () => {
    const store = ReclaimedWorkers.at(dir);
    const { rec, stopAgent, closePane } = await reclaim(store, [worker(), ownerSplit()]);
    expect(closePane.mock.calls).toEqual([['daemon-1']]);
    expect(stopAgent.mock.calls.map((c) => c[0])).toEqual(['daemon-1', 'daemon-3']);
    expect(rec?.state).toBe('stopped');
    expect(rec?.sessions.map((x) => [x.sessionId, x.resumeSessionId])).toEqual([['daemon-1', WORKER_UUID], ['daemon-3', OWNER_UUID]]);
  });

  it('B2a: worker listed first: Resume respawns the worker\'s conversation in a new pane; nothing typed into the split', async () => {
    const store = ReclaimedWorkers.at(dir);
    await reclaim(store, [worker(), ownerSplit()]);
    const { r, typeLine, respawn } = await resume(store, [splitAtPrompt()]);
    expect(r).toMatchObject({ ok: true, sessionId: 'daemon-9', resumeSessionId: WORKER_UUID });
    expect(typeLine).not.toHaveBeenCalled();
    expect(respawn).toHaveBeenCalledTimes(1);
  });

  it('B2b: split listed first: Resume types the OWNER\'s conversation into the owner\'s pane as the task\'s worker', async () => {
    const store = ReclaimedWorkers.at(dir);
    const { rec } = await reclaim(store, [ownerSplit(), worker()]);
    expect(rec?.sessions.map((x) => x.sessionId)).toEqual(['daemon-3', 'daemon-1']);
    const { r, typeLine, respawn } = await resume(store, [splitAtPrompt()]);
    expect(typeLine.mock.calls).toEqual([['daemon-3', `claude --resume ${OWNER_UUID}`]]);
    expect(respawn).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, sessionId: 'daemon-3', resumeSessionId: OWNER_UUID });
    expect(store.get(TASK)?.state).toBe('resumed');
  });

  it('B2c: worker first but with no recorded conversation: Resume also picks the owner\'s', async () => {
    const store = ReclaimedWorkers.at(dir);
    await reclaim(store, [worker({ resumeBinding: undefined }), ownerSplit()]);
    const { r, typeLine } = await resume(store, [splitAtPrompt()]);
    expect(typeLine.mock.calls).toEqual([['daemon-3', `claude --resume ${OWNER_UUID}`]]);
    expect(r).toMatchObject({ ok: true, sessionId: 'daemon-3' });
  });

  it('B2d: the owner restarted a command in the split: a later Resume is refused as already running', async () => {
    const store = ReclaimedWorkers.at(dir);
    await reclaim(store, [worker(), ownerSplit()]);
    const { r, respawn } = await resume(store, [ownerSplit({ agentProcessAlive: undefined, commandRunning: true, resumeBinding: undefined, cwd: wt })]);
    expect(r).toMatchObject({ ok: false });
    expect(respawn).not.toHaveBeenCalled();
    fs.appendFileSync(path.join(os.tmpdir(), 'probe2266-b2d.txt'), `${JSON.stringify(r)}\n`);
  });
});
