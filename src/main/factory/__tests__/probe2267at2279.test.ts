// Probe for #2267 against PR #2279 (issues agent, run 320). Not a product test.
// Base: #2279's head 828973ce0 (its merge base with main is b37f8ad69).
// #2279 makes TaskGateRunner hold one machine-wide permit (GATE_MAX_CONCURRENT
// = 1). Settles: (A) can #2267's leftover WSL worker (row cancelled by its
// owner, stopWorker answering 0 as stopTaskWorker does for an unknown tree)
// still get a gate, and so hold the one permit? (B) does an owner's stop
// cancel a gate that is still waiting in line (factoryStop's isRunning/cancel)?
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

import { TaskLedger } from '../../../daemon/ledger/TaskLedger';
import { DEFAULT_BOT_BUDGETS, type BotProfile } from '../../../shared/bot';
import type { LedgerEntry } from '../../../shared/ledger';
import { STOPPED_BY_OWNER, __resetFactoryStopForTesting, stopFactoryWork, type FactoryStopPorts } from '../factoryStop';
import { completeCheckedTask, installTaskGate } from '../taskGate';
import { TaskGateRunner, type GateExit, type GateProcess, type GateSpawn } from '../../worktask/TaskGateRunner';
import type { LedgerPort } from '../../worktask/ledgerPort';

const BOT = 'bot-0000000a';
const lead: BotProfile = {
  version: 1, id: BOT, workspaceId: 'ws-owner', role: 'lead', name: 'Lead', engine: { kind: 'claude-sdk' }, triggers: [],
  budget: { ...DEFAULT_BOT_BUDGETS.lead }, repo: { repoKey: 'github.com/acme/app', repoPath: '/repo' }, enabled: true, createdAt: 1, updatedAt: 1,
};

let dir = '';
let ledger: TaskLedger;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-probe-2267-2279-')));
  ledger = new TaskLedger({ dir: path.join(dir, 'ledger') });
  __resetFactoryStopForTesting();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 5));
};

/** Every spawn hangs until killed; records which worktree it ran in. */
function hangingSpawn(seen: string[]): GateSpawn {
  return (_cmd, _args, opts) => {
    seen.push(String((opts as { cwd?: string } | undefined)?.cwd ?? ''));
    let settle: ((e: GateExit) => void) | undefined;
    const proc: GateProcess = {
      onOutput: () => undefined,
      wait: () => new Promise<GateExit>((r) => { settle = r; }),
      kill: () => settle?.({ kind: 'exited', code: null }),
    };
    return proc;
  };
}

const noLedger: LedgerPort = { read: async () => null, writeGate: async () => ({ ok: true, rev: 0 }) } as unknown as LedgerPort;

function runner(seen: string[]): TaskGateRunner {
  return new TaskGateRunner({ ledger: noLedger, spawn: hangingSpawn(seen), readPackageScripts: () => ({ lint: 'eslint .' }), depsState: () => 'ok',
    // The base's package.json, read with git show in the product: the same scripts.
    readBaseFile: async (_wt, _ref, file) => (file === 'package.json' ? JSON.stringify({ scripts: { lint: 'eslint .' } }) : null), sameAsBase: async () => true, readHead: async () => null });
}

async function register(id: string): Promise<void> {
  await ledger.register({ id, taskWorkspaceId: `${id}-ws`, ownerWorkspaceId: 'ws-owner', title: id, dispatch: { origin: { kind: 'bot', botId: BOT }, preset: 'default' } });
}

async function report(id: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const row = ledger.get(id) as LedgerEntry;
  const r = await ledger.update({ id, status: 'review_requested', actor: { kind: 'worker', workspaceId: `${id}-ws` }, expectedRev: row.rev, summary: 'done' });
  return r.ok ? { ok: true } : { ok: false, error: r.error, message: r.message };
}

function stopPorts(gates: TaskGateRunner, only: string): FactoryStopPorts {
  return {
    runtime: () => ({ currentTurn: () => null, interrupt: () => ({ ok: true }) }),
    botIds: () => [BOT],
    ledger: {
      get: (id: string) => ledger.get(id),
      list: (f?: Parameters<TaskLedger['list']>[0]) => ledger.list(f).filter((r) => r.id === only),
      update: (i: Parameters<TaskLedger['update']>[0]) => ledger.update(i),
    } as unknown as FactoryStopPorts['ledger'],
    gates: () => gates,
    stopWorker: async () => 0, // stopTaskWorker for an unknown tree: the WSL session is dropped
    log: () => undefined,
  };
}

describe('#2267 probe at #2279: the leftover WSL worker and the one gate permit', () => {
  it('(A) a report from the owner-stopped (cancelled) row is refused, so it never takes the permit', async () => {
    const seen: string[] = [];
    const gates = runner(seen);
    const runGate = vi.fn((input: Parameters<TaskGateRunner['run']>[0]) => gates.run(input));
    const off = installTaskGate({
      onTransition: (fn) => ledger.onTransition(fn),
      ledgerRow: (id) => ledger.get(id),
      openRows: () => ledger.list({ openOnly: true }),
      bot: (id) => (id === BOT ? lead : null),
      worktreeOf: async (e) => `/wt/${e.id}`,
      baseRef: async () => 'origin/main',
      runGate,
      complete: (id) => completeCheckedTask(ledger, id),
      wake: () => undefined,
      note: () => undefined,
    });
    await register('t-wsl');
    await register('t-other');

    const r = await stopFactoryWork(stopPorts(gates, 't-wsl'), { botId: BOT });
    expect(r).toMatchObject({ ok: true, tasksCancelled: 1, workersStopped: 0 });
    expect(ledger.get('t-wsl')).toMatchObject({ status: 'cancelled', summary: STOPPED_BY_OWNER });

    // The left Linux claude finishes and reports: cancelled is terminal.
    const late = await report('t-wsl');
    expect(late).toMatchObject({ ok: false, error: "illegal_transition" });
    expect(late.message).toMatch(/^cancelled → review_requested is not an allowed transition/);
    await flush();
    expect(runGate).not.toHaveBeenCalled();
    expect(gates.load()).toEqual({ running: 0, waiting: 0 });
    expect(gates.isRunning('t-wsl')).toBe(false);

    // Control: the rig is live, an open task's report takes the permit.
    expect((await report('t-other')).ok).toBe(true);
    await flush();
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(gates.load()).toEqual({ running: 1, waiting: 0 });
    expect(seen).toEqual(['/wt/t-other']);
    gates.cancel('t-other');
    await flush();
    off();
  });

  it('(B) an owner stop cancels a gate still waiting in line; the waiter never spawns', async () => {
    const seen: string[] = [];
    const gates = runner(seen);
    await register('t-wsl');
    const holder = gates.run({ taskId: 't-holder', worktreePath: '/wt/t-holder', systemWorkspaceId: 'ws-daemon' });
    await flush();
    const waiter = gates.run({ taskId: 't-wsl', worktreePath: '/wt/t-wsl', systemWorkspaceId: 'ws-daemon' });
    await flush();
    expect(gates.load()).toEqual({ running: 1, waiting: 1 });
    expect(gates.isRunning('t-wsl')).toBe(true); // a waiting gate counts as running (folder cleanup: busy)

    const r = await stopFactoryWork(stopPorts(gates, 't-wsl'), { botId: BOT });
    expect(r).toMatchObject({ ok: true, tasksCancelled: 1, gatesCancelled: 1, workersStopped: 0 });
    const res = await waiter;
    expect(res).toMatchObject({ status: 'completed', result: { exitCode: null } });
    expect(gates.isRunning('t-wsl')).toBe(false);
    expect(gates.load()).toEqual({ running: 1, waiting: 0 });
    expect(seen).toEqual(['/wt/t-holder']);
    gates.cancel('t-holder');
    await holder;
    expect(gates.load()).toEqual({ running: 0, waiting: 0 });
  });
});
