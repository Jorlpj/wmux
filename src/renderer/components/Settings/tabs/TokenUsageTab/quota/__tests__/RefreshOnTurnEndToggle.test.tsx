// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import RefreshOnTurnEndToggle from '../RefreshOnTurnEndToggle';
import { useStore } from '../../../../../../stores';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RefreshOnTurnEndToggle', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let mockSetRefreshQuotaOnTurnEnd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockSetRefreshQuotaOnTurnEnd = vi.fn();
    (window as unknown as { electronAPI: { settings: { setRefreshQuotaOnTurnEnd: typeof mockSetRefreshQuotaOnTurnEnd } } }).electronAPI = {
      settings: {
        setRefreshQuotaOnTurnEnd: mockSetRefreshQuotaOnTurnEnd,
      },
    };

    useStore.setState({ refreshQuotaOnTurnEnd: false });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders the switch with label and description, reflecting default false', async () => {
    await act(async () => {
      root.render(<RefreshOnTurnEndToggle />);
    });

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('Also refresh quota at the end of each agent turn');
    expect(container.textContent).toContain('Off by default; each refresh is a request to the provider');
  });

  it('reflects true when store state is true', async () => {
    useStore.setState({ refreshQuotaOnTurnEnd: true });

    await act(async () => {
      root.render(<RefreshOnTurnEndToggle />);
    });

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking the switch updates the store and sends IPC to main', async () => {
    await act(async () => {
      root.render(<RefreshOnTurnEndToggle />);
    });

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle.click();
    });

    expect(useStore.getState().refreshQuotaOnTurnEnd).toBe(true);
    expect(mockSetRefreshQuotaOnTurnEnd).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      toggle.click();
    });

    expect(useStore.getState().refreshQuotaOnTurnEnd).toBe(false);
    expect(mockSetRefreshQuotaOnTurnEnd).toHaveBeenCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('supports keyboard accessibility via Space and Enter keys', async () => {
    await act(async () => {
      root.render(<RefreshOnTurnEndToggle />);
    });

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;

    await act(async () => {
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });

    expect(useStore.getState().refreshQuotaOnTurnEnd).toBe(true);
    expect(mockSetRefreshQuotaOnTurnEnd).toHaveBeenCalledWith(true);

    await act(async () => {
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(useStore.getState().refreshQuotaOnTurnEnd).toBe(false);
    expect(mockSetRefreshQuotaOnTurnEnd).toHaveBeenCalledWith(false);
  });
});
