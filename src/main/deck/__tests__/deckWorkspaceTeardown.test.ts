import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { teardownWorkspaceDeckState, surfaceStrandedWork } from '../deckWorkspaceTeardown';
import { setWorkspaceMode, loadDeckAutonomy, getDeckAutonomyPath } from '../deckAutonomyStore';
import * as deckLoopStateStore from '../deckLoopStateStore';
import { startLoop, loadWorkspaceLoopState, getDeckLoopStatePath } from '../deckLoopStateStore';
import { saveDeckSchedules, loadDeckSchedules, getDeckSchedulesPath } from '../deckScheduleStore';
import {
  beginOrContinueDeckWork,
  recordDeckWorkA2aTask,
  loadActiveDeckWork,
  getDeckWorkPath,
  type ActiveDeckWork,
} from '../deckWorkStore';
import { raiseDecision, loadWorkspaceDecision, getDeckDecisionPath } from '../deckDecisionStore';
import {
  saveCommanderSession,
  loadCommanderSession,
  getCommanderSessionPath,
} from '../commanderSessionStore';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-teardown-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('deckWorkspaceTeardown — teardownWorkspaceDeckState', () => {
  it('tears down all Deck state for target workspace, leaves other workspace untouched', async () => {
    // 1. Autonomy
    await setWorkspaceMode('ws-x', 'danger', dir);
    await setWorkspaceMode('ws-y', 'assist', dir);

    // 2. Schedule
    await saveDeckSchedules(
      [
        {
          id: 'sched-loop-x',
          workspaceId: 'ws-x',
          prompt: 'loop prompt x',
          nextRunAt: Date.now() + 10000,
          enabled: true,
          createdAt: Date.now(),
        },
        {
          id: 'sched-extra-x',
          workspaceId: 'ws-x',
          prompt: 'extra prompt x',
          nextRunAt: Date.now() + 20000,
          enabled: true,
          createdAt: Date.now(),
        },
        {
          id: 'sched-y',
          workspaceId: 'ws-y',
          prompt: 'prompt y',
          nextRunAt: Date.now() + 30000,
          enabled: true,
          createdAt: Date.now(),
        },
      ],
      dir,
    );

    // 3. Loop
    await startLoop(
      'ws-x',
      {
        objective: 'loop objective x',
        taskTexts: ['task 1'],
        tier: 'continue',
        iterations: 5,
        scheduleId: 'sched-loop-x',
      },
      dir,
    );
    await startLoop(
      'ws-y',
      {
        objective: 'loop objective y',
        taskTexts: ['task 2'],
        tier: 'continue',
        iterations: 5,
      },
      dir,
    );

    // 4. Work
    beginOrContinueDeckWork('ws-x', 'request x', dir);
    recordDeckWorkA2aTask('ws-x', { taskId: 'task-1', to: 'worker', state: 'working', ts: Date.now() }, dir);
    beginOrContinueDeckWork('ws-y', 'request y', dir);

    // 5. Decision
    await raiseDecision('ws-x', { question: 'question x?' }, dir);
    await raiseDecision('ws-y', { question: 'question y?' }, dir);

    // 6. Commander sessions
    await saveCommanderSession('ws-x', 'sess-claude-x', dir);
    await saveCommanderSession('ws-x::claude-pty', 'sess-pty-x', dir);
    await saveCommanderSession('ws-y', 'sess-y', dir);
    await saveCommanderSession('ws-y::hermes', 'sess-hermes-y', dir);

    const strandedReports: ActiveDeckWork[] = [];
    const logLines: string[] = [];

    const report = await teardownWorkspaceDeckState('ws-x', {
      dir,
      onStrandedWork: (work) => strandedReports.push(work),
      log: (line) => logLines.push(line),
    });

    // Report asserts
    expect(report.workspaceId).toBe('ws-x');
    expect(report.scheduleDeleted).toBe(true);
    expect(report.scheduleIds).toContain('sched-loop-x');
    expect(report.scheduleIds).toContain('sched-extra-x');
    expect(report.loopCleared).toBe(true);
    expect(report.workCleared).toBe(true);
    expect(report.strandedWork).not.toBeNull();
    expect(report.strandedWork?.objective).toBe('request x');
    expect(report.autonomyDeleted).toBe(true);
    expect(report.decisionCleared).toBe(true);
    expect(report.commanderSessionsCleared).toContain('ws-x');
    expect(report.commanderSessionsCleared).toContain('ws-x::claude-pty');

    // onStrandedWork received the removed work
    expect(strandedReports).toHaveLength(1);
    expect(strandedReports[0].id).toBe(report.strandedWork?.id);

    // Log lines assert: exactly one line per store (6 stores)
    expect(logLines).toHaveLength(6);
    expect(logLines.some((l) => l.startsWith('[schedule]'))).toBe(true);
    expect(logLines.some((l) => l.startsWith('[loop]'))).toBe(true);
    expect(logLines.some((l) => l.startsWith('[work]'))).toBe(true);
    expect(logLines.some((l) => l.startsWith('[autonomy]'))).toBe(true);
    expect(logLines.some((l) => l.startsWith('[decision]'))).toBe(true);
    expect(logLines.some((l) => l.startsWith('[commander]'))).toBe(true);

    // Verify all 6 stores via their getters
    expect(loadWorkspaceLoopState('ws-x', dir)).toBeNull();
    expect(loadActiveDeckWork('ws-x', dir)).toBeNull();
    expect(loadDeckAutonomy(dir)['ws-x']).toBeUndefined();
    expect(loadWorkspaceDecision('ws-x', dir)).toBeNull();
    expect(loadCommanderSession('ws-x', dir)).toBeNull();
    expect(loadCommanderSession('ws-x::claude-pty', dir)).toBeNull();
    const schedulesAfter = loadDeckSchedules(dir);
    expect(schedulesAfter.some((s) => s.workspaceId === 'ws-x')).toBe(false);

    // Verify ws-y is untouched in all stores
    expect(loadWorkspaceLoopState('ws-y', dir)?.objective).toBe('loop objective y');
    expect(loadActiveDeckWork('ws-y', dir)?.objective).toBe('request y');
    expect(loadDeckAutonomy(dir)['ws-y']?.mode).toBe('assist');
    expect(loadWorkspaceDecision('ws-y', dir)?.question).toBe('question y?');
    expect(loadCommanderSession('ws-y', dir)?.sessionId).toBe('sess-y');
    expect(loadCommanderSession('ws-y::hermes', dir)?.sessionId).toBe('sess-hermes-y');
    expect(schedulesAfter.some((s) => s.workspaceId === 'ws-y')).toBe(true);

    // Direct JSON file inspections: ws-x has no key in any of the six files
    const autonomyJson = JSON.parse(fs.readFileSync(getDeckAutonomyPath(dir), 'utf8'));
    expect(autonomyJson['ws-x']).toBeUndefined();
    expect(autonomyJson['ws-y']).toBeDefined();

    const loopJson = JSON.parse(fs.readFileSync(getDeckLoopStatePath(dir), 'utf8'));
    expect(loopJson['ws-x']).toBeUndefined();
    expect(loopJson['ws-y']).toBeDefined();

    const schedulesJson = JSON.parse(fs.readFileSync(getDeckSchedulesPath(dir), 'utf8'));
    expect(schedulesJson.find((s: { workspaceId?: string }) => s.workspaceId === 'ws-x')).toBeUndefined();
    expect(schedulesJson.find((s: { workspaceId?: string }) => s.workspaceId === 'ws-y')).toBeDefined();

    const workJson = JSON.parse(fs.readFileSync(getDeckWorkPath(dir), 'utf8'));
    expect(workJson.active['ws-x']).toBeUndefined();
    expect(workJson.active['ws-y']).toBeDefined();

    const decisionsJson = JSON.parse(fs.readFileSync(getDeckDecisionPath(dir), 'utf8'));
    expect(decisionsJson['ws-x']).toBeUndefined();
    expect(decisionsJson['ws-y']).toBeDefined();

    const commanderJson = JSON.parse(fs.readFileSync(getCommanderSessionPath(dir), 'utf8'));
    expect(commanderJson.sessions['ws-x']).toBeUndefined();
    expect(commanderJson.sessions['ws-x::claude-pty']).toBeUndefined();
    expect(commanderJson.sessions['ws-y']).toBeDefined();
    expect(commanderJson.sessions['ws-y::hermes']).toBeDefined();

    // Second call is a no-op without error (idempotent)
    const logLines2: string[] = [];
    const report2 = await teardownWorkspaceDeckState('ws-x', {
      dir,
      log: (line) => logLines2.push(line),
    });
    expect(report2.workspaceId).toBe('ws-x');
    expect(report2.scheduleDeleted).toBe(false);
    expect(report2.loopCleared).toBe(false);
    expect(report2.workCleared).toBe(false);
    expect(report2.autonomyDeleted).toBe(false);
    expect(report2.decisionCleared).toBe(false);
    expect(report2.commanderSessionsCleared).toEqual([]);
    expect(logLines2).toHaveLength(6);

    // ws-y is still intact after second call
    expect(loadWorkspaceLoopState('ws-y', dir)?.objective).toBe('loop objective y');
    expect(loadActiveDeckWork('ws-y', dir)?.objective).toBe('request y');
  });

  it('refuses an empty or non-string workspace id and returns a report with nothing done', async () => {
    const r1 = await teardownWorkspaceDeckState('', { dir });
    expect(r1.workspaceId).toBe('');
    expect(r1.scheduleDeleted).toBe(false);
    expect(r1.loopCleared).toBe(false);
    expect(r1.workCleared).toBe(false);

    const r2 = await teardownWorkspaceDeckState('   ', { dir });
    expect(r2.scheduleDeleted).toBe(false);

    const r3 = await teardownWorkspaceDeckState(null as unknown as string, { dir });
    expect(r3.scheduleDeleted).toBe(false);

    const r4 = await teardownWorkspaceDeckState(undefined as unknown as string, { dir });
    expect(r4.scheduleDeleted).toBe(false);
  });

  it('continues remaining store steps when one store step fails (corrupt / unwritable file)', async () => {
    // Write valid state in autonomy and decision
    await setWorkspaceMode('ws-fail', 'danger', dir);
    await raiseDecision('ws-fail', { question: 'will it survive?' }, dir);

    // Mock loop clear failure (e.g. unwritable / locked file)
    vi.spyOn(deckLoopStateStore, 'clearLoop').mockRejectedValueOnce(
      new Error('EACCES: permission denied, unwritable file'),
    );

    const logLines: string[] = [];
    const report = await teardownWorkspaceDeckState('ws-fail', {
      dir,
      log: (line) => logLines.push(line),
    });

    // Loop store failed, but autonomy and decision succeeded!
    expect(report.loopCleared).toBe(false);
    expect(report.autonomyDeleted).toBe(true);
    expect(report.decisionCleared).toBe(true);
    expect(loadDeckAutonomy(dir)['ws-fail']).toBeUndefined();
    expect(loadWorkspaceDecision('ws-fail', dir)).toBeNull();

    // Exactly 6 log lines recorded, with loop logging failure
    expect(logLines).toHaveLength(6);
    expect(logLines.some((l) => l.startsWith('[loop]') && l.includes('failed'))).toBe(true);
    expect(logLines.some((l) => l.startsWith('[autonomy]') && l.includes('deleted'))).toBe(true);
  });
});

describe('surfaceStrandedWork shared function', () => {
  it('raises a decision when dropped work has pending A2A tasks', async () => {
    const work: ActiveDeckWork = {
      id: 'work-1',
      workspaceId: 'ws-test',
      objective: 'do research',
      followUps: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      a2aTasks: {
        'task-1': {
          taskId: 'task-1',
          to: 'agent-1',
          state: 'working',
          updatedAt: Date.now(),
        },
      },
    };

    surfaceStrandedWork('ws-test', work, 'cleared', dir);
    // Yield for promise resolution of raiseDecision
    await new Promise((r) => setTimeout(r, 20));

    const decision = loadWorkspaceDecision('ws-test', dir);
    expect(decision).not.toBeNull();
    expect(decision?.question).toContain('Cancel those tasks, or leave them running?');
    expect(decision?.options).toEqual(['Cancel the old tasks', 'Leave them running']);
  });

  it('does not raise a decision when work has no pending A2A tasks', async () => {
    const work: ActiveDeckWork = {
      id: 'work-2',
      workspaceId: 'ws-test-2',
      objective: 'clean work',
      followUps: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      a2aTasks: {},
    };

    surfaceStrandedWork('ws-test-2', work, 'cleared', dir);
    await new Promise((r) => setTimeout(r, 20));

    expect(loadWorkspaceDecision('ws-test-2', dir)).toBeNull();
  });
});
