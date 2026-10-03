import { describe, expect, it, vi } from 'vitest';
import { readAccountQuotas, type AccountQuotasDeps } from '../accountQuotas';
import { compactCells } from '../../../shared/tokenUsage/accountQuotaTypes';
import type { QuotaReadResult, QuotaWindow } from '../../../shared/tokenUsage/quotaTypes';
import type { Account } from '../../account/accountStore';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const w = (id: string, label: string, usedPct: number): QuotaWindow => ({ id, label, usedPct, resetAtMs: NOW + 1000, windowMins: null });

function deps(over: Partial<AccountQuotasDeps> = {}): AccountQuotasDeps {
  const accounts: Account[] = [
    { id: 'c1', vendor: 'claude', name: 'Work', configDir: '/acc/c1' } as Account,
    { id: 'x1', vendor: 'codex', name: 'Team', configDir: '/acc/x1' } as Account,
  ];
  const defaults: QuotaReadResult = {
    readings: [
      { quota: { provider: 'claude', status: 'ok', windows: [w('five_hour', '5h', 8), w('weekly', 'weekly', 5), w('scoped-Fable', 'Fable (weekly)', 1)], planLabel: 'pro', creditsLabel: null, capturedAtMs: null, fetchedAtMs: NOW, contextUsage: null, avgTokensPerMessage: null, message: null }, deltas: [] },
      { quota: { provider: 'codex', status: 'ok', windows: [w('weekly', 'weekly', 12)], planLabel: null, creditsLabel: null, capturedAtMs: null, fetchedAtMs: NOW, contextUsage: null, avgTokensPerMessage: null, message: null }, deltas: [] },
      { quota: { provider: 'agy', status: 'ok', windows: [w('3p-5h', '3p 5h', 0), w('gemini-5h', 'Gemini 5h', 0), w('gemini-weekly', 'Gemini weekly', 45)], planLabel: null, creditsLabel: null, capturedAtMs: null, fetchedAtMs: NOW, contextUsage: null, avgTokensPerMessage: null, message: null }, deltas: [] },
    ],
  };
  return {
    listAccounts: () => accounts,
    claudeUsage: {
      refreshNow: vi.fn(async () => undefined),
      getAll: () => [{
        accountId: 'c1', status: 'ok', fetchedAtMs: NOW, lastError: null,
        snapshot: { sessionPct: 30, sessionResetEpochSec: 0, weeklyPct: 60, weeklyResetEpochSec: 0, fetchedAtMs: NOW },
      }],
    },
    readDefault: async (providers) => ({ readings: defaults.readings.filter((r) => providers.includes(r.quota.provider)) }),
    readCodexLimits: async () => null,
    agyAccounts: () => null,
    now: () => NOW,
    ...over,
  };
}

describe('compactCells', () => {
  it('keeps 5h, weekly and Fable for Claude, in that order', () => {
    const cells = compactCells('claude', [w('scoped-Fable', 'Fable (weekly)', 1), w('weekly', 'weekly', 5), w('five_hour', '5h', 8), w('scoped-opus', 'opus (weekly)', 3)]);
    expect(cells.map((c) => c.id)).toEqual(['5h', 'weekly', 'fable']);
  });

  it('keeps only the Gemini buckets for agy', () => {
    const cells = compactCells('agy', [w('3p-5h', '3p 5h', 0), w('3p-weekly', '3p weekly', 0), w('gemini-5h', 'Gemini 5h', 10), w('gemini-weekly', 'Gemini weekly', 45)]);
    expect(cells).toEqual([
      { id: '5h', usedPct: 10, resetAtMs: NOW + 1000 },
      { id: 'weekly', usedPct: 45, resetAtMs: NOW + 1000 },
    ]);
  });
});

describe('readAccountQuotas', () => {
  it('lists the default login and every registered account per provider', async () => {
    const d = deps();
    const [claude, codex] = await readAccountQuotas(['claude', 'codex'], d);
    expect(claude.accounts.map((a) => [a.label, a.cells.map((c) => `${c.id}:${c.usedPct}`)])).toEqual([
      ['Default', ['5h:8', 'weekly:5', 'fable:1']],
      ['Work', ['5h:30', 'weekly:60']],
    ]);
    expect(d.claudeUsage?.refreshNow).toHaveBeenCalledWith('c1');
    expect(codex.accounts.map((a) => [a.label, a.status])).toEqual([['Default', 'ok'], ['Team', 'unknown']]);
  });

  it('shows each agy account from its own snapshot, Gemini buckets only', async () => {
    const [agy] = await readAccountQuotas(['agy'], deps({
      agyAccounts: () => ({
        supported: true, autoRotate: false, activeEmail: 'a@x.com',
        accounts: [{
          id: 'g1', email: 'a@x.com', label: '', addedAt: 0, state: 'active', active: true, remaining: 0.5, availableAtMs: null,
          quota: { quota: { 'gemini-5h': { remaining_fraction: 0.9 }, 'gemini-weekly': { remaining_fraction: 0.5 }, '3p-5h': { remaining_fraction: 0 } } },
        }],
      }),
    }));
    expect(agy.accounts).toEqual([{
      key: 'g1', label: 'a@x.com', status: 'ok', message: null,
      cells: [{ id: '5h', usedPct: 10, resetAtMs: null }, { id: 'weekly', usedPct: 50, resetAtMs: null }],
    }]);
  });

  it('falls back to the default agy reading with no registered agy account', async () => {
    const [agy] = await readAccountQuotas(['agy'], deps());
    expect(agy.accounts[0].cells.map((c) => c.id)).toEqual(['5h', 'weekly']);
  });
});
