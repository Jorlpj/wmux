import type { QuotaProviderId } from '../../../../../../shared/tokenUsage/quotaTypes';
import { t as defaultT } from '../../../../../i18n';

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export function providerDisplayName(provider: QuotaProviderId): string {
  switch (provider) {
    case 'claude':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'agy':
      return 'Antigravity';
    default:
      return provider;
  }
}

export function formatResetsIn(resetAtMs: number | null, nowMs = Date.now(), t: TranslateFn = defaultT as TranslateFn): string | null {
  if (resetAtMs === null || resetAtMs <= 0) return null;
  const diff = resetAtMs - nowMs;
  if (diff <= 0) return t('settings.tokenUsage.resetsSoon');
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return t('settings.tokenUsage.resetsInMinutes', { m: mins });
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (m > 0) {
      return t('settings.tokenUsage.resetsInHoursMinutes', { h, m });
    }
    return t('settings.tokenUsage.resetsInHours', { h });
  }
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  if (h > 0) {
    return t('settings.tokenUsage.resetsInDaysHours', { d, h });
  }
  return t('settings.tokenUsage.resetsInDays', { d });
}
