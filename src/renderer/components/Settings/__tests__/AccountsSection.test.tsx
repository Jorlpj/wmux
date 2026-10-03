// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { AccountsSection } from '../AccountsSection';

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
};

describe('AccountsSection: one panel for Claude, Codex and Antigravity', () => {
  let container: HTMLElement;
  let unmount: () => void;

  beforeEach(async () => {
    const w = window as unknown as { electronAPI: Record<string, unknown> };
    w.electronAPI = {
      accounts: {
        list: vi.fn(async () => ({
          accounts: [{
            id: 'c1', vendor: 'claude', name: 'Work', configDir: '/c1', createdAt: 0,
            status: { loggedIn: true, subscriptionType: 'max' }, loginCommand: 'claude',
          }],
        })),
        usageList: vi.fn(async () => []),
        onUsageUpdate: vi.fn(() => () => undefined),
      },
      accountRotation: {
        get: vi.fn(async () => ({ settings: { claude: false, codex: false }, rows: [] })),
        set: vi.fn(async () => ({ ok: true })),
      },
      agyAccounts: {
        list: vi.fn(async () => ({
          supported: true,
          autoRotate: false,
          activeEmail: 'a@x.com',
          accounts: [{
            id: 'g1', email: 'a@x.com', label: '', addedAt: 0, state: 'active', active: true,
            remaining: 0.5, availableAtMs: null, quota: null,
          }],
          login: { pending: false, previousEmail: null, startedAt: null, lastResult: null },
        })),
        onChanged: vi.fn(() => () => undefined),
        setAutoRotate: vi.fn(async () => ({ ok: true })),
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<AccountsSection />));
    unmount = () => { act(() => root.unmount()); container.remove(); };
    await flush();
  });

  afterEach(() => unmount());

  it('lists agy accounts and their switch in the same section as Claude and Codex', () => {
    const sections = container.querySelectorAll('section, [data-settings-section]');
    expect(container.querySelector('[data-account-row="c1"]')).not.toBeNull();
    expect(container.querySelector('[data-agy-account-row="g1"]')).not.toBeNull();
    expect(container.querySelector('[data-rotation-vendor="agy"]')).not.toBeNull();
    expect(container.querySelector('[data-rotation-vendor="claude"]')).not.toBeNull();
    expect(sections.length).toBeLessThanOrEqual(1);
  });

  it('offers Antigravity in Add account', async () => {
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Add account'))!;
    await act(async () => { add.click(); });
    expect(container.textContent).toContain('Antigravity');
  });
});
