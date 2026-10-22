// Probe for #2267 (issues agent, run 467, maintainer PR #2332 at 3f0e69059:
// the timed WSL stop retry is gone; a pending stop reports the
// workspaces_loading message). Not a product test.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

import { TaskLedger } from '../../../daemon/ledger/TaskLedger';
import {
  __resetFactoryStopForTesting,
  stopFactoryTask,
  stopFactoryWork,
  WORKSPACES_LOADING_MESSAGE,
  type FactoryStopPorts,
} from '../factoryStop';
import { WorkerStopPendingError } from '../factoryWiring';

const BOT = 'bot-0000000a';
const GENERIC_WORK = 'Some work could not be stopped; stop again to retry.';
const GENERIC_TASK = 'The worker could not be stopped; stop again to retry.';

let dir = '';
let ledger: TaskLedger;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-probe-2267at2332-')));
  ledger = new TaskLedger({ dir: path.join(dir, 'ledger') });
  __resetFactoryStopForTesting();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function stopPorts(stopWorker: FactoryStopPorts['stopWorker']): FactoryStopPorts {
  return {
    runtime: () => ({ currentTurn: () => null, interrupt: () => ({ ok: true }) }),
    botIds: () => [BOT],
    ledger,
    gates: () => null,
    stopWorker,
    log: () => undefined,
  };
}

async function register(id: string): Promise<void> {
  await ledger.register({ id, taskWorkspaceId: `${id}-ws`, ownerWorkspaceId: 'ws-owner', title: id, dispatch: { origin: { kind: 'bot', botId: BOT }, preset: 'default' } });
}

describe('#2267 probe at #2332 3f0e69059', () => {
  it('(a) bot-wide stop, only a pending WSL stop: partial, counted, loading message', async () => {
    await register('t-a');
    const stopWorker = vi.fn(async () => { throw new WorkerStopPendingError(1, ['daemon-wsl-unid']); });
    const r = await stopFactoryWork(stopPorts(stopWorker), { botId: BOT });
    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('partial');
    expect(r.workersStopped).toBe(1);
    expect(r.tasksCancelled).toBe(1);
    expect(r.message).toBe(WORKSPACES_LOADING_MESSAGE);
  });

  it('(b) bot-wide stop, a pending stop plus another failure: the generic message', async () => {
    await register('t-b1');
    await register('t-b2');
    const stopWorker = vi.fn(async (row: { id: string }) => {
      if (row.id === 't-b1') throw new WorkerStopPendingError(0, ['daemon-wsl-unid']);
      throw new Error('the daemon is not connected');
    });
    const r = await stopFactoryWork(stopPorts(stopWorker), { botId: BOT });
    expect(stopWorker).toHaveBeenCalledTimes(2);
    expect(r.code).toBe('partial');
    expect(r.message).toBe(GENERIC_WORK);
  });

  it('(c) one-task stop, only a pending WSL stop: loading message; another failure: generic', async () => {
    await register('t-c');
    const r1 = await stopFactoryTask(stopPorts(vi.fn(async () => { throw new WorkerStopPendingError(1, ['x']); })), 't-c');
    expect(r1.code).toBe('partial');
    expect(r1.workersStopped).toBe(1);
    expect(r1.message).toBe(WORKSPACES_LOADING_MESSAGE);
    await register('t-c2');
    const r2 = await stopFactoryTask(stopPorts(vi.fn(async () => { throw new Error('boom'); })), 't-c2');
    expect(r2.code).toBe('partial');
    expect(r2.message).toBe(GENERIC_TASK);
  });

  it('(d) the re-stop of a task stopped before (agentsOnly) reports the loading message too', async () => {
    await register('t-d');
    const first = await stopFactoryWork(stopPorts(vi.fn(async () => 0)), { botId: BOT });
    expect(first.ok).toBe(true);
    expect(first.tasksCancelled).toBe(1);
    const calls: unknown[] = [];
    const again = vi.fn(async (_row: unknown, opts?: { agentsOnly?: boolean }) => {
      calls.push(opts);
      throw new WorkerStopPendingError(0, ['daemon-wsl-unid']);
    });
    const r = await stopFactoryWork(stopPorts(again), { botId: BOT });
    expect(calls).toEqual([{ agentsOnly: true }]);
    expect(r.code).toBe('partial');
    expect(r.message).toBe(WORKSPACES_LOADING_MESSAGE);
    const t = await stopFactoryTask(stopPorts(again), 't-d');
    expect(t.code).toBe('partial');
    expect(t.message).toBe(WORKSPACES_LOADING_MESSAGE);
  });
});
