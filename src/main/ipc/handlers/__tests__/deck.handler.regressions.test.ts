// Regression pins for fixes whose change lives in deck.handler.ts and that
// shipped without a test of their own. One test per fix, named after it, so a
// later split of registerDeckHandler (card M-4) cannot drop one silently:
//   #2032 a resumed conversation's account reaches the Moa transcript lookup
//   #2036 that lookup resolves the account the way the brain's resume does
//   97b52f13e a counted automatic turn ends its goal turn only once it settles
//   542c86f33 a wake carrying another PC's Moa's work is recorded for the turn
//   30185f289 cross-host receipts for Moa are parked, not dropped, and the
//             brain-receiver probe is registered while the handler lives
//   02fbc31fc the Git page's review guide is wired to the Moa goal records

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captured = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      captured.set(channel, fn);
    }),
    removeHandler: vi.fn((channel: string) => captured.delete(channel)),
  },
  app: { once: vi.fn(), removeListener: vi.fn() },
}));

// What the previous app run persisted for a workspace's conversation.
const state = vi.hoisted(() => ({
  persisted: null as null | { sessionId: string; accountId?: string | null },
  transcriptDeps: [] as Array<{ getSessionEnv: (workspaceId: string) => Record<string, string> }>,
  goalOpts: [] as Array<{ turnWokenByRemoteMoa?: (hq: string) => boolean }>,
  goalServices: [] as Array<{ finishTurn: (workspaceId: string) => void }>,
  coalescerDeps: [] as Array<{ runTurn: (ws: string, prompt: string, wake?: { remoteMoa: boolean }) => Promise<unknown> }>,
}));

vi.mock('../../../deck/commanderSessionStore', () => ({
  loadCommanderSession: vi.fn(() => state.persisted),
  saveCommanderSession: vi.fn(async () => undefined),
  clearCommanderSession: vi.fn(async () => undefined),
}));

vi.mock('../../../deck/deckPolicy', () => ({
  loadDeckPolicyBlock: vi.fn(() => null),
  ensureDeckPolicySeed: vi.fn(() => undefined),
  getDeckPolicyPath: vi.fn(() => '/fake/deck-policy.md'),
}));

vi.mock('../../../deck/deckAutonomyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../deck/deckAutonomyStore')>();
  return {
    ...actual,
    loadWorkspaceAutonomy: vi.fn(() => ({ mode: 'danger', ...actual.modeToCaps('danger') })),
    loadWorkspaceMode: vi.fn(() => 'danger'),
    setWorkspaceMode: vi.fn(async () => ({ mode: 'danger', wakePolicy: 'all', ...actual.modeToCaps('danger') })),
    setWorkspaceAutonomy: vi.fn(async () => ({})),
  };
});

// Timers: never run intervals; the scheduler's runTurn is how an automatic turn is driven.
const schedulers: Array<{ deps: Record<string, unknown> }> = [];
vi.mock('../../../deck/DeckHeartbeat', () => ({
  DeckHeartbeat: class {
    constructor(public deps: Record<string, unknown>) {}
    start(): void { /* no interval */ }
    stop(): void { /* no interval */ }
  },
}));
vi.mock('../../../deck/DeckScheduler', () => ({
  DeckScheduler: class {
    constructor(public deps: Record<string, unknown>) {
      schedulers.push(this);
    }
    start(): void { /* no interval */ }
    stop(): void { /* no interval */ }
  },
}));

vi.mock('../../../deck/moaTranscript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../deck/moaTranscript')>();
  class CapturingMoaTranscript extends actual.MoaTranscript {
    constructor(deps: ConstructorParameters<typeof actual.MoaTranscript>[0]) {
      super(deps);
      state.transcriptDeps.push(deps as unknown as (typeof state.transcriptDeps)[number]);
    }
  }
  return { ...actual, MoaTranscript: CapturingMoaTranscript };
});

vi.mock('../../../account/backgroundLaunchAccount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../account/backgroundLaunchAccount')>();
  return { ...actual, resolveConversationAccount: vi.fn(actual.resolveConversationAccount) };
});

vi.mock('../../../deck/moaGoalHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../deck/moaGoalHost')>();
  return {
    ...actual,
    createMoaGoalService: vi.fn((opts: Parameters<typeof actual.createMoaGoalService>[0]) => {
      state.goalOpts.push(opts);
      const svc = actual.createMoaGoalService(opts);
      vi.spyOn(svc, 'finishTurn');
      state.goalServices.push(svc);
      return svc;
    }),
  };
});

vi.mock('../../../deck/CommanderEventCoalescer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../deck/CommanderEventCoalescer')>();
  class CapturingCoalescer extends actual.CommanderEventCoalescer {
    constructor(...args: ConstructorParameters<typeof actual.CommanderEventCoalescer>) {
      super(...args);
      state.coalescerDeps.push(args[0] as unknown as (typeof state.coalescerDeps)[number]);
    }
  }
  return { ...actual, CommanderEventCoalescer: CapturingCoalescer };
});

import { registerDeckHandler } from '../deck.handler';
import { IPC } from '../../../../shared/constants';
import type { BrainAdapter, BrainEvent, BrainSendOptions, BrainStartOptions } from '../../../deck/BrainAdapter';
import { CommanderEventCoalescer } from '../../../deck/CommanderEventCoalescer';
import { eventBus } from '../../../events/EventBus';
import { getWorkspaceMirror, __resetWorkspaceMirrorForTest } from '../../../workspace/WorkspaceMirror';
import { __resetHqMemoryForTest, setHqWorkspaceId, setMoaEnabled } from '../../../deck/deckHqStore';
import { getTaskLedger } from '../../../deck/taskLedgerHost';
import { __resetStartupDeckReconcileForTest } from '../../../deck/deckOrphanReconcile';
import { mintCommanderToken } from '../../../deck/commanderTrust';
import { __resetMoaPaneFeedForTest, setMoaPanePush } from '../../../deck/moaPaneFeed';
import { resolveConversationAccount } from '../../../account/backgroundLaunchAccount';
import { brainCanReceive } from '../../../a2a/brainReceiver';
import { ghPrService } from '../../../github/GhPrService';

/** Runs inside every fake turn, while the turn is in flight. */
let duringSend: ((text: string, opts: BrainSendOptions | undefined) => void) | null = null;

class FakeAdapter implements BrainAdapter {
  sessionId: string | null = null;
  conversationAccountId: string | null | undefined = undefined;
  constructor(public readonly workspaceId: string) {
    mintCommanderToken(workspaceId);
  }
  // Like the real adapters: a resumed conversation reports the account it resumed on.
  start(opts: BrainStartOptions): void {
    if (opts.resumeAccountId !== undefined) this.conversationAccountId = opts.resumeAccountId;
  }
  async *send(text: string, opts?: BrainSendOptions): AsyncIterable<BrainEvent> {
    duringSend?.(text, opts);
    yield { type: 'turn-end', sessionId: 'sess-1' } as BrainEvent;
  }
  interrupt(): void { /* no in-flight turn */ }
  dispose(): void { /* nothing held */ }
}

let adapters: FakeAdapter[];
let cleanup: (() => void) | null = null;
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: () => undefined },
} as unknown as import('electron').BrowserWindow;

function register(): void {
  cleanup = registerDeckHandler(() => fakeWindow, {
    createAdapter: (o: { workspaceId: string }) => {
      const a = new FakeAdapter(o.workspaceId);
      adapters.push(a);
      return a;
    },
  } as Parameters<typeof registerDeckHandler>[1]);
}

const invoke = (channel: string, payload?: unknown) => captured.get(channel)!({}, payload) as Promise<Record<string, unknown>>;
const send = (workspaceId: string) => invoke(IPC.DECK_SEND, { workspaceId, text: 'hi' });
const scheduledTurn = (ws: string) =>
  (schedulers.at(-1)!.deps.runTurn as (p: string, w: string) => Promise<Record<string, unknown>>)('scheduled', ws);
const mirror = (ids: string[]) => getWorkspaceMirror().setSnapshot({
  ts: Date.now(),
  entries: ids.map((id) => ({ id, name: id })),
  fleets: [],
  sessionRestored: true,
});
const transcriptEnv = (ws: string) => state.transcriptDeps.at(-1)!.getSessionEnv(ws);
const goalService = () => state.goalServices.at(-1)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  cleanup?.();
  cleanup = null;
  captured.clear();
  adapters = [];
  duringSend = null;
  schedulers.length = 0;
  state.persisted = null;
  state.transcriptDeps.length = 0;
  state.goalOpts.length = 0;
  state.goalServices.length = 0;
  state.coalescerDeps.length = 0;
  __resetWorkspaceMirrorForTest();
  __resetHqMemoryForTest();
  __resetStartupDeckReconcileForTest();
  __resetMoaPaneFeedForTest();
  setMoaPanePush(async () => ({ ok: true }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await setHqWorkspaceId(null);
  await setMoaEnabled(true);
  vi.mocked(resolveConversationAccount).mockClear();
  ghPrService.setMoaReviewGuideLookup(null);
  pushSpy = vi.spyOn(CommanderEventCoalescer.prototype, 'push');
  register();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('#2032 a resumed conversation keeps the account it started on', () => {
  it('the Moa transcript lookup resolves the persisted conversation account from the first turn on', async () => {
    state.persisted = { sessionId: 'sess-old', accountId: 'acct-1' };
    // Read while the resumed turn is still in flight: before its session id is
    // reported, the persisted record is the only source of the account.
    duringSend = () => {
      vi.mocked(resolveConversationAccount).mockClear();
      transcriptEnv('ws-a');
    };
    expect(await send('ws-a')).toMatchObject({ ok: true });
    expect(vi.mocked(resolveConversationAccount).mock.calls).toEqual([['ws-a', 'claude', 'acct-1']]);
  });

  it('a conversation persisted on the default login (null) reads no account overlay', async () => {
    state.persisted = { sessionId: 'sess-old', accountId: null };
    await send('ws-a');
    expect(transcriptEnv('ws-a')).toEqual({});
  });

  it('the account a new session reports replaces the persisted one', async () => {
    state.persisted = { sessionId: 'sess-old', accountId: 'acct-1' };
    duringSend = () => {
      adapters.at(-1)!.conversationAccountId = 'acct-2';
    };
    await send('ws-a');
    vi.mocked(resolveConversationAccount).mockClear();
    transcriptEnv('ws-a');
    expect(vi.mocked(resolveConversationAccount)).toHaveBeenCalledWith('ws-a', 'claude', 'acct-2');
  });
});

describe('#2036 the Moa transcript lookup uses the resume\'s account resolver', () => {
  it('an account that is gone falls back to the binding, the same as the resume', async () => {
    state.persisted = { sessionId: 'sess-old', accountId: 'acct-gone' };
    await send('ws-a');
    vi.mocked(resolveConversationAccount).mockClear();
    const env = transcriptEnv('ws-a');
    const results = vi.mocked(resolveConversationAccount).mock.results;
    expect(results).toHaveLength(1);
    const resolved = results[0].value as ReturnType<typeof resolveConversationAccount>;
    expect(resolved.fellBack).toBe(true);
    expect(env).toEqual(resolved.run.env);
  });
});

describe('97b52f13e a goal\'s counted turn keeps its powers until the turn ends', () => {
  it('an automatic turn calls finishTurn once, after the brain finished the turn', async () => {
    let finishedDuringTurn: number | null = null;
    duringSend = () => {
      finishedDuringTurn = vi.mocked(goalService().finishTurn).mock.calls.length;
    };
    expect(await scheduledTurn('ws-a')).toMatchObject({ ok: true });
    await flush();
    expect(finishedDuringTurn).toBe(0);
    expect(vi.mocked(goalService().finishTurn).mock.calls).toEqual([['ws-a']]);
  });

  it('a human press of Wake is not counted, so it ends no goal turn', async () => {
    expect(await invoke(IPC.DECK_WAKE, { workspaceId: 'ws-a' })).toMatchObject({ ok: true });
    await flush();
    expect(adapters).toHaveLength(1);
    expect(vi.mocked(goalService().finishTurn)).not.toHaveBeenCalled();
  });
});

describe('542c86f33 a wake carrying another PC\'s Moa\'s work is recorded for its turn', () => {
  it('the goal service sees the remote wake during that turn, and not during a plain one', async () => {
    const seen: boolean[] = [];
    duringSend = () => {
      seen.push(state.goalOpts.at(-1)!.turnWokenByRemoteMoa!('ws-a'));
    };
    const runTurn = state.coalescerDeps.at(-1)!.runTurn;
    await runTurn('ws-a', 'remote work arrived', { remoteMoa: true });
    await runTurn('ws-a', 'a worker finished', { remoteMoa: false });
    expect(seen).toEqual([true, false]);
  });
});

describe('30185f289 cross-host work for Moa waits until Moa can take it', () => {
  const remoteTaskId = `rt-${'a'.repeat(32)}`;
  const received = (to: string, over: Record<string, unknown> = {}) => eventBus.emit({
    type: 'a2a.received', workspaceId: to, to, from: 'PC-2/Moa', taskId: remoteTaskId,
    item: 'task', state: 'submitted', host: 'PC 2', ...over,
  } as Parameters<typeof eventBus.emit>[0]);
  let parked: Array<{ ownerWorkspaceId: string }>;

  beforeEach(async () => {
    parked = [];
    vi.spyOn(getTaskLedger(), 'recordOrphanedEvent').mockImplementation(async (rec) => {
      parked.push(rec as { ownerWorkspaceId: string });
      return undefined as never;
    });
    await setHqWorkspaceId('ws-hq');
    mirror(['ws-hq', 'ws-a']);
  });

  it('a receipt for the present HQ wakes it, with the sending PC\'s name canonicalized', () => {
    received('ws-hq');
    const pushed = (pushSpy.mock.calls as unknown[][]).map((c) => c[0] as { workspaceId: string; kind: string; a2a: { to: string; remote: { host: string } } });
    expect(pushed.map((e) => [e.workspaceId, e.kind, e.a2a.to, e.a2a.remote.host]))
      .toEqual([['ws-hq', 'a2a.received', 'ws-hq', 'remote-pc']]);
    expect(parked).toEqual([]);
  });

  it('a receipt for an HQ that is not the current one is parked under that HQ, not dropped', () => {
    received('ws-old-hq');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(parked.map((r) => r.ownerWorkspaceId)).toEqual(['ws-old-hq']);
  });

  it('a receipt whose task id is not a remote one, or whose workspace is not its target, is ignored', () => {
    received('ws-hq', { taskId: 'task-local' });
    received('ws-hq', { workspaceId: 'ws-a' });
    expect(pushSpy).not.toHaveBeenCalled();
    expect(parked).toEqual([]);
  });

  it('the brain-receiver probe says yes only for the present HQ, and is withdrawn on dispose', () => {
    expect(brainCanReceive('ws-hq')).toBe(true);
    expect(brainCanReceive('ws-a')).toBe(false);
    cleanup?.();
    cleanup = null;
    expect(brainCanReceive('ws-hq')).toBe(false);
  });
});

describe('02fbc31fc the review guide trusts only PRs this computer\'s Moa delivered', () => {
  it('registering the deck wires the lookup to the goal records, which know no other PR', () => {
    const lookup = (ghPrService as unknown as { moaReviewGuide: ((url: string) => unknown) | null }).moaReviewGuide;
    expect(lookup).toBeTypeOf('function');
    expect(lookup!('https://github.com/someone/repo/pull/1')).toBeNull();
  });
});
