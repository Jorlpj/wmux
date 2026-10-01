// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomPanel } from '../CustomPanel';
import type { ProviderInventory } from '../../../../../../shared/tokenUsage/surfaceTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockClaudeInventory: ProviderInventory = {
  provider: 'claude',
  cliVersion: '1.0.5',
  versionSupported: true,
  writable: true,
  items: [
    {
      id: 'claude:mcp-server::my-server',
      provider: 'claude',
      kind: 'mcp-server',
      name: 'my-server',
      parent: null,
      source: 'user',
      enabled: true,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: null,
      hookCost: null,
      descriptionChars: null,
      originPath: '/home/.claude.json',
      wmuxRequired: false,
    },
    {
      id: 'claude:mcp-tool:my-server:tool-a',
      provider: 'claude',
      kind: 'mcp-tool',
      name: 'tool-a',
      parent: 'my-server',
      source: 'user',
      enabled: false,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: null,
      hookCost: null,
      descriptionChars: null,
      originPath: '/home/.claude.json',
      wmuxRequired: false,
    },
    {
      id: 'claude:skill::my-skill',
      provider: 'claude',
      kind: 'skill',
      name: 'my-skill',
      parent: null,
      source: 'user',
      enabled: true,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: null,
      hookCost: null,
      descriptionChars: 42,
      originPath: '/home/.claude/skills/my-skill/SKILL.md',
      wmuxRequired: false,
    },
    {
      id: 'claude:plugin::my-plugin',
      provider: 'claude',
      kind: 'plugin',
      name: 'my-plugin',
      parent: null,
      source: 'user',
      enabled: false,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: null,
      hookCost: null,
      descriptionChars: null,
      originPath: '/home/.claude/settings.json',
      wmuxRequired: false,
    },
    {
      id: 'claude:hook::my-hook',
      provider: 'claude',
      kind: 'hook',
      name: 'my-hook',
      parent: null,
      source: 'wmux',
      enabled: true,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: 'SessionStart',
      hookCost: 'injects-context',
      descriptionChars: null,
      originPath: '/home/.claude/settings.json',
      wmuxRequired: true,
    },
    {
      id: 'claude:builtin-tool::WebSearch',
      provider: 'claude',
      kind: 'builtin-tool',
      name: 'WebSearch',
      parent: null,
      source: 'builtin',
      enabled: false,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: null,
      hookCost: null,
      descriptionChars: null,
      originPath: '/home/.claude/settings.json',
      wmuxRequired: false,
    },
  ],
  warnings: ['Sample test warning about tools/list'],
  scannedAtMs: 123456789,
};

const mockCodexInventory: ProviderInventory = {
  provider: 'codex',
  cliVersion: '0.159.2',
  versionSupported: true,
  writable: true,
  items: [
    {
      id: 'codex:mcp-server::codex-server',
      provider: 'codex',
      kind: 'mcp-server',
      name: 'codex-server',
      parent: null,
      source: 'user',
      enabled: true,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: null,
      hookCost: null,
      descriptionChars: null,
      originPath: '/home/.codex/config.toml',
      wmuxRequired: false,
    },
  ],
  warnings: [],
  scannedAtMs: 123456789,
};

describe('CustomPanel UI', () => {
  let readInventoryMock: ReturnType<typeof vi.fn>;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    readInventoryMock = vi.fn().mockImplementation(async ({ provider }) => {
      if (provider === 'claude') return mockClaudeInventory;
      if (provider === 'codex') return mockCodexInventory;
      return {
        provider,
        cliVersion: null,
        versionSupported: false,
        writable: false,
        items: [],
        warnings: [],
        scannedAtMs: Date.now(),
      };
    });

    (window as any).electronAPI = {
      tokenUsage: {
        readInventory: readInventoryMock,
      },
    };
  });

  afterEach(() => {
    document.body.removeChild(container);
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
  });

  it('renders initial panel with claude inventory and placeholder note', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CustomPanel));
    });

    // Check placeholder note persists
    expect(container.querySelector('[data-testid="token-custom-panel"]')?.textContent).toContain(
      'Per-provider MCP/tool/skill/plugin/hook editing is not implemented yet.',
    );

    // Initial load requested claude
    expect(readInventoryMock).toHaveBeenCalledWith({ provider: 'claude' });

    // Check items rendered
    expect(container.textContent).toContain('my-server');
    expect(container.textContent).toContain('tool-a');
    expect(container.textContent).toContain('my-skill');
    expect(container.textContent).toContain('42 chars');
    expect(container.textContent).toContain('my-plugin');
    expect(container.textContent).toContain('my-hook');
    expect(container.textContent).toContain('injects-context');
    expect(container.textContent).toContain('wmux required');
    expect(container.textContent).toContain('WebSearch');

    // Check warning rendered
    expect(container.querySelector('[data-testid="token-custom-warnings"]')?.textContent).toContain(
      'Sample test warning about tools/list',
    );

    // Check "needs a new session" note
    expect(container.textContent).toContain('Changes take effect on the next CLI session.');

    // Assert read-only rows have NO toggle control (no checkbox or switch for item rows)
    const serverRow = container.querySelector('[data-testid="mcp-server-my-server"]');
    expect(serverRow?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(serverRow?.querySelector('[role="switch"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('switching provider tab loads the new provider inventory', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CustomPanel));
    });

    expect(readInventoryMock).toHaveBeenCalledWith({ provider: 'claude' });

    // Find and click codex segment
    const codexButton = container.querySelector('button[role="radio"][aria-checked="false"]') as HTMLButtonElement;
    expect(codexButton).toBeTruthy();

    await act(async () => {
      codexButton.click();
    });

    expect(readInventoryMock).toHaveBeenCalledWith({ provider: 'codex' });
    expect(container.textContent).toContain('codex-server');

    await act(async () => {
      root.unmount();
    });
  });

  it('search box filters items by name', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CustomPanel));
    });

    const searchInput = container.querySelector('[data-testid="token-custom-search"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(searchInput, 'my-skill');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // my-skill should remain, WebSearch should not
    expect(container.textContent).toContain('my-skill');
    expect(container.textContent).not.toContain('WebSearch');

    await act(async () => {
      root.unmount();
    });
  });

  it('only changed checkbox filters to items where enabled is false', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CustomPanel));
    });

    const onlyChanged = container.querySelector('[data-testid="token-custom-only-changed"]') as HTMLElement;
    expect(onlyChanged).toBeTruthy();

    await act(async () => {
      onlyChanged.click();
    });

    // Enabled items (my-server, my-skill, my-hook) should be filtered out
    expect(container.querySelector('[data-testid="skill-my-skill"]')).toBeNull();
    expect(container.querySelector('[data-testid="hook-my-hook"]')).toBeNull();

    // Disabled items (tool-a, my-plugin, WebSearch) should be shown
    expect(container.textContent).toContain('my-plugin');
    expect(container.textContent).toContain('WebSearch');
    // Parent server of tool-a is retained and rendered dimmed above tool-a
    expect(container.querySelector('[data-testid="mcp-server-my-server"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mcp-server-header-my-server"]')?.className).toContain('opacity-60');
    expect(container.querySelector('[data-testid="mcp-tool-tool-a"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('when search filters out parent server but keeps child tool, still renders parent server row above the tool', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CustomPanel));
    });

    const searchInput = container.querySelector('[data-testid="token-custom-search"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(searchInput, 'tool-a');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Parent server row is still rendered above the tool
    const serverRow = container.querySelector('[data-testid="mcp-server-my-server"]');
    expect(serverRow).not.toBeNull();
    const serverHeader = container.querySelector('[data-testid="mcp-server-header-my-server"]');
    expect(serverHeader?.className).toContain('opacity-60');

    // Retained child tool is rendered
    expect(container.querySelector('[data-testid="mcp-tool-tool-a"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
