// What each CLI lets wmux switch off, and how. Encodes PLAN-token-usage.md section 3 corrected by the
// phase-2 spike (agy 1.2.14, codex-cli 0.159.2). Adapters read this instead of re-deriving it.

import type { SurfaceEffect, SurfaceKind, SurfaceProviderId } from './surfaceTypes';

export type CapabilityStatus =
  | 'verified' // confirmed on the tested CLI version
  | 'documented' // from official docs, not re-tested
  | 'unsupported'; // the CLI has no mechanism

export interface SurfaceCapability {
  kind: SurfaceKind;
  effect: SurfaceEffect;
  status: CapabilityStatus;
  /** Where/how the adapter writes. Informational; the adapter owns the actual edit. */
  mechanism: string;
}

/** CLI version ranges the writers were tested against. Outside the range an adapter is read-only. */
export const TESTED_CLI_VERSIONS = {
  agy: { min: '1.2.14', max: '1.2.14' },
  codex: { min: '0.159.2', max: '0.159.2' },
  claude: { min: '0.0.0', max: '999.0.0' },
} as const satisfies Record<SurfaceProviderId, { min: string; max: string }>;

export const SURFACE_CAPABILITIES: Record<SurfaceProviderId, SurfaceCapability[]> = {
  agy: [
    { kind: 'mcp-server', effect: 'removes', status: 'documented', mechanism: 'mcp_config.json mcpServers.<n>.disabled' },
    { kind: 'mcp-tool', effect: 'removes', status: 'documented', mechanism: 'mcp_config.json mcpServers.<n>.disabledTools' },
    // Spike: `agy plugin disable` writes config.json plugins.<dir>.enabled; `plugin list` does NOT list on-disk
    // plugins, so the inventory must scan plugin directories.
    { kind: 'plugin', effect: 'removes', status: 'verified', mechanism: 'config.json plugins.<dir>.enabled (via `agy plugin enable|disable`)' },
    // Spike: top-level `exclude` in skills.json works for workspace and global skills, by EXACT directory name
    // (no regex). Built-in skills cannot be excluded.
    { kind: 'skill', effect: 'removes', status: 'verified', mechanism: 'skills.json top-level exclude: exact directory names; built-ins cannot be disabled' },
    { kind: 'hook', effect: 'removes', status: 'verified', mechanism: 'hooks.json <hookName>.enabled = false' },
    { kind: 'builtin-tool', effect: 'blocks', status: 'unsupported', mechanism: 'settings.json permissions only (blocks, does not remove)' },
    { kind: 'context-setting', effect: 'none', status: 'unsupported', mechanism: 'no budget / compact keys' },
  ],
  codex: [
    { kind: 'mcp-server', effect: 'removes', status: 'documented', mechanism: 'config.toml [mcp_servers.X] enabled = false' },
    { kind: 'mcp-tool', effect: 'removes', status: 'documented', mechanism: 'config.toml enabled_tools / disabled_tools' },
    { kind: 'plugin', effect: 'removes', status: 'documented', mechanism: 'config.toml [plugins."n@m"] enabled = false' },
    // Spike: `path` must be the SKILL.md FILE. A folder path had no effect on 0.159.2.
    { kind: 'skill', effect: 'removes', status: 'verified', mechanism: 'config.toml [[skills.config]] path = "<...>/SKILL.md", enabled = false' },
    { kind: 'hook', effect: 'removes', status: 'documented', mechanism: 'config.toml [hooks.state."<file>:<event>:<group>:<handler>"] enabled = false; never touch trusted_hash' },
    { kind: 'builtin-tool', effect: 'removes', status: 'documented', mechanism: 'config.toml [features] shell_tool / multi_agent / memories; web_search' },
    { kind: 'context-setting', effect: 'removes', status: 'documented', mechanism: 'model_verbosity, tool_output_token_limit, model_auto_compact_token_limit, [memories]' },
  ],
  claude: [
    { kind: 'mcp-server', effect: 'removes', status: 'documented', mechanism: '~/.claude.json projects[path].disabledMcpServers (merge, mtime check) or settings deniedMcpServers' },
    { kind: 'mcp-tool', effect: 'removes', status: 'documented', mechanism: 'settings permissions.deny with a bare tool name or glob' },
    { kind: 'plugin', effect: 'removes', status: 'documented', mechanism: 'settings enabledPlugins["n@m"] = false' },
    { kind: 'skill', effect: 'removes', status: 'documented', mechanism: 'settings skillOverrides; not valid for plugin skills' },
    { kind: 'hook', effect: 'removes', status: 'documented', mechanism: 'no per-hook switch: remove the entry and keep it in surfaces.json for restore' },
    { kind: 'builtin-tool', effect: 'removes', status: 'documented', mechanism: 'settings permissions.deny with a bare tool name' },
    { kind: 'context-setting', effect: 'removes', status: 'documented', mechanism: 'autoMemoryEnabled, claudeMdExcludes, skillListingBudgetFraction, ENABLE_TOOL_SEARCH' },
  ],
};

export function capabilityFor(provider: SurfaceProviderId, kind: SurfaceKind): SurfaceCapability | undefined {
  return SURFACE_CAPABILITIES[provider].find((c) => c.kind === kind);
}
