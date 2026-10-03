import { useCallback, useEffect, useRef, useState } from 'react';
import { QUOTA_PROVIDERS, type AgySensorStatus, type QuotaProviderId } from '../../../../../shared/tokenUsage/quotaTypes';
import type {
  AccountQuotaCell,
  AccountQuotaLine,
  CompactWindowId,
  ProviderAccountQuotas,
} from '../../../../../shared/tokenUsage/accountQuotaTypes';
import { SettingNote, SettingsSection } from '../../SettingsLayout';
import Button from '../../../ui/Button';
import { IconRefresh } from '../../../icons';
import { useT } from '../../../../hooks/useT';
import { formatResetsIn, providerDisplayName } from './quota/quotaFormatters';

import type { ReactElement } from 'react';

// Settings → Token usage → Quota. One block per provider and one row per
// account, each row showing only 5h | weekly | Fable (Claude, when the account
// has it). Read when the tab opens and on Refresh, never on a timer.

type T = (key: string, vars?: Record<string, string | number>) => string;

const CELL_LABEL: Record<CompactWindowId, string> = { '5h': '5h', weekly: 'weekly', fable: 'Fable' };

/** Warning hue from 80% used (DESIGN.md: colour carries state only). */
function meterColor(pct: number): string {
  return pct >= 80 ? 'var(--accent-yellow)' : 'var(--text-sub)';
}

function QuotaCell({ cell, t }: { cell: AccountQuotaCell | undefined; t: T }): ReactElement {
  if (!cell) return <div className="flex-1 min-w-0" />;
  const pct = cell.usedPct;
  const resets = formatResetsIn(cell.resetAtMs, Date.now(), t);
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1" data-quota-cell={cell.id}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-[var(--text-sub)]">{CELL_LABEL[cell.id]}</span>
        <span className="tabular-nums text-[var(--text-main)]">{pct === null ? '—' : `${pct}%`}</span>
      </div>
      <div className="h-[3px] rounded-full bg-[var(--border)] overflow-hidden">
        {pct !== null && (
          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: meterColor(pct) }} />
        )}
      </div>
      <span className="text-[11px] text-[var(--text-muted)] truncate">{resets ?? ''}</span>
    </div>
  );
}

function AccountRow({ line, columns, t }: { line: AccountQuotaLine; columns: CompactWindowId[]; t: T }): ReactElement {
  const label = line.key === 'default' ? t('settings.tokenUsage.defaultAccount') : line.label;
  const note = line.status === 'error'
    ? (line.message ?? t('settings.tokenUsage.quotaReadFailed'))
    : line.status === 'unknown' ? t('settings.tokenUsage.quotaNotMeasured') : null;
  return (
    <div className="ui-row items-start gap-4" data-quota-account={line.key}>
      <span className="w-[160px] shrink-0 truncate text-[13px] text-[var(--text-main)] pt-[1px]" title={line.label}>
        {label}
        {line.status === 'stale' && <span className="ml-1 text-[11px] text-[var(--text-muted)]">({t('accounts.stale')})</span>}
      </span>
      {note && line.cells.length === 0 ? (
        <span className="flex-1 min-w-0 truncate text-[11px] text-[var(--text-muted)]" title={note}>{note}</span>
      ) : (
        columns.map((id) => <QuotaCell key={id} cell={line.cells.find((c) => c.id === id)} t={t} />)
      )}
    </div>
  );
}

export interface QuotaSectionProps {
  t?: T;
  /** Providers to show; all by default. */
  providers?: QuotaProviderId[];
}

export function QuotaSection(props: QuotaSectionProps = {}): ReactElement {
  const defaultT = useT();
  const t = props.t ?? defaultT;
  const providers = props.providers ?? [...QUOTA_PROVIDERS];
  const providersKey = providers.join(',');

  const [groups, setGroups] = useState<Partial<Record<QuotaProviderId, ProviderAccountQuotas>>>({});
  const [loading, setLoading] = useState<Partial<Record<QuotaProviderId, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<QuotaProviderId, string>>>({});
  const [agySensor, setAgySensor] = useState<AgySensorStatus | null>(null);
  const [installingAgy, setInstallingAgy] = useState(false);

  const read = useCallback(async (list: QuotaProviderId[]) => {
    const api = window.electronAPI?.tokenUsage;
    if (!api?.readAccountQuotas || list.length === 0) return;
    setLoading((prev) => ({ ...prev, ...Object.fromEntries(list.map((p) => [p, true])) }));
    try {
      const [res, sensor] = await Promise.all([
        api.readAccountQuotas({ providers: list }),
        list.includes('agy') && api.agySensorStatus ? api.agySensorStatus().catch(() => null) : Promise.resolve(undefined),
      ]);
      setGroups((prev) => ({ ...prev, ...Object.fromEntries((res?.providers ?? []).map((g) => [g.provider, g])) }));
      setErrors((prev) => ({ ...prev, ...Object.fromEntries(list.map((p) => [p, undefined])) }));
      if (sensor !== undefined) setAgySensor(sensor);
    } catch (err) {
      // A Refresh that fails must not look like a Refresh that did nothing.
      const message = err instanceof Error ? err.message : String(err);
      setErrors((prev) => ({ ...prev, ...Object.fromEntries(list.map((p) => [p, message])) }));
    } finally {
      setLoading((prev) => ({ ...prev, ...Object.fromEntries(list.map((p) => [p, false])) }));
    }
  }, []);

  // Read on open, and again only when the set of providers really changes.
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (providersKey) void readRef.current(providersKey.split(',') as QuotaProviderId[]);
  }, [providersKey]);

  const installAgySensor = useCallback(async () => {
    const api = window.electronAPI?.tokenUsage;
    if (!api?.installAgySensor) return;
    setInstallingAgy(true);
    try {
      await api.installAgySensor();
      await read(['agy']);
    } finally {
      setInstallingAgy(false);
    }
  }, [read]);

  const anyLoading = providers.some((p) => loading[p]);

  return (
    <SettingsSection
      id="tokenquota"
      title={t('settings.tokenUsage.quotaTitle')}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void read(providers)}
          disabled={anyLoading || providers.length === 0}
          data-testid="quota-update-all"
        >
          {anyLoading ? t('settings.tokenUsage.updating') : t('settings.tokenUsage.updateAll')}
        </Button>
      }
      data-testid="token-quota-section"
    >
      {providers.length === 0 && (
        <SettingNote data-testid="token-quota-empty">{t('settings.tokenUsage.noSupportedAgentBound')}</SettingNote>
      )}
      {providers.map((provider) => {
        const group = groups[provider];
        const columns: CompactWindowId[] = provider === 'claude' && group?.accounts.some((a) => a.cells.some((c) => c.id === 'fable'))
          ? ['5h', 'weekly', 'fable']
          : ['5h', 'weekly'];
        const sensorMissing = provider === 'agy' && agySensor !== null && agySensor.state !== 'installed';
        return (
          <div key={provider} data-quota-provider={provider}>
            <div className="ui-row">
              <span className="flex-1 text-[13px] font-medium text-[var(--text-main)]">{providerDisplayName(provider)}</span>
              {sensorMissing && (
                <Button variant="secondary" size="sm" onClick={() => void installAgySensor()} disabled={installingAgy} data-testid="quota-install-agy-sensor">
                  {t('settings.tokenUsage.installSensor')}
                </Button>
              )}
              <Button
                variant="icon"
                onClick={() => void read([provider])}
                disabled={loading[provider]}
                title={t('settings.tokenUsage.refresh')}
                aria-label={t('settings.tokenUsage.refresh')}
                data-testid={`quota-refresh-${provider}`}
              >
                <IconRefresh size={12} />
              </Button>
            </div>
            {errors[provider] && <SettingNote>{errors[provider]}</SettingNote>}
            {group?.accounts.map((line) => <AccountRow key={line.key} line={line} columns={columns} t={t} />)}
            {!group && !errors[provider] && <SettingNote>{t('settings.tokenUsage.loading')}</SettingNote>}
          </div>
        );
      })}
    </SettingsSection>
  );
}
