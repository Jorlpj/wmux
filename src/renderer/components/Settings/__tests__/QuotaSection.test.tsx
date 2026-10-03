// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QuotaSection } from '../tabs/TokenUsageTab/QuotaSection';
import type { AccountQuotasResult } from '../../../../shared/tokenUsage/accountQuotaTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const result: AccountQuotasResult = {
  providers: [
    {
      provider: 'claude',
      accounts: [
        { key: 'default', label: 'Default', status: 'ok', message: null, cells: [
          { id: '5h', usedPct: 8, resetAtMs: null }, { id: 'weekly', usedPct: 5, resetAtMs: null }, { id: 'fable', usedPct: 0, resetAtMs: null },
        ] },
        { key: 'c1', label: 'Work', status: 'ok', message: null, cells: [
          { id: '5h', usedPct: 30, resetAtMs: null }, { id: 'weekly', usedPct: 60, resetAtMs: null },
        ] },
      ],
    },
    {
      provider: 'agy',
      accounts: [
        { key: 'g1', label: 'a@x.com', status: 'ok', message: null, cells: [
          { id: '5h', usedPct: 10, resetAtMs: null }, { id: 'weekly', usedPct: 45, resetAtMs: null },
        ] },
        { key: 'g2', label: 'b@x.com', status: 'unknown', message: null, cells: [] },
      ],
    },
  ],
};

describe('QuotaSection', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let readAccountQuotas: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    readAccountQuotas = vi.fn(async ({ providers }: { providers: string[] }) => ({
      providers: result.providers.filter((p) => providers.includes(p.provider)),
    }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      tokenUsage: {
        readAccountQuotas,
        agySensorStatus: vi.fn(async () => ({ state: 'installed', settingsPath: '', hasData: true, message: null })),
      },
    };
    await act(async () => {
      root.render(<QuotaSection providers={['claude', 'agy']} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows one row per account with 5h, weekly and, for Claude, Fable', () => {
    const claude = container.querySelector('[data-quota-provider="claude"]')!;
    expect(claude.querySelectorAll('[data-quota-account]')).toHaveLength(2);
    const work = claude.querySelector('[data-quota-account="c1"]')!;
    expect([...work.querySelectorAll('[data-quota-cell]')].map((c) => c.getAttribute('data-quota-cell'))).toEqual(['5h', 'weekly']);
    expect(claude.querySelector('[data-quota-account="default"] [data-quota-cell="fable"]')?.textContent).toContain('0%');
  });

  it('shows agy with 5h and weekly only, and says when an account is not measured', () => {
    const agy = container.querySelector('[data-quota-provider="agy"]')!;
    expect(agy.querySelectorAll('[data-quota-cell="fable"]')).toHaveLength(0);
    expect(agy.querySelector('[data-quota-account="g2"]')?.textContent).toContain('Not measured yet');
  });

  it('reads once on open, and only that provider on its refresh', async () => {
    expect(readAccountQuotas).toHaveBeenCalledTimes(1);
    await act(async () => {
      (container.querySelector('[data-testid="quota-refresh-agy"]') as HTMLButtonElement).click();
    });
    expect(readAccountQuotas).toHaveBeenLastCalledWith({ providers: ['agy'] });
  });
});
