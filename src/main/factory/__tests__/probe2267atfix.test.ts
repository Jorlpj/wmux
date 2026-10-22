// Probe for #2267 (issues agent, run 458, maintainer branch
// fix/2267-stop-wsl-worker-unknown-tree at f6a56cb17). Not a product test.
// Settles: what stopFactoryWork reports when stopTaskWorker throws the new
// WorkerStopPendingError after stopping the identified worker(s).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

import { TaskLedger } from '../../../daemon/ledger/TaskLedger';
import { __resetFactoryStopForTesting, stopFactoryWork, type FactoryStopPorts } from '../factoryStop';
import { WorkerStopPendingError, type WorkerStopRetryOutcome } from '../factoryWiring';

const BOT = 'bot-0000000a';
const ID = 't-wsl';
const WS = `${ID}-ws`;

let dir = '';
let ledger: TaskLedger;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-probe-2267fix-')));
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

describe('#2267 probe at the fix branch: a pending stop', () => {
  it('answers partial; the worker the record identified and stopped is not counted', async () => {
    await ledger.register({ id: ID, taskWorkspaceId: WS, ownerWorkspaceId: 'ws-owner', title: 'perf-A', dispatch: { origin: { kind: 'bot', botId: BOT }, preset: 'default' } });
    const retry: Promise<WorkerStopRetryOutcome> = Promise.resolve({ kind: 'stopped', workers: 1 });
    const stopWorker = vi.fn(async () => { throw new WorkerStopPendingError(1, ['daemon-wsl-unid'], retry, 120_000); });
    const r = await stopFactoryWork(stopPorts(stopWorker), { botId: BOT });
    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('partial');
    expect(r.message).toBe('Some work could not be stopped; stop again to retry.');
    expect(r.tasksCancelled).toBe(1);
    // The error carries workers: 1, but stopTask reads only a returned number.
    expect(r.workersStopped).toBe(0);
    expect((await retry).kind).toBe('stopped');
  });
});
