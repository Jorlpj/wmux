import type {
  AgySensorStatus,
  ProviderQuotaReading,
  QuotaProviderId,
} from '../../../../../../shared/tokenUsage/quotaTypes';
import Button from '../../../../ui/Button';
import Badge from '../../../../ui/Badge';
import { formatCapturedAgo, providerDisplayName } from './quotaFormatters';
import { QuotaWindowRow } from './QuotaWindowRow';

export interface ProviderQuotaCardProps {
  provider: QuotaProviderId;
  reading?: ProviderQuotaReading;
  loading?: boolean;
  onRefresh: () => void;
  agySensorStatus?: AgySensorStatus | null;
  onInstallSensor?: () => void;
  installingSensor?: boolean;
}

export function ProviderQuotaCard({
  provider,
  reading,
  loading = false,
  onRefresh,
  agySensorStatus,
  onInstallSensor,
  installingSensor = false,
}: ProviderQuotaCardProps) {
  const quota = reading?.quota;
  const deltas = reading?.deltas ?? [];

  const displayName = providerDisplayName(provider);
  const planLabel = quota?.planLabel;
  const creditsLabel = quota?.creditsLabel;
  const capturedAgo = provider === 'agy' && quota?.capturedAtMs ? formatCapturedAgo(quota.capturedAtMs) : null;

  const showInstallSensor =
    provider === 'agy' &&
    (agySensorStatus?.state === 'missing' ||
      agySensorStatus?.state === 'error' ||
      quota?.status === 'sensor-missing');

  return (
    <div
      className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-2.5"
      data-testid={`quota-card-${provider}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-[var(--text-main)]">{displayName}</span>
          {planLabel && <Badge tone="neutral">{planLabel}</Badge>}
          {creditsLabel && (
            <span className="text-[11px] text-[var(--text-sub)] font-mono">{creditsLabel}</span>
          )}
          {capturedAgo && (
            <span className="text-[11px] text-[var(--text-muted)]">{capturedAgo}</span>
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          aria-label={`Refresh ${displayName} quota`}
          data-testid={`quota-refresh-${provider}`}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {loading && !reading ? (
        <div className="text-[11px] text-[var(--text-sub)] py-2" data-testid={`quota-loading-${provider}`}>
          Loading quota...
        </div>
      ) : quota && quota.status === 'ok' ? (
        <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
          {quota.windows.length === 0 ? (
            <div className="text-[11px] text-[var(--text-sub)] py-1">No quota windows reported.</div>
          ) : (
            quota.windows.map((w) => (
              <QuotaWindowRow
                key={w.id}
                window={w}
                delta={deltas.find((d) => d.windowId === w.id)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 py-1">
          <div className="text-[11px] text-[var(--text-sub)]" data-testid={`quota-message-${provider}`}>
            {quota?.message ?? 'No quota data available.'}
          </div>

          {showInstallSensor && (
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={onInstallSensor}
                disabled={installingSensor}
                data-testid="agy-install-sensor"
              >
                {installingSensor ? 'Installing...' : 'Install sensor'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
