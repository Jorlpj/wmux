// Probe for #2267 (issues agent, run 314, upstream 6a8214b07). Not a product
// test. Settles: after an owner's stop with an unknown workspace tree (the WSL
// worker left running, stopWorker answering 0 as stopTaskWorker does at
// factoryWiring.ts:472/:504), does the left worker hold an agent slot, and is
// its task folder kept?
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

import { TaskLedger } from '../../../daemon/ledger/TaskLedger';
import type { LedgerEntry } from '../../../shared/ledger';
import { STOPPED_BY_OWNER, __resetFactoryStopForTesting, stopFactoryWork, type FactoryStopPorts } from '../factoryStop';
import { AgentSlots, rowHoldsAgentSlot, type SlotLiveness } from '../agentSlots';
import { isReclaimableEnd, unreclaimedEndedWorkers } from '../workerReclaim';
import { TaskFolders, cleanTaskFolder, gitRepoInfo, type TaskFolderPorts } from '../taskFolderCleanup';
import { TaskWorktreeManager } from '../../worktask/TaskWorktreeManager';

const BOT = 'bot-0000000a';
const ID = 't-wsl';
const WS = `${ID}-ws`;

let dir = '';
let ledger: TaskLedger;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-probe-2267-')));
  ledger = new TaskLedger({ dir: path.join(dir, 'ledger') });
  __resetFactoryStopForTesting();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/** workerLifecycleHost.ts:418-419 with no resumed workers and no reclaim record. */
function liveWorkers(live: SlotLiveness | null): number {
  return ledger.list({ openOnly: true }).filter((r) => rowHoldsAgentSlot(r, live)).length
    + unreclaimedEndedWorkers(ledger.list({}), { get: () => null }, Date.now());
}

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

describe('#2267 probe: an owner stop that left the WSL worker running', () => {
  it('reports ok with no partial, then counts the left worker in no slot (tree unknown or known)', async () => {
    await ledger.register({ id: ID, taskWorkspaceId: WS, ownerWorkspaceId: 'ws-owner', title: 'perf-A', dispatch: { origin: { kind: 'bot', botId: BOT }, preset: 'default' } });
    const old = Date.now() + 10 * 60_000; // past SLOT_ROW_GRACE_MS
    const treeKnown: SlotLiveness = { workspaces: new Set([WS, 'ws-owner']), idleWorkspaces: new Set(), now: old };
    const treeUnknown: SlotLiveness = { workspaces: null, idleWorkspaces: new Set(), now: old };
    // Before the stop: the running worker holds one slot.
    expect(liveWorkers(treeKnown)).toBe(1);
    expect(liveWorkers(treeUnknown)).toBe(1);

    // stopTaskWorker with own === null drops the wslTarget session and returns 0.
    const stopWorker = vi.fn(async () => 0);
    const r = await stopFactoryWork(stopPorts(stopWorker), { botId: BOT });
    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(r.code).toBeUndefined();
    expect(r.tasksCancelled).toBe(1);
    expect(r.workersStopped).toBe(0);

    const row = ledger.get(ID) as LedgerEntry;
    expect(row).toMatchObject({ status: 'cancelled', summary: STOPPED_BY_OWNER });
    expect(row.updatedBy.kind).toBe('system');
    expect(isReclaimableEnd(row, row.status)).toBe(false);

    // After: the Linux claude still runs, but no count sees it.
    expect(liveWorkers(treeKnown)).toBe(0);
    expect(liveWorkers(treeUnknown)).toBe(0);
    expect(liveWorkers(null)).toBe(0);

    // So with a cap of 1 a new worker is granted at once, next to the left one.
    const slots = new AgentSlots({ cap: () => 1, runningBots: () => 0, liveWorkers: () => liveWorkers(treeKnown), pollMs: 60_000 });
    expect(slots.inUse()).toBe(0);
    const g = await slots.acquire({ taskId: 't-next', title: 'next', botId: BOT, ownerWorkspaceId: 'ws-owner' });
    expect(g.ok).toBe(true);
  });

  it('keeps the task folder busy while the left WSL session started in it (its /mnt path read as the Windows folder)', async () => {
    if (process.platform !== 'win32') return; // sessionHostDir maps only on win32
    const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const home = path.join(dir, 'home');
    const wmuxDir = path.join(dir, 'data');
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init');
    fs.writeFileSync(path.join(repo, 'x.txt'), '1');
    git(repo, 'add', 'x.txt');
    git(repo, 'commit', '-m', 'one');
    const slug = 'perf-a-12345678';
    const wt = path.join(home, 'worktrees', 'h', slug);
    const mgr = new TaskWorktreeManager();
    const made = await mgr.createWorktree({ repoRoot: repo, repoHash: 'h', taskSlug: slug, metaDir: path.join(dir, 'meta'), worktreePath: wt, branch: `wtask/${slug}` });
    if (!made.ok) throw new Error(made.error);
    const linux = `/mnt/${wt[0].toLowerCase()}${wt.slice(2).replace(/\\/g, '/')}`;
    const ports: TaskFolderPorts = {
      store: TaskFolders.at(wmuxDir),
      roots: { worktrees: path.join(home, 'worktrees'), wmuxDir },
      missions: async () => new Map(),
      listSessions: async () => [],
      workerState: () => null, // an owner's stop leaves no reclaim record
      worktrees: mgr,
      repoInfo: gitRepoInfo,
      now: () => 50_000,
      log: () => undefined,
    };
    const ended = {
      schemaVersion: 1, id: ID, taskWorkspaceId: WS, ownerWorkspaceId: 'ws-owner', title: 'perf-A',
      status: 'cancelled', rev: 3, updatedAt: 1_000, updatedBy: { kind: 'system', workspaceId: 'ws-daemon' }, summary: STOPPED_BY_OWNER,
      dispatch: { origin: { kind: 'bot', botId: BOT }, preset: 'default' },
    } as LedgerEntry;
    const mission = { folder: wt, branch: `wtask/${slug}` };
    const wslWorker = { id: 'daemon-wsl', spawnCwd: linux, cwd: linux, wslTarget: { distribution: 'Ubuntu' } };
    expect(await cleanTaskFolder(ports, ended, mission, [wslWorker])).toBe('busy');
    expect(fs.existsSync(wt)).toBe(true);
    // Control: once that session is gone the folder goes.
    expect(await cleanTaskFolder(ports, ended, mission, [])).toBe('removed');
  });
});
