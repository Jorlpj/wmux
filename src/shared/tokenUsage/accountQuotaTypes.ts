// Quota per account, reduced to the windows a person watches: 5h, weekly and,
// for Claude, the Fable weekly cap when the account has one. agy shows only its
// Gemini buckets (its third-party model buckets are too small to matter).

import type { QuotaProviderId, QuotaWindow } from './quotaTypes';

export type CompactWindowId = '5h' | 'weekly' | 'fable';

export interface AccountQuotaCell {
  id: CompactWindowId;
  /** 0-100, null when the source did not report it. */
  usedPct: number | null;
  resetAtMs: number | null;
}

export interface AccountQuotaLine {
  /** Stable key: 'default' or the account id. */
  key: string;
  label: string;
  status: 'ok' | 'stale' | 'error' | 'unknown';
  cells: AccountQuotaCell[];
  message: string | null;
}

export interface ProviderAccountQuotas {
  provider: QuotaProviderId;
  accounts: AccountQuotaLine[];
}

export interface AccountQuotasRequest {
  providers?: QuotaProviderId[];
}

export interface AccountQuotasResult {
  providers: ProviderAccountQuotas[];
}

const ORDER: CompactWindowId[] = ['5h', 'weekly', 'fable'];

function compactId(provider: QuotaProviderId, w: QuotaWindow): CompactWindowId | null {
  const id = w.id.toLowerCase();
  const label = w.label.toLowerCase();
  if (provider === 'agy') {
    if (id === 'gemini-5h') return '5h';
    if (id === 'gemini-weekly') return 'weekly';
    return null;
  }
  if (provider === 'claude' && id.startsWith('scoped-')) return /fable/.test(id + label) ? 'fable' : null;
  if (id === 'five_hour' || label === '5h') return '5h';
  if (id === 'weekly' || label === 'weekly') return 'weekly';
  return null;
}

/** The provider's windows, reduced to 5h / weekly / fable in that order. */
export function compactCells(provider: QuotaProviderId, windows: readonly QuotaWindow[]): AccountQuotaCell[] {
  const byId = new Map<CompactWindowId, AccountQuotaCell>();
  for (const w of windows) {
    const id = compactId(provider, w);
    if (id && !byId.has(id)) byId.set(id, { id, usedPct: w.usedPct, resetAtMs: w.resetAtMs });
  }
  return ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
}
