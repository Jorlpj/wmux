import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseTomlText } from 'smol-toml';
import type { SurfaceFileEdit, SurfaceItem } from '../../../../shared/tokenUsage/surfaceTypes';
import type { TomlEdit } from '../../safeWrite';
import { formatTomlKey, formatTomlValue } from '../../safeWrite/tomlEdit';
import { normalizePath } from '../../inventory/helpers';
import type { ResolvedChange, WriterDeps } from '../types';

export interface PlannedEditsResult {
  tomlEdits: TomlEdit[];
  edits: SurfaceFileEdit[];
  applicableItemIds: string[];
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** Key Codex uses under `hooks.state` for one handler: `<file>:<snake_event>:<group>:<handler>`. */
export function codexHookStateKey(filePath: string, event: string, handlerIdx: number): string {
  return `${filePath}:${toSnakeCase(event)}:0:${handlerIdx}`;
}

function findMatchingSkillPath(
  parsed: Record<string, unknown>,
  originPath: string,
  configDir: string,
): string {
  const skills = parsed.skills as Record<string, unknown> | undefined;
  const skillsConfig = (skills && typeof skills === 'object' && 'config' in skills)
    ? (skills as { config?: unknown }).config
    : parsed['skills.config'];

  if (Array.isArray(skillsConfig)) {
    const normOrigin = normalizePath(originPath, configDir);
    for (const entry of skillsConfig) {
      if (entry && typeof entry === 'object' && typeof entry.path === 'string') {
        if (normalizePath(entry.path, configDir) === normOrigin) {
          return entry.path;
        }
      }
    }
  }
  return originPath;
}

export function normalizeDriveAndSeparators(p: string): string {
  let norm = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(norm)) {
    norm = norm[0].toLowerCase() + norm.slice(1);
  }
  return norm;
}

function findHookStateKey(
  parsed: Record<string, unknown>,
  item: SurfaceItem,
  deps: WriterDeps,
): string {
  const filePath = item.originPath ?? path.join(deps.homeDir, '.codex', 'hooks.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Hooks file not found: ${filePath}`);
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Failed to read hooks file at ${filePath}`);
  }

  let hooksJson: unknown;
  try {
    hooksJson = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse hooks file at ${filePath}`);
  }

  if (!hooksJson || typeof hooksJson !== 'object' || Array.isArray(hooksJson)) {
    throw new Error(`Invalid hooks JSON structure at ${filePath}`);
  }

  const rawJson = hooksJson as Record<string, unknown>;
  const entries = (rawJson.hooks && typeof rawJson.hooks === 'object' && !Array.isArray(rawJson.hooks))
    ? (rawJson.hooks as Record<string, unknown>)
    : rawJson;

  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error(`No hook entries found in ${filePath}`);
  }

  const keys = Object.keys(entries);
  const handlerIdx = keys.indexOf(item.name);
  if (handlerIdx === -1) {
    throw new Error(`Hook '${item.name}' not found in ${filePath}`);
  }

  const rawConf = entries[item.name];
  if (!rawConf || typeof rawConf !== 'object' || Array.isArray(rawConf)) {
    throw new Error(`Invalid hook config for '${item.name}' in ${filePath}`);
  }

  const conf = rawConf as Record<string, unknown>;
  const rawEvent = typeof conf.event === 'string'
    ? conf.event
    : typeof conf.type === 'string'
      ? conf.type
      : item.hookEvent;

  if (!rawEvent) {
    throw new Error(`Cannot determine hook event for '${item.name}' in ${filePath}`);
  }

  const exactKey = codexHookStateKey(filePath, rawEvent, handlerIdx);

  const hooksTable = parsed.hooks as Record<string, unknown> | undefined;
  const hooksState = (hooksTable && typeof hooksTable === 'object' && 'state' in hooksTable)
    ? (hooksTable as { state?: unknown }).state
    : parsed['hooks.state'];

  const normExactKey = normalizeDriveAndSeparators(exactKey);

  if (hooksState && typeof hooksState === 'object' && !Array.isArray(hooksState)) {
    for (const stateKey of Object.keys(hooksState)) {
      if (normalizeDriveAndSeparators(stateKey) === normExactKey) {
        return stateKey;
      }
    }
  }

  return exactKey;
}

/** One plan as it is built. */
interface PlanContext {
  parsed: Record<string, unknown>;
  configPath: string;
  deps: WriterDeps;
  tomlEdits: TomlEdit[];
  edits: SurfaceFileEdit[];
  applicableItemIds: string[];
}

type ItemPlanner = (ctx: PlanContext, item: SurfaceItem, enabled: boolean) => void;

function addEdit(ctx: PlanContext, tomlEdit: TomlEdit, summary: string): void {
  ctx.tomlEdits.push(tomlEdit);
  ctx.edits.push({ path: ctx.configPath, summary });
}

function isWmuxHook(item: SurfaceItem): boolean {
  return item.wmuxRequired || item.source === 'wmux' || item.name.startsWith('wmux-') || item.name === 'codex-notify';
}

function hasFeatureKey(parsed: Record<string, unknown>, name: string): boolean {
  return !!parsed.features && typeof parsed.features === 'object' && name in (parsed.features as Record<string, unknown>);
}

const PLANNERS: Partial<Record<SurfaceItem['kind'], ItemPlanner>> = {
  'mcp-server': (ctx, item, enabled) => {
    ctx.applicableItemIds.push(item.id);
    if (!enabled) {
      addEdit(ctx, { table: ['mcp_servers', item.name], key: 'enabled', op: 'set', value: false }, `set mcp_servers.${formatTomlKey(item.name)}.enabled = false`);
    } else {
      addEdit(ctx, { table: ['mcp_servers', item.name], key: 'enabled', op: 'delete' }, `delete mcp_servers.${formatTomlKey(item.name)}.enabled`);
    }
  },
  plugin: (ctx, item, enabled) => {
    ctx.applicableItemIds.push(item.id);
    addEdit(ctx, { table: ['plugins', item.name], key: 'enabled', op: 'set', value: enabled }, `set plugins.${formatTomlKey(item.name)}.enabled = ${enabled}`);
  },
  skill: (ctx, item, enabled) => {
    if (!item.originPath) {
      throw new Error(`Skill '${item.name}' is missing an originPath.`);
    }
    ctx.applicableItemIds.push(item.id);
    const matchPath = findMatchingSkillPath(ctx.parsed, item.originPath, path.dirname(ctx.configPath));
    addEdit(
      ctx,
      { arrayTable: ['skills', 'config'], match: { path: matchPath }, key: 'enabled', op: 'set', value: enabled },
      `set skills.config path = ${formatTomlValue(matchPath)} enabled = ${enabled}`,
    );
  },
  hook: (ctx, item, enabled) => {
    if (isWmuxHook(item)) {
      throw new Error('Hooks owned by wmux are handled by the dispatcher.');
    }
    ctx.applicableItemIds.push(item.id);
    const stateKey = findHookStateKey(ctx.parsed, item, ctx.deps);
    addEdit(ctx, { table: ['hooks', 'state', stateKey], key: 'enabled', op: 'set', value: enabled }, `set hooks.state.${formatTomlKey(stateKey)}.enabled = ${enabled}`);
  },
  'builtin-tool': (ctx, item, enabled) => {
    if (item.name === 'web_search') {
      ctx.applicableItemIds.push(item.id);
      const wsValue = enabled ? 'live' : 'disabled';
      addEdit(ctx, { table: ['features'], key: 'web_search', op: 'set', value: wsValue }, `set features.web_search = "${wsValue}"`);
    } else if (['shell_tool', 'multi_agent', 'memories'].includes(item.name) || hasFeatureKey(ctx.parsed, item.name)) {
      ctx.applicableItemIds.push(item.id);
      addEdit(ctx, { table: ['features'], key: item.name, op: 'set', value: enabled }, `set features.${item.name} = ${enabled}`);
    } else {
      throw new Error(`Unsupported builtin tool: ${item.name}`);
    }
  },
};

export function planEdits(
  text: string,
  configPath: string,
  changes: ResolvedChange[],
  deps: WriterDeps,
): PlannedEditsResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = text.trim() ? (parseTomlText(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  const ctx: PlanContext = { parsed, configPath, deps, tomlEdits: [], edits: [], applicableItemIds: [] };
  // MCP tool changes are planned per server once every change is seen: they edit one list together.
  const toolChangesByParent = new Map<string, ResolvedChange[]>();

  for (const change of changes) {
    const { item, enabled } = change;
    if (item.kind === 'mcp-tool') {
      if (!item.parent) {
        throw new Error(`MCP tool '${item.name}' is missing a parent server.`);
      }
      toolChangesByParent.set(item.parent, [...(toolChangesByParent.get(item.parent) ?? []), change]);
      continue;
    }
    const planner = PLANNERS[item.kind];
    if (!planner) {
      throw new Error(`Unsupported item kind or setting: ${item.kind} (${item.name})`);
    }
    planner(ctx, item, enabled);
  }

  for (const [parent, parentChanges] of toolChangesByParent.entries()) {
    planToolLists(ctx, parent, parentChanges);
  }

  return { tomlEdits: ctx.tomlEdits, edits: ctx.edits, applicableItemIds: ctx.applicableItemIds };
}

/** The string entries of a list, or null when the value is not a list. */
function stringsIn(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : null;
}

function listsDiffer(a: string[], b: string[]): boolean {
  return a.length !== b.length || a.some((t, i) => t !== b[i]);
}

function serverConfig(parsed: Record<string, unknown>, server: string): Record<string, unknown> | undefined {
  const mcpServers = parsed.mcp_servers as Record<string, unknown> | undefined;
  return (mcpServers && typeof mcpServers === 'object')
    ? (mcpServers[server] as Record<string, unknown> | undefined)
    : undefined;
}

/** The server's tool lists after its changes. `enabled` stays null when the server has no `enabled_tools`. */
function applyToolChanges(
  disabledBefore: string[],
  enabledBefore: string[] | null,
  changes: ResolvedChange[],
): { disabled: string[]; enabled: string[] | null } {
  let disabled = [...disabledBefore];
  let enabled = enabledBefore !== null ? [...enabledBefore] : null;
  for (const change of changes) {
    const toolName = change.item.name;
    if (!change.enabled) {
      if (!disabled.includes(toolName)) disabled.push(toolName);
      if (enabled !== null) enabled = enabled.filter((t) => t !== toolName);
    } else {
      disabled = disabled.filter((t) => t !== toolName);
      if (enabled !== null && !enabled.includes(toolName)) enabled.push(toolName);
    }
  }
  return { disabled, enabled };
}

const quotedList = (list: string[]): string => `[${list.map((t) => JSON.stringify(t)).join(', ')}]`;

/**
 * Applies a server's tool changes to its `disabled_tools` and, when the server has one, `enabled_tools`,
 * and plans an edit for each list that changed. An emptied `disabled_tools` is deleted.
 */
function planToolLists(ctx: PlanContext, parent: string, parentChanges: ResolvedChange[]): void {
  const serverConf = serverConfig(ctx.parsed, parent);
  const hasDisabledKey = Array.isArray(serverConf?.disabled_tools);
  const disabledBefore = stringsIn(serverConf?.disabled_tools) ?? [];
  const enabledBefore = stringsIn(serverConf?.enabled_tools);
  for (const change of parentChanges) {
    ctx.applicableItemIds.push(change.item.id);
  }
  const { disabled, enabled } = applyToolChanges(disabledBefore, enabledBefore, parentChanges);

  const serverKey = formatTomlKey(parent);
  const disabledChanged = listsDiffer(disabled, disabledBefore) || (!hasDisabledKey && disabled.length > 0);
  if (disabled.length === 0 && hasDisabledKey) {
    addEdit(ctx, { table: ['mcp_servers', parent], key: 'disabled_tools', op: 'delete' }, `delete mcp_servers.${serverKey}.disabled_tools`);
  } else if (disabledChanged) {
    addEdit(ctx, { table: ['mcp_servers', parent], key: 'disabled_tools', op: 'set', value: disabled }, `set mcp_servers.${serverKey}.disabled_tools = ${quotedList(disabled)}`);
  }

  if (enabled !== null && enabledBefore !== null && listsDiffer(enabled, enabledBefore)) {
    addEdit(ctx, { table: ['mcp_servers', parent], key: 'enabled_tools', op: 'set', value: enabled }, `set mcp_servers.${serverKey}.enabled_tools = ${quotedList(enabled)}`);
  }
}
