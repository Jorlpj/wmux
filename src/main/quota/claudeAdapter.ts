import type { ProviderQuota, QuotaWindow } from '../../shared/tokenUsage/quotaTypes';
import { loadClaudeCredential, type LoadResult } from '../claude/claudeCredential';
import { fetchUsage, UsageApiException, type UsageSnapshot } from '../claude/UsageApi';

export interface ClaudeAdapterDeps {
  now?: () => number;
  configDir?: string;
  loadCredential?: (configDir?: string) => Promise<LoadResult>;
  fetchClaude?: (token: string) => Promise<UsageSnapshot>;
}

export async function readClaudeQuota(deps: ClaudeAdapterDeps = {}): Promise<ProviderQuota> {
  const now = deps.now ?? Date.now;
  const loadCred = deps.loadCredential ?? loadClaudeCredential;
  const fetchApi = deps.fetchClaude ?? fetchUsage;

  const base: Omit<ProviderQuota, 'status' | 'windows' | 'planLabel' | 'message'> = {
    provider: 'claude',
    creditsLabel: null,
    capturedAtMs: null,
    fetchedAtMs: now(),
    contextUsage: null,
    avgTokensPerMessage: null,
  };

  let loadResult: LoadResult;
  try {
    loadResult = await loadCred(deps.configDir);
  } catch {
    return {
      ...base,
      status: 'error',
      windows: [],
      planLabel: null,
      message: 'Failed to read Claude credentials.',
    };
  }

  if (!loadResult.ok) {
    if (loadResult.reason === 'not-found') {
      return {
        ...base,
        status: 'unauthorized',
        windows: [],
        planLabel: null,
        message: 'Claude credentials not found.',
      };
    }
    if (loadResult.reason === 'unsupported-platform') {
      return {
        ...base,
        status: 'unavailable',
        windows: [],
        planLabel: null,
        message: 'Claude is not supported on this platform.',
      };
    }
    return {
      ...base,
      status: 'error',
      windows: [],
      planLabel: null,
      message: 'Failed to read Claude credentials.',
    };
  }

  const { credential } = loadResult;
  const planLabel = credential.subscriptionType ?? credential.rateLimitTier ?? null;

  try {
    const snapshot = await fetchApi(credential.accessToken);
    const windows: QuotaWindow[] = [
      {
        id: 'five_hour',
        label: '5h',
        usedPct: snapshot.sessionPct,
        resetAtMs: snapshot.sessionResetEpochSec > 0 ? snapshot.sessionResetEpochSec * 1000 : null,
        windowMins: 300,
      },
      {
        id: 'weekly',
        label: 'weekly',
        usedPct: snapshot.weeklyPct,
        resetAtMs: snapshot.weeklyResetEpochSec > 0 ? snapshot.weeklyResetEpochSec * 1000 : null,
        windowMins: 10080,
      },
    ];

    if (Array.isArray(snapshot.scoped)) {
      for (const item of snapshot.scoped) {
        const scopeKey = item.scope ? `scoped-${item.scope}` : `scoped-${item.group}`;
        windows.push({
          id: scopeKey,
          label: item.scope ? `${item.scope} (weekly)` : `${item.group} (weekly)`,
          usedPct: item.pct,
          resetAtMs: item.resetEpochSec && item.resetEpochSec > 0 ? item.resetEpochSec * 1000 : null,
          windowMins: 10080,
        });
      }
    }

    return {
      ...base,
      status: 'ok',
      windows,
      planLabel,
      fetchedAtMs: snapshot.fetchedAtMs || base.fetchedAtMs,
      message: null,
    };
  } catch (err) {
    if (err instanceof UsageApiException) {
      if (err.detail.kind === 'unauthorized') {
        return {
          ...base,
          status: 'unauthorized',
          windows: [],
          planLabel,
          message: 'Claude authentication expired or revoked.',
        };
      }
      if (err.detail.kind === 'rate-limited') {
        return {
          ...base,
          status: 'error',
          windows: [],
          planLabel,
          message: 'Claude usage rate limited.',
        };
      }
      if (err.detail.kind === 'http') {
        return {
          ...base,
          status: 'error',
          windows: [],
          planLabel,
          message: err.detail.statusText || 'Claude usage HTTP error.',
        };
      }
      if (err.detail.kind === 'network') {
        return {
          ...base,
          status: 'error',
          windows: [],
          planLabel,
          message: 'Network error fetching Claude usage.',
        };
      }
      if (err.detail.kind === 'malformed') {
        return {
          ...base,
          status: 'error',
          windows: [],
          planLabel,
          message: 'Malformed response from Claude usage API.',
        };
      }
    }
    return {
      ...base,
      status: 'error',
      windows: [],
      planLabel,
      message: 'Failed to fetch Claude usage.',
    };
  }
}
