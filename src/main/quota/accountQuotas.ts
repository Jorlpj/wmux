// Quota of every account the user added, per provider, for Settings → Token
// usage. Read only when the tab opens or the user refreshes: no timer.
//
// - Claude: the default login (~/.claude) plus each registered account, read
//   from its usage endpoint (no model request).
// - Codex: the default ~/.codex plus each registered account, from the limits
//   Codex records in that account's session files.
// - agy: each registered account's last sensor snapshot; with none registered,
//   the default sensor reading.

import * as path from 'node:path';
import type { AgyAccountsSnapshot } from '../../shared/agyAccounts';
import type { QuotaProviderId, QuotaReadResult, QuotaWindow } from '../../shared/tokenUsage/quotaTypes';
import {
  compactCells,
  type AccountQuotaLine,
  type ProviderAccountQuotas,
} from '../../shared/tokenUsage/accountQuotaTypes';
import type { Account } from '../account/accountStore';
import type { AccountUsageEntry } from '../account/AccountUsageService';
import type { RolloutLimits } from './codexRollout';
import { windowsFromRollout } from './codexAdapter';
import { windowsFromUsageSnapshot } from './claudeAdapter';

export interface ClaudeUsageReader {
  refreshNow(accountId: string): Promise<void>;
  getAll(): AccountUsageEntry[];
}

export interface AccountQuotasDeps {
  listAccounts(): Account[];
  claudeUsage: ClaudeUsageReader | null;
  readDefault(providers: QuotaProviderId[]): Promise<QuotaReadResult>;
  readCodexLimits(sessionsDir: string): Promise<RolloutLimits | null>;
  agyAccounts(): AgyAccountsSnapshot | null;
  now(): number;
}

/** A refresh that takes longer than this shows the last known reading. */
const REFRESH_BUDGET_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function defaultLine(provider: QuotaProviderId, deps: AccountQuotasDeps): Promise<AccountQuotaLine> {
  try {
    const res = await deps.readDefault([provider]);
    const quota = res.readings.find((r) => r.quota.provider === provider)?.quota;
    if (!quota) return { key: 'default', label: 'Default', status: 'unknown', cells: [], message: null };
    const cells = compactCells(provider, quota.windows);
    return {
      key: 'default',
      label: 'Default',
      status: quota.status === 'ok' ? 'ok' : cells.length > 0 ? 'stale' : 'error',
      cells,
      message: quota.status === 'ok' ? null : quota.message,
    };
  } catch (err) {
    return { key: 'default', label: 'Default', status: 'error', cells: [], message: errorMessage(err) };
  }
}

async function claudeLines(deps: AccountQuotasDeps): Promise<AccountQuotaLine[]> {
  const accounts = deps.listAccounts().filter((a) => a.vendor === 'claude');
  const usage = deps.claudeUsage;
  if (usage && accounts.length > 0) {
    await withTimeout(Promise.all(accounts.map((a) => usage.refreshNow(a.id).catch(() => undefined))), REFRESH_BUDGET_MS);
  }
  const entries = usage?.getAll() ?? [];
  const lines = accounts.map((a): AccountQuotaLine => {
    const entry = entries.find((e) => e.accountId === a.id);
    const cells = entry?.snapshot ? compactCells('claude', windowsFromUsageSnapshot(entry.snapshot)) : [];
    const ok = entry?.status === 'ok';
    return {
      key: a.id,
      label: a.name,
      status: ok ? 'ok' : cells.length > 0 ? 'stale' : entry ? 'error' : 'unknown',
      cells,
      message: ok ? null : entry?.lastError ?? null,
    };
  });
  return [await defaultLine('claude', deps), ...lines];
}

async function codexLines(deps: AccountQuotasDeps): Promise<AccountQuotaLine[]> {
  const accounts = deps.listAccounts().filter((a) => a.vendor === 'codex');
  const lines = await Promise.all(accounts.map(async (a): Promise<AccountQuotaLine> => {
    try {
      const limits = await deps.readCodexLimits(path.join(a.configDir, 'sessions'));
      const cells = limits ? compactCells('codex', windowsFromRollout(limits, deps.now())) : [];
      return { key: a.id, label: a.name, status: cells.length > 0 ? 'ok' : 'unknown', cells, message: null };
    } catch (err) {
      return { key: a.id, label: a.name, status: 'error', cells: [], message: errorMessage(err) };
    }
  }));
  return [await defaultLine('codex', deps), ...lines];
}

function agyWindows(snapshot: AgyAccountsSnapshot['accounts'][number]['quota']): QuotaWindow[] {
  const quota = snapshot?.quota ?? {};
  return Object.entries(quota).map(([name, bucket]) => {
    const remaining = bucket?.remaining_fraction;
    const reset = typeof bucket?.reset_time === 'string' ? Date.parse(bucket.reset_time) : NaN;
    return {
      id: name,
      label: name,
      usedPct: typeof remaining === 'number' && Number.isFinite(remaining)
        ? Math.max(0, Math.min(100, Math.round((1 - remaining) * 100)))
        : null,
      resetAtMs: Number.isFinite(reset) ? reset : null,
      windowMins: null,
    };
  });
}

async function agyLines(deps: AccountQuotasDeps): Promise<AccountQuotaLine[]> {
  const snap = deps.agyAccounts();
  if (!snap?.supported || snap.accounts.length === 0) return [await defaultLine('agy', deps)];
  return snap.accounts.map((a) => {
    const cells = compactCells('agy', agyWindows(a.quota));
    return { key: a.id, label: a.label || a.email, status: cells.length > 0 ? 'ok' : 'unknown', cells, message: null };
  });
}

export async function readAccountQuotas(
  providers: QuotaProviderId[],
  deps: AccountQuotasDeps,
): Promise<ProviderAccountQuotas[]> {
  const read = { claude: claudeLines, codex: codexLines, agy: agyLines } as const;
  return Promise.all(providers.map(async (provider) => ({ provider, accounts: await read[provider](deps) })));
}

// The Claude usage service is created in main/index.ts; it hands itself over here.
let claudeUsageSource: ClaudeUsageReader | null = null;

export function setAccountQuotaClaudeUsage(source: ClaudeUsageReader | null): void {
  claudeUsageSource = source;
}

export function getAccountQuotaClaudeUsage(): ClaudeUsageReader | null {
  return claudeUsageSource;
}
