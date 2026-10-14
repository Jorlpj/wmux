// Regression pins for the daemon's resume-binding writer (applyResumeBinding in
// src/daemon/index.ts, the body of the `daemon.setResumeBinding` RPC), proven
// against the REAL bundled daemon: a binding goes in over the pipe and the test
// reads what the daemon persisted to sessions.json. Each guard below was a fix
// whose change lives in index.ts:
//   #1738 a binding without its folder is refused, like an empty one
//   #1823 (#1840) a Claude id that is not uuid-shaped is never stored
//   #771  a transcript path outside the Claude projects root is dropped, the
//         rest of the binding kept
//   #230  an older capture never replaces a newer one, and the first path for
//         the same conversation is written at once (it is the D5 probe input)
//   #1627 a capture with no path for another conversation does not displace a
//         binding that has one
//
// registerRpcHandlers cannot be constructed in a unit test, so this is the
// narrowest boundary that runs the real code. The daemon runs under its own
// data suffix and pipe, inside the per-run temp HOME (isolateDataDir), so it
// never touches a developer's live daemon or sessions.
//
// Skipped when dist/daemon-bundle/index.js is absent and on non-Windows (the
// pipe client below speaks the win32 named pipe), like webRestart.runtime.test.ts.
// CI's validate-runtime job (windows-latest) builds the bundle first and sets
// WMUX_REQUIRE_DAEMON_BUNDLE=1, which turns a missing bundle into a red test.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const BUNDLE = path.join(process.cwd(), 'dist', 'daemon-bundle', 'index.js');
const HAVE_BUNDLE = fs.existsSync(BUNDLE);
const IS_WIN = process.platform === 'win32';
const CAN_RUN = HAVE_BUNDLE && IS_WIN;
const BUNDLE_PROMISED = process.env.WMUX_REQUIRE_DAEMON_BUNDLE === '1';

const SUFFIX = '-resume-binding-test';
const WMUX_DIR = path.join(os.homedir(), `.wmux${SUFFIX}`);
const PIPE = `\\\\.\\pipe\\wmux-daemon${SUFFIX}-${os.userInfo().username || 'default'}`;
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects', 'resume-binding-test');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const uuid = (): string => crypto.randomUUID();

function rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let token: string;
    try {
      token = fs.readFileSync(path.join(WMUX_DIR, 'daemon-auth-token'), 'utf8').trim();
    } catch {
      reject(new Error('daemon auth token not written yet'));
      return;
    }
    const id = crypto.randomUUID();
    const sock = net.connect(PIPE);
    let buf = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`RPC timeout: ${method}`))), 15_000);
    sock.on('connect', () => sock.write(JSON.stringify({ id, method, params, token, clientName: 'wmux-cli' }) + '\n'));
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const res = JSON.parse(line) as { id: string; ok?: boolean; result?: Record<string, unknown>; error?: string };
          if (res.id !== id) continue;
          finish(() => (res.ok === false ? reject(new Error(res.error ?? `${method} rejected`)) : resolve(res.result ?? {})));
        } catch {
          /* ignore malformed lines */
        }
      }
    });
    sock.on('error', (e) => finish(() => reject(e)));
    sock.on('close', () => finish(() => reject(new Error('closed before reply'))));
  });
}

interface StoredBinding {
  agent: string;
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  ts?: number;
}

type StoredPane = { resumeBinding?: StoredBinding; lastDetectedAgent?: string };

function readState(): string | null {
  try {
    const text = fs.readFileSync(path.join(WMUX_DIR, 'sessions.json'), 'utf8');
    JSON.parse(text);
    return text;
  } catch (err) {
    // Replaced atomically: on Windows a read can fall between unlink and rename.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) return null;
    throw err;
  }
}

/**
 * What the daemon persisted for one pane, once the file has settled.
 *
 * saveImmediate writes sessions.json before the RPC returns. A cwd change the
 * new shell reported may have queued an async write of an older snapshot; when
 * it lands after the immediate one, StateWriter restores the newer payload
 * right away (its epoch check). A read in that window would see the older
 * snapshot, so a read counts only once two reads 100 ms apart agree. Bounded
 * at 2 s, well inside the 30 s debounce, so a later write cannot stand in for
 * one the RPC failed to make.
 */
async function stored(id: string): Promise<StoredPane | undefined> {
  let last: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const text = readState();
    if (text !== null && text === last) {
      const state = JSON.parse(text) as { sessions: Array<StoredPane & { id: string }> };
      return state.sessions.find((s) => s.id === id);
    }
    last = text;
    await sleep(100);
  }
  throw new Error('sessions.json did not settle within 2 s');
}

/** createSession persists the new pane before it returns; the read still waits, bounded, for slow runners. */
const eventually = (assertion: () => Promise<void>): Promise<void> =>
  vi.waitFor(assertion, { timeout: 5_000, interval: 50 });

let child: ChildProcess | null = null;
let workDir = '';
const output: string[] = [];

async function createPane(id: string): Promise<void> {
  await rpc('daemon.createSession', { id, cwd: workDir, cmd: process.env.ComSpec || 'cmd.exe', cols: 80, rows: 24 });
  await eventually(async () => expect(await stored(id)).toBeDefined());
}

const setBinding = async (id: string, resumeBinding: Record<string, unknown>): Promise<boolean> =>
  (await rpc('daemon.setResumeBinding', { id, resumeBinding })).ok === true;

describe.runIf(BUNDLE_PROMISED)('resume-binding writer suite prerequisites', () => {
  it('has the daemon bundle the promising job was supposed to build', () => {
    expect(HAVE_BUNDLE).toBe(true);
  });
});

describe.skipIf(!CAN_RUN)('daemon.setResumeBinding guards (real daemon)', () => {
  beforeAll(async () => {
    fs.rmSync(WMUX_DIR, { recursive: true, force: true });
    workDir = fs.mkdtempSync(path.join(os.homedir(), 'resume-binding-cwd-'));
    child = spawn(process.execPath, [BUNDLE], {
      env: { ...process.env, WMUX_DATA_SUFFIX: SUFFIX },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (c: Buffer) => void output.push(c.toString()));
    child.stderr?.on('data', (c: Buffer) => void output.push(c.toString()));
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        await rpc('daemon.ping');
        return;
      } catch {
        /* not ready yet */
      }
    }
    throw new Error(`daemon never became ready:\n${output.join('')}`);
  }, 60_000);

  afterAll(async () => {
    const pid = child?.pid;
    if (pid && child?.exitCode === null) {
      // Tree kill: the panes' shells are the daemon's children.
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
      await new Promise<void>((r) => {
        if (child?.exitCode !== null) r();
        else child.once('exit', () => r());
        setTimeout(r, 10_000);
      });
    }
    fs.rmSync(WMUX_DIR, { recursive: true, force: true });
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }, 30_000);

  it('#1738 refuses a binding without its folder and stores nothing, then takes the same binding with one', async () => {
    await createPane('pin-1738');
    const sessionId = uuid();
    expect(await setBinding('pin-1738', { agent: 'claude', sessionId, cwd: '', ts: Date.now() })).toBe(false);
    expect((await stored('pin-1738'))?.resumeBinding).toBeUndefined();
    expect(await setBinding('pin-1738', { agent: 'claude', sessionId, cwd: workDir, ts: Date.now() })).toBe(true);
    expect((await stored('pin-1738'))?.resumeBinding).toMatchObject({ agent: 'claude', sessionId, cwd: workDir });
  }, 30_000);

  it('#1823 never stores a Claude binding whose id is not uuid-shaped (a Codex rollout stem)', async () => {
    await createPane('pin-1823');
    const stem = `rollout-2026-10-01T10-00-00-${uuid()}`;
    expect(await setBinding('pin-1823', { agent: 'claude', sessionId: stem, cwd: workDir, ts: Date.now() })).toBe(false);
    expect((await stored('pin-1823'))?.resumeBinding).toBeUndefined();
  }, 30_000);

  it('#771 drops a transcript path outside the Claude projects root and keeps the rest of the binding', async () => {
    await createPane('pin-771');
    const sessionId = uuid();
    const outside = path.join(os.homedir(), 'elsewhere', `${sessionId}.jsonl`);
    expect(await setBinding('pin-771', { agent: 'claude', sessionId, cwd: workDir, transcriptPath: outside, ts: Date.now() })).toBe(true);
    expect((await stored('pin-771'))?.resumeBinding).toMatchObject({ agent: 'claude', sessionId, cwd: workDir });
    expect((await stored('pin-771'))?.resumeBinding?.transcriptPath).toBeUndefined();

    const inside = path.join(CLAUDE_PROJECTS, `${sessionId}.jsonl`);
    expect(await setBinding('pin-771', { agent: 'claude', sessionId, cwd: workDir, transcriptPath: inside, ts: Date.now() })).toBe(true);
    expect((await stored('pin-771'))?.resumeBinding?.transcriptPath).toBe(inside);
  }, 30_000);

  it('#230 an older capture never replaces a newer one', async () => {
    await createPane('pin-230-stale');
    const newer = uuid();
    const older = uuid();
    const now = Date.now();
    expect(await setBinding('pin-230-stale', { agent: 'claude', sessionId: newer, cwd: workDir, ts: now })).toBe(true);
    expect(await setBinding('pin-230-stale', { agent: 'claude', sessionId: older, cwd: workDir, ts: now - 60_000 })).toBe(true);
    expect((await stored('pin-230-stale'))?.resumeBinding?.sessionId).toBe(newer);
    // A captured binding proves claude ran in the pane: the resume pill's gate is written with it.
    expect((await stored('pin-230-stale'))?.lastDetectedAgent).toBe('claude');
  }, 30_000);

  it('#230 the first transcript path for the same conversation is written to disk at once', async () => {
    await createPane('pin-230-path');
    const sessionId = uuid();
    const transcriptPath = path.join(CLAUDE_PROJECTS, `${sessionId}.jsonl`);
    const now = Date.now();
    expect(await setBinding('pin-230-path', { agent: 'claude', sessionId, cwd: workDir, ts: now })).toBe(true);
    expect((await stored('pin-230-path'))?.resumeBinding?.transcriptPath).toBeUndefined();
    expect(await setBinding('pin-230-path', { agent: 'claude', sessionId, cwd: workDir, transcriptPath, ts: now + 1 })).toBe(true);
    expect((await stored('pin-230-path'))?.resumeBinding?.transcriptPath).toBe(transcriptPath);
  }, 30_000);

  it('#1627 a capture with no path for another conversation does not displace a binding that has one', async () => {
    await createPane('pin-1627');
    const authoritative = uuid();
    const provisional = uuid();
    const transcriptPath = path.join(CLAUDE_PROJECTS, `${authoritative}.jsonl`);
    const now = Date.now();
    expect(await setBinding('pin-1627', { agent: 'claude', sessionId: authoritative, cwd: workDir, transcriptPath, ts: now })).toBe(true);
    expect(await setBinding('pin-1627', { agent: 'claude', sessionId: provisional, cwd: workDir, ts: now + 1 })).toBe(true);
    expect((await stored('pin-1627'))?.resumeBinding).toMatchObject({ sessionId: authoritative, transcriptPath });
  }, 30_000);
});
