// ─── Per-role MCP surfaces (launch-time optimization, like --core) ───────────
//
// `--role=<Role>` narrows tools/list to what an orchestrator role actually
// calls. Like `--core` (src/shared/coreSurface.ts) it is an OPTIMIZATION, not a
// security boundary: no role claim, no token, no RPC lane changes. A pane that
// wants more simply launches without the flag.
//
// Every surface is a subset of CORE_TOOL_SURFACE (asserted in
// src/shared/__tests__/roleSurfaces.test.ts), so the server runs the core
// profile and then drops every name outside the role's list.
//
// Builder / Tester are empty on purpose: those panes edit and test code and
// never drive wmux, so the cheapest surface is no wmux tools at all.

import type { OrchRole } from './orchestratorRole';

export const ROLE_TOOL_SURFACES: Readonly<Record<OrchRole, readonly string[]>> = {
  Planner: [
    'terminal_read',
    'terminal_send',
    'terminal_send_key',
    'pane_list',
    'pane_metadata',
    'send_message',
  ],
  Reviewer: [
    'terminal_read',
    'workspace_list',
    'pane_list',
    'channel_join',
    'channel_post',
  ],
  Builder: [],
  Tester: [],
};

/**
 * Launch tokens that point an agent CLI's `wmux` MCP server at a role surface,
 * keeping the server NAME "wmux" so it replaces the user-level registration
 * instead of adding a second one. Verified 2026-09-30:
 *   - claude 2.1.285: `--mcp-config <inline json>` with a server named `wmux`
 *     replaces the ~/.claude.json one (init lists one wmux, exactly the role's
 *     tools); other servers stay, so no `--strict-mcp-config`.
 *   - codex 0.159.2: `-c mcp_servers.wmux.args=[...]` overrides the args
 *     (`codex mcp get wmux`), `-c mcp_servers.wmux.enabled=false` disables it.
 *   - agy: no MCP servers are registered, nothing to narrow.
 * `entry` is the stdio bundle the CLI configs already use (~/.wmux/mcp/index.js).
 * Returns null for agents with no verified grammar.
 */
export function roleMcpArgv(agent: string, role: OrchRole, entry: string): string[] | null {
  const serverArgs = [entry, `${ROLE_MODE_ARG_PREFIX}${role}`];
  const empty = ROLE_TOOL_SURFACES[role].length === 0;
  switch (agent) {
    case 'claude':
      return ['--mcp-config', JSON.stringify({ mcpServers: { wmux: { command: 'node', args: serverArgs } } })];
    case 'codex':
      // JSON string escaping is valid TOML basic-string escaping.
      return empty
        ? ['-c', 'mcp_servers.wmux.enabled=false']
        : ['-c', `mcp_servers.wmux.args=${JSON.stringify(serverArgs)}`];
    case 'agy':
      return [];
    default:
      return null;
  }
}

/** Launch argument prefix. An argv flag, never an env var (same rule as
 *  CORE_MODE_ARG): the client config declares it in the server `args`. */
export const ROLE_MODE_ARG_PREFIX = '--role=';

export type RoleArg =
  | { kind: 'none' }
  | { kind: 'role'; role: OrchRole }
  | { kind: 'unknown'; value: string };

/** Read `--role=<Role>` from argv (last one wins, case-sensitive role name). */
export function parseRoleArg(argv: readonly string[]): RoleArg {
  return resolveRoleName(roleArgValue(argv));
}

/** The raw `--role=` value from argv (last one wins), or undefined. Passed
 *  through unvalidated so the server can report an unknown name itself. */
export function roleArgValue(argv: readonly string[]): string | undefined {
  const hit = [...argv].reverse().find((a) => a.startsWith(ROLE_MODE_ARG_PREFIX));
  return hit === undefined ? undefined : hit.slice(ROLE_MODE_ARG_PREFIX.length);
}

/** Validate a role name from argv or a shim handshake. */
export function resolveRoleName(value: string | undefined): RoleArg {
  if (value === undefined || value === '') return { kind: 'none' };
  return Object.prototype.hasOwnProperty.call(ROLE_TOOL_SURFACES, value)
    ? { kind: 'role', role: value as OrchRole }
    : { kind: 'unknown', value };
}
