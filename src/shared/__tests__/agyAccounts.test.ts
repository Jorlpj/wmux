import { describe, expect, it } from 'vitest';
import {
  AGY_DEFAULT_COOLDOWN_MS,
  agyAccountRow,
  chooseAgyAccount,
  evaluateAgyQuota,
  isAgyLaunchLine,
  isAgyQuotaError,
  type AgyAccount,
  type AgyAccountQuotaSnapshot,
} from '../agyAccounts';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const LATER = '2026-10-02T15:00:00Z';
const EARLIER = '2026-10-02T11:00:00Z';

function snap(buckets: Record<string, [number, string?]>): AgyAccountQuotaSnapshot {
  return {
    quota: Object.fromEntries(Object.entries(buckets).map(([k, [f, r]]) => [k, { remaining_fraction: f, ...(r ? { reset_time: r } : {}) }])),
    quotaCapturedAtMs: NOW - 60_000,
  };
}

function acct(email: string, extra: Partial<AgyAccount> = {}): AgyAccount {
  return { id: email, email, label: '', addedAt: 0, ...extra };
}

describe('evaluateAgyQuota', () => {
  it('treats a missing snapshot as usable with unknown remaining', () => {
    expect(evaluateAgyQuota(null, NOW)).toEqual({ usable: true, remaining: null, availableAtMs: null });
  });

  it('reports the lowest gating bucket', () => {
    const v = evaluateAgyQuota(snap({ 'gemini-5h': [0.8, LATER], 'gemini-weekly': [0.4, LATER] }), NOW);
    expect(v).toEqual({ usable: true, remaining: 0.4, availableAtMs: null });
  });

  it('blocks an exhausted bucket until its reset time', () => {
    const v = evaluateAgyQuota(snap({ 'gemini-5h': [0, LATER], 'gemini-weekly': [0.5, LATER] }), NOW);
    expect(v.usable).toBe(false);
    expect(v.availableAtMs).toBe(Date.parse(LATER));
  });

  it('counts a bucket whose reset has passed as refilled', () => {
    const v = evaluateAgyQuota(snap({ 'gemini-5h': [0, EARLIER] }), NOW);
    expect(v).toEqual({ usable: true, remaining: 1, availableAtMs: null });
  });

  it('blocks for the default window when no reset time is known', () => {
    const v = evaluateAgyQuota(snap({ 'gemini-5h': [0.01] }), NOW);
    expect(v.usable).toBe(false);
    expect(v.availableAtMs).toBe(NOW - 60_000 + AGY_DEFAULT_COOLDOWN_MS);
  });

  it('ignores buckets that do not gate a launch', () => {
    expect(evaluateAgyQuota(snap({ 'image-daily': [0, LATER] }), NOW).usable).toBe(true);
  });
});

describe('agyAccountRow', () => {
  it('marks the active account by email', () => {
    expect(agyAccountRow(acct('a@x.com'), null, 'a@x.com', NOW).state).toBe('active');
    expect(agyAccountRow(acct('b@x.com'), null, 'a@x.com', NOW).state).toBe('ready');
  });

  it('puts reauth before cooldown before quota', () => {
    expect(agyAccountRow(acct('a@x.com', { needsReauth: true, cooldownUntil: NOW + 1 }), null, null, NOW).state).toBe('needs-reauth');
    const cooling = agyAccountRow(acct('a@x.com', { cooldownUntil: NOW + 1000 }), null, null, NOW);
    expect(cooling.state).toBe('exhausted');
    expect(cooling.availableAtMs).toBe(NOW + 1000);
  });

  it('lets an elapsed cooldown go', () => {
    expect(agyAccountRow(acct('a@x.com', { cooldownUntil: NOW - 1 }), null, null, NOW).state).toBe('ready');
  });
});

describe('chooseAgyAccount', () => {
  const row = (email: string, s: AgyAccountQuotaSnapshot | null, active = false, extra: Partial<AgyAccount> = {}) =>
    agyAccountRow(acct(email, extra), s, active ? email : null, NOW);

  it('passes through with no accounts registered', () => {
    expect(chooseAgyAccount([])).toEqual({ ok: true, account: null, switched: false });
  });

  it('keeps the active account while it has quota', () => {
    const d = chooseAgyAccount([row('a@x.com', snap({ 'gemini-5h': [0.1, LATER] }), true), row('b@x.com', snap({ 'gemini-5h': [0.9, LATER] }))]);
    expect(d).toMatchObject({ ok: true, switched: false, account: { email: 'a@x.com' } });
  });

  it('switches to the account with the most quota when the active one is out', () => {
    const d = chooseAgyAccount([
      row('a@x.com', snap({ 'gemini-5h': [0, LATER] }), true),
      row('b@x.com', snap({ 'gemini-5h': [0.3, LATER] })),
      row('c@x.com', snap({ 'gemini-5h': [0.7, LATER] })),
      row('d@x.com', null),
    ]);
    expect(d).toMatchObject({ ok: true, switched: true, account: { email: 'c@x.com' } });
  });

  it('tries a never-measured account only after measured ones', () => {
    const d = chooseAgyAccount([row('a@x.com', snap({ 'gemini-5h': [0, LATER] }), true), row('d@x.com', null)]);
    expect(d).toMatchObject({ ok: true, switched: true, account: { email: 'd@x.com' } });
  });

  it('refuses when every account is out and names the earliest reset', () => {
    const d = chooseAgyAccount([
      row('a@x.com', snap({ 'gemini-5h': [0, LATER] }), true),
      row('b@x.com', snap({ 'gemini-weekly': [0, '2026-10-02T13:00:00Z'] })),
      row('c@x.com', null, false, { needsReauth: true }),
    ]);
    expect(d).toEqual({ ok: false, reason: 'all-exhausted', availableAtMs: Date.parse('2026-10-02T13:00:00Z') });
  });
});

describe('isAgyLaunchLine', () => {
  it.each([
    ['agy', true],
    ['agy -i "do it"', true],
    ['AGY.exe --model x', true],
    ['"C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe" -i "x"', true],
    ['/usr/local/bin/agy', true],
    ['agyx', false],
    ['claude --model opus', false],
    ['echo agy', false],
    ['', false],
  ])('%s → %s', (line, expected) => {
    expect(isAgyLaunchLine(line)).toBe(expected);
  });
});

describe('isAgyQuotaError', () => {
  it('matches error forms and not the model picker labels', () => {
    expect(isAgyQuotaError('Error: RESOURCE_EXHAUSTED: quota')).toBe(true);
    expect(isAgyQuotaError("You're out of quota for Gemini")).toBe(true);
    expect(isAgyQuotaError('Quota exceeded for this model')).toBe(true);
    expect(isAgyQuotaError('Quota available  Quota exhausted')).toBe(false);
  });
});

describe('agy quota error detection in pane output', () => {
  it('AgentDetector reports a quota error line as an agy quota event', async () => {
    const { AgentDetector } = await import('../../main/pty/AgentDetector');
    const { isAgyQuotaExhaustedEvent } = await import('../agyAccounts');
    const det = new AgentDetector();
    const events: Array<{ agent: string; message: string }> = [];
    det.onEvent((e) => events.push(e));
    det.feed('Antigravity CLI 1.2.14\r\n');
    det.feed('Error: RESOURCE_EXHAUSTED: you are out of quota for this model\r\n');
    expect(events.some((e) => isAgyQuotaExhaustedEvent(e))).toBe(true);
  });

  it('ignores the same text before agy owns the pane', async () => {
    const { AgentDetector } = await import('../../main/pty/AgentDetector');
    const { isAgyQuotaExhaustedEvent } = await import('../agyAccounts');
    const det = new AgentDetector();
    const events: Array<{ agent: string; message: string }> = [];
    det.onEvent((e) => events.push(e));
    det.feed('RESOURCE_EXHAUSTED\r\n');
    expect(events.some((e) => isAgyQuotaExhaustedEvent(e))).toBe(false);
  });
});
