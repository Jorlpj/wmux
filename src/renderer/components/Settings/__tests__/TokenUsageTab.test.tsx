// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TokenUsageView, type TokenUsageViewProps } from '../tabs/TokenUsageTab';
import { t as translate } from '../../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = translate as unknown as TokenUsageViewProps['t'];

describe('TokenUsageView', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('is only quota and surface editing: no model profiles, no Command Deck', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      tokenUsage: {
        readAccountQuotas: vi.fn(async () => ({ providers: [] })),
        agySensorStatus: vi.fn(async () => null),
        readInventory: vi.fn(async () => ({ items: [], provider: 'claude', cliVersion: null, versionSupported: true, writable: true, warnings: [], scannedAtMs: 0 })),
        listProfiles: vi.fn(async () => []),
      },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TokenUsageView t={t} />);
    });

    expect(container.querySelector('[data-testid="token-quota-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="token-custom-panel"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Balanced');
    expect(container.textContent).not.toContain('Orchestrator model');

    act(() => root.unmount());
    container.remove();
  });
});
