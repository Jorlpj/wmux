import { useCallback, useEffect, useState } from 'react';
import type { AgyAccountRow, AgyAccountsSnapshot } from '../../../shared/agyAccounts';
import type { AgyLoginState } from '../../../main/account/AgyAccountService';
import { useT } from '../../hooks/useT';
import { useStore } from '../../stores';
import { IconX } from '../icons';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Input from '../ui/Input';
import { openTerminalTab } from '../../utils/accountLogin';

// Antigravity (agy) pieces of Settings → Accounts. agy keeps ONE sign-in for the
// whole machine, so its accounts are not bound per workspace like Claude/Codex:
// wmux keeps a vault copy of each and swaps the active one, on demand ("Use
// now") or before an agy launch when the switch is on. AccountsSection renders
// these next to the Claude and Codex rows, in the same container.

type Snapshot = AgyAccountsSnapshot & { login: AgyLoginState };
type AgyApi = NonNullable<NonNullable<typeof window.electronAPI>['agyAccounts']>;

/** Snapshots carry the quota fractions the sensor last saw for each account. */
const POLL_MS = 15_000;

export interface AgyAccounts {
  api: AgyApi;
  snap: Snapshot;
  run: (p: Promise<unknown>) => void;
  signIn: () => void;
}

/** Live agy registry; null when the preload has no agy API or it has not loaded yet. */
export function useAgyAccounts(): AgyAccounts | null {
  const t = useT();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const api = window.electronAPI?.agyAccounts;

  const reload = useCallback(() => {
    if (!api) return;
    void api.list().then(setSnap).catch(() => { /* useIpc surfaces the error */ });
  }, [api]);

  useEffect(() => {
    reload();
    const off = api?.onChanged(reload);
    const timer = setInterval(reload, POLL_MS);
    return () => { off?.(); clearInterval(timer); };
  }, [api, reload]);

  if (!api || !snap) return null;
  const run = (p: Promise<unknown>) => { void p.then(reload).catch((err: unknown) => {
    useStore.getState().pushToast({ level: 'error', message: err instanceof Error ? err.message : String(err) });
    reload();
  }); };
  const signIn = () => {
    run(api.beginLogin().then(async () => {
      const tab = await openTerminalTab({ initialCommand: 'agy', title: t('agyAccounts.loginTabTitle') });
      if (!tab) {
        await api.cancelLogin();
        useStore.getState().pushToast({ level: 'error', message: t('agyAccounts.loginTabFailed') });
      }
    }));
  };
  return { api, snap, run, signIn };
}

function pct(fraction: number | undefined): string | null {
  return typeof fraction === 'number' && Number.isFinite(fraction) ? `${Math.round(fraction * 100)}%` : null;
}

function QuotaBits({ row }: { row: AgyAccountRow }): React.ReactElement | null {
  const t = useT();
  const q = row.quota?.quota;
  const fiveH = pct(q?.['gemini-5h']?.remaining_fraction);
  const weekly = pct(q?.['gemini-weekly']?.remaining_fraction);
  if (!fiveH && !weekly) {
    return <span className="text-[11px] text-[var(--text-muted)] shrink-0">{t('agyAccounts.quotaUnknown')}</span>;
  }
  return (
    <span className="text-[11px] text-[var(--text-sub)] shrink-0 tabular-nums" title={t('agyAccounts.quotaTitle')}>
      {fiveH && t('agyAccounts.quota5h', { pct: fiveH })}
      {fiveH && weekly && ' · '}
      {weekly && t('agyAccounts.quotaWeekly', { pct: weekly })}
    </span>
  );
}

function StateBadge({ row }: { row: AgyAccountRow }): React.ReactElement {
  const t = useT();
  if (row.state === 'needs-reauth') return <Badge tone="danger" className="shrink-0">{t('agyAccounts.needsSignIn')}</Badge>;
  if (row.state === 'exhausted') {
    const until = row.availableAtMs ? new Date(row.availableAtMs).toLocaleString() : null;
    return (
      <Badge tone="warning" className="shrink-0" title={until ? t('agyAccounts.exhaustedUntil', { time: until }) : undefined}>
        {t('agyAccounts.exhausted')}
      </Badge>
    );
  }
  if (row.active) return <Badge tone="success" className="shrink-0">{t('agyAccounts.active')}</Badge>;
  return <Badge className="shrink-0">{t('agyAccounts.ready')}</Badge>;
}

/** The agy "Switch accounts by quota" row, next to the Claude and Codex ones. */
export function AgyRotationRow({ agy }: { agy: AgyAccounts }): React.ReactElement | null {
  const t = useT();
  if (!agy.snap.supported) return null;
  return (
    <div className="ui-row" data-rotation-vendor="agy">
      <Checkbox
        checked={agy.snap.autoRotate}
        onCheckedChange={(on) => agy.run(agy.api.setAutoRotate(on))}
        aria-label={t('agyAccounts.autoRotate')}
      />
      <span className="flex-1 text-[13px] text-[var(--text-main)]">{t('agyAccounts.autoRotate')}</span>
    </div>
  );
}

/** One row per agy account, plus the sign-in in progress. */
export function AgyAccountRows({ agy }: { agy: AgyAccounts }): React.ReactElement | null {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const { api, snap, run } = agy;
  if (!snap.supported) return null;

  const rename = (id: string) => {
    run(api.rename(id, editLabel));
    setEditingId(null);
  };

  return (
    <>
      {snap.accounts.map((r) => (
        <div key={r.id} className="ui-row" data-agy-account-row={r.id}>
          <Badge className="shrink-0">agy</Badge>
          {editingId === r.id ? (
            <Input
              className="settings-input flex-1"
              aria-label={t('agyAccounts.labelPlaceholder')}
              placeholder={t('agyAccounts.labelPlaceholder')}
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') rename(r.id); if (e.key === 'Escape') setEditingId(null); }}
              onBlur={() => rename(r.id)}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="flex-1 min-w-0 text-left text-[13px] text-[var(--text-main)] truncate hover:underline rounded"
              onClick={() => { setEditingId(r.id); setEditLabel(r.label); }}
              title={r.email}
            >
              {r.label ? <><span className="font-medium">{r.label}</span> <span className="text-[var(--text-sub)]">{r.email}</span></> : r.email}
            </button>
          )}
          <StateBadge row={r} />
          <QuotaBits row={r} />
          {!r.active && r.state !== 'needs-reauth' && (
            <Button variant="secondary" size="md" className="shrink-0" disabled={snap.login.pending} onClick={() => run(api.activate(r.id))}>
              {t('agyAccounts.useNow')}
            </Button>
          )}
          {confirmRemove === r.id ? (
            <span className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="md" onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" size="md" onClick={() => { setConfirmRemove(null); run(api.remove(r.id)); }}>{t('common.remove')}</Button>
            </span>
          ) : (
            <Button
              variant="icon"
              className="shrink-0"
              onClick={() => setConfirmRemove(r.id)}
              title={t('agyAccounts.removeTitle')}
              aria-label={t('agyAccounts.removeTitle')}
            >
              <IconX size={12} />
            </Button>
          )}
        </div>
      ))}
      {snap.activeEmail && !snap.accounts.some((a) => a.active) && !snap.login.pending && (
        <div className="ui-row">
          <Badge className="shrink-0">agy</Badge>
          <span className="flex-1 text-[13px] text-[var(--text-sub)]">{t('agyAccounts.notRegistered')}</span>
          <Button variant="secondary" size="md" className="shrink-0" onClick={() => run(api.addCurrent())}>
            {t('agyAccounts.addCurrent', { email: snap.activeEmail })}
          </Button>
        </div>
      )}
      {snap.login.restoreFailed && !snap.login.pending && (
        <div className="ui-row" role="alert">
          <span className="flex-1 text-[13px] text-[var(--text-sub)]">
            {t('agyAccounts.restoreFailed', { email: snap.login.restoreFailed })}
          </span>
        </div>
      )}
      {snap.login.pending && (
        <div className="ui-row">
          <span className="flex-1 text-[13px] text-[var(--text-sub)]">{t('agyAccounts.waitingForSignIn')}</span>
          <Button variant="ghost" size="md" onClick={() => run(api.cancelLogin())}>{t('common.cancel')}</Button>
        </div>
      )}
    </>
  );
}
