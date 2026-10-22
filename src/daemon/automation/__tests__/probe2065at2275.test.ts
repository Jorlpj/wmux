// Re-run at c024d35af (after #2275), run 319: also records the skip `detail`.
// Probe for #2065 (sandbox only, not a fix): how long does a finished run's
// session hold the overlap slot, per ending? Drives the real AutomationEngine
// with fake ports (same harness shape as AutomationEngine.test.ts) and the real
// 5 s monitor cadence (AUTOMATION_MONITOR_MS). Run now is probed once a minute.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AutomationRun } from '../../../shared/automation';
import { AUTOMATION_MONITOR_MS, AutomationEngine, type AutomationAgentView, type AutomationEnginePorts } from '../AutomationEngine';

const MIN = 60_000;
const out: string[] = [];
const report = (line: string) => { out.push(line); console.log(line); };
afterAll(() => { fs.writeFileSync(path.join(os.tmpdir(), 'probe2065-engine.txt'), out.join('\n') + '\n'); });

function harness(attached: () => boolean = () => false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-probe2065-'));
  const clock = { t: new Date(2026, 8, 28, 9, 0).getTime() };
  let seq = 0;
  const alive = new Set<string>();
  const created: string[] = [];
  const state: { agent: AutomationAgentView; pendingApproval: boolean; turnEndAt?: number } = {
    agent: { slug: 'claude', verified: true, status: 'idle', inputQuiet: true, incarnationId: 'inc-1' },
    pendingApproval: false,
  };
  const ports: AutomationEnginePorts = {
    wmuxDir: dir, parentEnv: { PATH: '/bin' }, log: () => undefined, emit: () => undefined,
    now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, newId: () => `id${++seq}`,
    isDirectory: () => true, buildBaseCommand: async (c) => c.agent,
    createSession: async (p) => { created.push(p.id); alive.add(p.id); },
    sessionPid: (id) => (alive.has(id) ? 4242 : null),
    isAttached: () => attached(),
    destroySession: async (id) => { alive.delete(id); },
    readScreen: async () => '╭──╮\n│ > │\n╰──╯', sendKey: async () => undefined,
    readAgent: () => state.agent, armAgentTracker: () => undefined,
    deliverPrompt: async () => 'sent', hasPendingApproval: () => state.pendingApproval,
    transcriptTurnEndAt: () => state.turnEndAt, snapshotText: async () => 'final screen',
    killTree: async () => undefined,
  };
  return { engine: new AutomationEngine(ports), clock, alive, created, state };
}
type H = ReturnType<typeof harness>;

async function started(h: H, mode?: 'auto'): Promise<AutomationRun> {
  await h.engine.start({ timers: false });
  const a = await h.engine.create({
    name: 'Nightly',
    trigger: { kind: 'schedule', weekdays: [0, 1, 2, 3, 4, 5, 6], time: '08:30', graceMinutes: 60 },
    action: { kind: 'launch', cwd: '/work/repo', agent: 'claude', prompt: 'do the thing' },
  });
  if (!a.ok) throw new Error(a.error);
  if (mode) {
    const g = await h.engine.grant(a.automation.id, mode, undefined);
    if (!g.ok) throw new Error(g.error);
  }
  const r = await h.engine.runNow(a.automation.id, 'manual');
  if (!r.ok) throw new Error(r.error);
  await vi.waitFor(() => expect(h.engine.listRuns().some((x) => x.state === 'launching')).toBe(false), { timeout: 5000, interval: 5 });
  return h.engine.listRuns()[0];
}

/** Probe Run now once a minute (monitor every 5 s between) until it launches; ms from `from`. */
async function slotHeldFor(h: H, run: AutomationRun, from: number, capMs = 6 * 60 * MIN): Promise<{ ms: number; skips: number; final: AutomationRun; details: string }> {
  let skips = 0;
  const seen = new Set<string>();
  for (;;) {
    const res = await h.engine.runNow(run.automationId, 'manual');
    if (!res.ok) throw new Error(res.error);
    if (res.run.state !== 'skipped') {
      const final = h.engine.listRuns().find((x) => x.id === run.id)!;
      return { ms: h.clock.t - from, skips, final, details: [...seen].join(',') || '-' };
    }
    expect(res.run.reason).toBe('overlap');
    seen.add(res.run.detail ?? 'none');
    skips++;
    for (let i = 0; i < MIN / AUTOMATION_MONITOR_MS; i++) {
      h.clock.t += AUTOMATION_MONITOR_MS;
      await h.engine.monitorOnce();
    }
    if (h.clock.t - from > capMs) throw new Error('slot never released');
  }
}
const mins = (ms: number) => `${(ms / MIN).toFixed(1)} min`;

describe('#2065 probe: how long a finished run holds the overlap slot', () => {
  it('A. hook Stop -> completed, nobody opens it: held for the 10 min linger, then reaped', async () => {
    const h = harness();
    const run = await started(h);
    await h.engine.onAgentEvent(`auto-${run.id}`, { kind: 'agent.stop', status: 'complete', decision: 'emit' });
    const mid = h.engine.listRuns().find((x) => x.id === run.id)!;
    const r = await slotHeldFor(h, run, h.clock.t);
    report(`A completed, unattended: run final at once (state=${mid.state}, ptyId kept=${mid.ptyId !== undefined}); slot held ${mins(r.ms)} after completion (${r.skips} overlap skips, detail=${r.details}); then ptyId=${r.final.ptyId ?? '-'}`);
    expect(r.ms).toBeGreaterThanOrEqual(10 * MIN);
    expect(r.ms).toBeLessThanOrEqual(11 * MIN);
  });

  it('A2. completed, then the agent exits (wrapper shell exits, PTY dies): released at once', async () => {
    const h = harness();
    const run = await started(h);
    const pty = `auto-${run.id}`;
    await h.engine.onAgentEvent(pty, { kind: 'agent.stop', status: 'complete', decision: 'emit' });
    h.clock.t += 2 * MIN;
    h.alive.delete(pty);
    await h.engine.onSessionDied(pty, 0);
    const r = await slotHeldFor(h, run, h.clock.t);
    report(`A2 completed, agent exits at +2 min: slot held ${mins(r.ms)} after the exit; run=${r.final.state}`);
    expect(r.ms).toBe(0);
  });

  it('B. completed, then a client attaches: released at once (handed over)', async () => {
    let attached = false;
    const h = harness(() => attached);
    const run = await started(h);
    await h.engine.onAgentEvent(`auto-${run.id}`, { kind: 'agent.stop', status: 'complete', decision: 'emit' });
    h.clock.t += MIN;
    attached = true;
    const r = await slotHeldFor(h, run, h.clock.t);
    report(`B completed, then attached: slot held ${mins(r.ms)} after attach`);
    expect(r.ms).toBe(0);
  });

  it('C. agent process gone but PTY up -> unknown (ambiguous): held until the 240 min run cap, attached or not', async () => {
    for (const isAttached of [false, true]) {
      const h = harness(() => isAttached);
      const run = await started(h);
      const start = run.startedAt!;
      h.engine.onAgentProcessExit(`auto-${run.id}`);
      h.clock.t += 31_000;
      await h.engine.monitorOnce();
      const mid = h.engine.listRuns().find((x) => x.id === run.id)!;
      expect(mid).toMatchObject({ state: 'unknown', reason: 'process_exit' });
      const r = await slotHeldFor(h, run, start);
      report(`C unknown/ambiguous, attached=${isAttached}: run final at +0.5 min (state=${mid.state}, ptyId kept=${mid.ptyId !== undefined}); slot held ${mins(r.ms)} from start (${r.skips} overlap skips, detail=${r.details})`);
      expect(r.ms).toBeGreaterThanOrEqual(240 * MIN);
      expect(r.ms).toBeLessThanOrEqual(242 * MIN);
    }
  });

  it('D. completion never detected (no Stop hook, no transcript turn end, detector never saw running): held 240 min', async () => {
    const h = harness();
    const run = await started(h);
    const r = await slotHeldFor(h, run, run.startedAt!);
    report(`D completion never detected: slot held ${mins(r.ms)} from start; run=${r.final.state}/${r.final.reason ?? '-'}`);
    expect(r.ms).toBeGreaterThanOrEqual(240 * MIN);
  });

  it('E. an unanswered question: approval vs unattended await timeouts', async () => {
    for (const mode of [undefined, 'auto'] as const) {
      const h = harness();
      const run = await started(h, mode);
      h.state.agent = { ...h.state.agent, status: 'awaiting_input' };
      await h.engine.monitorOnce();
      const r = await slotHeldFor(h, run, h.clock.t);
      report(`E awaiting (mode=${run.effectiveMode}): slot held ${mins(r.ms)} after the wait began; run=${r.final.state}/${r.final.reason ?? '-'}`);
    }
  });

  it('F. cancelRun on a lingering completed run ends the session now and keeps "completed"', async () => {
    const h = harness();
    const run = await started(h);
    const pty = `auto-${run.id}`;
    await h.engine.onAgentEvent(pty, { kind: 'agent.stop', status: 'complete', decision: 'emit' });
    const before = h.engine.listRuns().find((x) => x.id === run.id)!;
    const res = await h.engine.cancelRun(run.id);
    const after = h.engine.listRuns().find((x) => x.id === run.id)!;
    report(`F cancelRun on a lingering completed run: ok=${res.ok}; before state=${before.state} ptyId=${before.ptyId}; after state=${after.state} reason=${after.reason ?? '-'} ptyId=${after.ptyId ?? '-'} hasSnapshot=${after.hasSnapshot === true} session alive=${h.alive.has(pty)}`);
    expect(res.ok).toBe(true);
    expect(after.state).toBe('completed');
    expect(h.alive.has(pty)).toBe(false);
    const next = await h.engine.runNow(run.automationId, 'manual');
    report(`F next Run now after cancelRun: ${next.ok ? next.run.state : 'error'}`);
    expect(next.ok && next.run.state).toBe('launching');
  });
});
