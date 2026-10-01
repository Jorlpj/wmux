import type { QuotaProviderId, QuotaWindowDelta } from '../../../../../../shared/tokenUsage/quotaTypes';

export function providerDisplayName(provider: QuotaProviderId): string {
  switch (provider) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'agy':
      return 'Antigravity';
    default:
      return provider;
  }
}

export function formatTime(epochMs: number): string {
  if (!epochMs || epochMs <= 0) return '';
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatDeltaLine(delta?: QuotaWindowDelta | null): string | null {
  if (!delta) return null;
  if (delta.windowReset) return 'window reset';
  if (delta.deltaPct !== null) {
    const sign = delta.deltaPct > 0 ? '+' : '';
    const timeStr = delta.previousCheckedAtMs > 0 ? ` since ${formatTime(delta.previousCheckedAtMs)}` : '';
    return `${sign}${delta.deltaPct}%${timeStr}`;
  }
  return null;
}

export function formatResetsIn(resetAtMs: number | null, nowMs = Date.now()): string | null {
  if (resetAtMs === null || resetAtMs <= 0) return null;
  const diff = resetAtMs - nowMs;
  if (diff <= 0) return 'resets soon';
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `resets in ${h}h${m > 0 ? ` ${m}m` : ''}`;
  }
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return `resets in ${d}d${h > 0 ? ` ${h}h` : ''}`;
}

export function formatCapturedAgo(capturedAtMs: number | null, nowMs = Date.now()): string | null {
  if (capturedAtMs === null || capturedAtMs <= 0) return null;
  const diff = Math.max(0, nowMs - capturedAtMs);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'captured just now';
  return `captured ${mins}m ago`;
}
