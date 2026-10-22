// @vitest-environment jsdom
//
// #2101 sandbox experiment (not a product test). Mounts the real
// RemoteWorkspaceView on the real store, with a fake main that keeps the
// REMOTE_PANE_ATTACH / REMOTE_PANE_DETACH semantics of remote.handler.ts
// (idempotent per (sender, host, session), #1323 viewers, unique ids, handled
// synchronously in arrival order, replies delivered FIFO later) and a stub
// mirror that detaches its attachId on change like RemoteMirrorTerminal does.
// Question: can any interleaving of the two suspected causes (attachEpoch
// flapping through stale on/off, pane.sessionId arriving in steps) or a
// second open of the same workspace leave a visible cell at attachId null with
// no error, or holding an attachId main no longer serves?
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import RemoteWorkspaceView from '../RemoteWorkspaceView';
import { useStore } from '../../../stores';
import type { RemotePaneSummary } from '../../../../shared/remoteHosts';

vi.mock('../../../hooks/useT', () => ({ useT: () => (k: string) => k }));

// ---- fake main ------------------------------------------------------------
interface Stream { id: string; session: string; viewers: Set<string> }
const streams = new Map<string, Stream>();
const byKey = new Map<string, string>();
const viewerStream = new Map<string, string>();
let seq = 0;
let viewerSeq = 0;
/** 'viewers' = main since #2056 (a4dd2b11c); 'shared' = main before #2056
 *  (270774ddb, the #2053 head that was live-verified): a second attach for
 *  the same key gets the SAME id back and any detach of it closes the stream. */
let mode: 'viewers' | 'shared' = 'viewers';
const replies: Array<() => void> = [];
const log: string[] = [];

function mainAttach(session: string): string {
  const existing = byKey.get(session);
  if (existing && mode === 'shared') return existing;
  if (existing) {
    const s = streams.get(existing)!;
    viewerSeq += 1;
    const v = `${existing}~${viewerSeq}`;
    s.viewers.add(v);
    viewerStream.set(v, existing);
    return v;
  }
  seq += 1;
  const id = `st${seq}`;
  streams.set(id, { id, session, viewers: new Set([id]) });
  viewerStream.set(id, id);
  byKey.set(session, id);
  return id;
}
function mainDetach(viewer: string): void {
  const sid = viewerStream.get(viewer);
  viewerStream.delete(viewer);
  if (!sid) return;
  const s = streams.get(sid)!;
  s.viewers.delete(viewer);
  if (s.viewers.size === 0 || mode === 'shared') {
    for (const v of s.viewers) viewerStream.delete(v);
    streams.delete(sid);
    if (byKey.get(s.session) === sid) byKey.delete(s.session);
  }
}
const isLive = (viewer: string): boolean => viewerStream.has(viewer);

// ---- stub mirror: same attachId-keyed detach as RemoteMirrorTerminal ------
vi.mock('../RemoteMirrorTerminal', () => ({
  default: ({ attachId, error, sessionId }: { attachId: string | null; error?: string; sessionId: string }) => {
    React.useEffect(() => {
      log.push(`mirror ${sessionId} shows ${attachId ?? 'null'}`);
      if (!attachId) return;
      return () => { log.push(`mirror ${sessionId} drops ${attachId}`); void window.electronAPI!.remote!.paneDetach(attachId); };
    }, [attachId]);
    return React.createElement('div', {
      'data-cell': sessionId,
      'data-attach-id': attachId ?? '',
      'data-error': error ?? '',
    });
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installApi(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    remote: {
      paneAttach: (_h: string, session: string) => {
        const id = mainAttach(session); // handled at arrival, like ipcMain
        log.push(`attach ${session} -> ${id}`);
        return new Promise((resolve) => { replies.push(() => { log.push(`reply ${id}`); resolve({ ok: true, attachId: id }); }); });
      },
      paneDetach: (id: string) => {
        mainDetach(id);
        log.push(`detach ${id}`);
        return new Promise<void>((resolve) => { replies.push(() => resolve()); });
      },
      hostsList: async () => [{ id: 'h1', label: 'pc', origin: 'https://x', addedAt: 0, allowInput: true }],
    },
  };
}

const KEY = 'h1:ws-1';
function Host(): React.ReactElement | null {
  const w = useStore((s) => s.remoteWorkspaces.find((r) => r.key === KEY));
  return w ? React.createElement(RemoteWorkspaceView, { workspace: w }) : null;
}

let container: HTMLDivElement;
let root: Root;

async function flushMicro(): Promise<void> {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}
async function deliver(n: number): Promise<void> {
  for (let i = 0; i < n && replies.length > 0; i += 1) {
    replies.shift()!();
    await flushMicro();
  }
}
async function drain(): Promise<void> {
  for (let guard = 0; guard < 500 && replies.length > 0; guard += 1) await deliver(1);
  await flushMicro();
}

function open(panes: RemotePaneSummary[]): void {
  act(() => {
    useStore.getState().attachRemoteWorkspace({
      key: KEY, hostId: 'h1', hostLabel: 'pc', workspaceId: 'ws-1', name: 'WS', panes,
    });
  });
}

/** Visible cells that are blank with no error, or hold a dead id. */
function badCells(): string[] {
  const out: string[] = [];
  const w = useStore.getState().remoteWorkspaces.find((r) => r.key === KEY);
  for (const p of (w?.panes ?? []).slice(0, 6)) {
    const el = container.querySelector(`[data-cell="${p.sessionId}"]`);
    if (!el) { out.push(`${p.sessionId}: no cell`); continue; }
    const id = el.getAttribute('data-attach-id') ?? '';
    const err = el.getAttribute('data-error') ?? '';
    if (err) continue;
    if (!id) out.push(`${p.sessionId}: attachId null, no error`);
    else if (!isLive(id)) out.push(`${p.sessionId}: holds dead ${id}`);
  }
  return out;
}

/** Streams main still serves that no mounted cell holds (a leak). */
function leaked(): string[] {
  const held = new Set([...container.querySelectorAll('[data-attach-id]')].map((e) => e.getAttribute('data-attach-id')));
  return [...viewerStream.keys()].filter((v) => !held.has(v));
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

beforeEach(() => {
  streams.clear(); byKey.clear(); viewerStream.clear(); replies.length = 0; log.length = 0;
  seq = 0; viewerSeq = 0;
  installApi();
  useStore.setState({ remoteWorkspaces: [], activeRemoteKey: null } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function mount(strict: boolean): void {
  act(() => {
    const el = React.createElement(Host);
    root.render(strict ? React.createElement(React.StrictMode, null, el) : el);
  });
}

for (const m of ['viewers', 'shared'] as const) describe(`#2101 probe — main mode ${m}`, () => {
  beforeEach(() => { mode = m; });
  for (const strict of [false, true]) {
    it(`epoch flapping while attaches are in flight (strict=${strict})`, async () => {
      mount(strict);
      open([{ sessionId: 's1' }]);
      await flushMicro();
      for (let i = 0; i < 6; i += 1) {
        act(() => { useStore.getState().setRemoteWorkspaceStale(KEY, true); });
        act(() => { useStore.getState().setRemoteWorkspaceStale(KEY, false); });
        await deliver(i % 3);
      }
      await drain();
      console.log(`[probe2101] mode=${m} ${expect.getState().currentTestName}: bad=${JSON.stringify(badCells())} leak=${JSON.stringify(leaked())} log=${log.join("; ")}`);
      if (m === 'viewers') {
        expect(badCells(), log.join('\n')).toEqual([]);
        expect(leaked(), log.join('\n')).toEqual([]);
      }
    });

    it(`sessionId arriving in steps, then a second open (strict=${strict})`, async () => {
      mount(strict);
      open([]);
      await flushMicro();
      act(() => { useStore.getState().setRemoteWorkspaceStale(KEY, true); });
      act(() => { useStore.getState().setRemoteWorkspacePanes(KEY, [{ sessionId: 's1' }]); });
      await deliver(1);
      log.push('-- panes [s2]');
      act(() => { useStore.getState().setRemoteWorkspacePanes(KEY, [{ sessionId: 's2' }]); });
      log.push('-- open [s2]');
      open([{ sessionId: 's2' }]);
      log.push('-- panes [s2, s1]');
      act(() => { useStore.getState().setRemoteWorkspacePanes(KEY, [{ sessionId: 's2' }, { sessionId: 's1' }]); });
      await drain();
      console.log(`[probe2101] mode=${m} ${expect.getState().currentTestName}: bad=${JSON.stringify(badCells())} leak=${JSON.stringify(leaked())} log=${log.join("; ")}`);
      if (m === 'viewers') {
        expect(badCells(), log.join('\n')).toEqual([]);
        expect(leaked(), log.join('\n')).toEqual([]);
      }
    });
  }

  it('seeded fuzz: stale flaps, pane-list churn (incl. >6 panes), re-opens, reply timing', async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = rng(seed);
      streams.clear(); byKey.clear(); viewerStream.clear(); replies.length = 0; log.length = 0;
      act(() => { root.unmount(); });
      root = createRoot(container);
      useStore.setState({ remoteWorkspaces: [], activeRemoteKey: null } as never);
      mount(seed % 2 === 0);
      const pool = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
      const pick = (): RemotePaneSummary[] =>
        pool.filter(() => r() < 0.5).map((sessionId) => ({ sessionId }));
      open(pick());
      for (let step = 0; step < 25; step += 1) {
        const x = r();
        if (x < 0.25) act(() => { useStore.getState().setRemoteWorkspaceStale(KEY, r() < 0.5); });
        else if (x < 0.5) act(() => { useStore.getState().setRemoteWorkspacePanes(KEY, pick()); });
        else if (x < 0.6) open(pick());
        else await deliver(1 + Math.floor(r() * 3));
        if (r() < 0.3) await flushMicro();
      }
      await drain();
      const bad = badCells();
      const leak = leaked();
      if (bad.length || leak.length) failures.push(`seed ${seed}: bad=${JSON.stringify(bad)} leak=${JSON.stringify(leak)}`);
    }
    const nulls = failures.filter((f) => f.includes('attachId null')).length;
    const dead = failures.filter((f) => f.includes('holds dead')).length;
    console.log(`[probe2101] mode=${m} seeds=300 failing=${failures.length} null-no-error=${nulls} dead-id=${dead}`);
    console.log(failures.slice(0, 5).join(' | '));
    if (m === 'viewers') expect(failures).toEqual([]);
  }, 120_000);
});
