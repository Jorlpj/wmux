import * as fs from 'node:fs';
import type { JsonEdit } from '../../safeWrite';
import type { SurfaceFileEdit, SurfaceItem, SurfaceKind } from '../../../../shared/tokenUsage/surfaceTypes';
import { parseSkillFrontmatter } from '../../inventory/helpers';
import type { ResolvedChange } from '../types';
import { getPluginDirName, getSkillDirName } from './paths';

export interface PlannedFileEdits {
  filePath: string;
  jsonEdits: JsonEdit[];
  previewEdits: SurfaceFileEdit[];
  itemIds: string[];
}

/** One file's plan as it is built: later changes to the same list see the earlier ones. */
interface PlanState {
  filePath: string;
  parsed: any;
  disabledToolsByServer: Map<string, unknown[]>;
  skillExclude: unknown[] | null;
  jsonEdits: JsonEdit[];
  previewEdits: SurfaceFileEdit[];
}

type ItemPlanner = (state: PlanState, item: SurfaceItem, enabled: boolean) => void;

/**
 * Plans the JSON edits for one file. Pass the snapshot's text so the plan and the conflict check in
 * applyConfigEdit see the same content; without it the file is read here (preview only).
 */
export function planEditsForFile(
  filePath: string,
  changes: ResolvedChange[],
  snapshotText?: string | null,
): PlannedFileEdits {
  const state: PlanState = {
    filePath,
    parsed: readParsed(filePath, snapshotText),
    disabledToolsByServer: new Map(),
    skillExclude: null,
    jsonEdits: [],
    previewEdits: [],
  };
  const itemIds: string[] = [];

  for (const { item, enabled } of changes) {
    itemIds.push(item.id);
    const planner = PLANNERS[item.kind];
    if (!planner) {
      throw new Error(`Unsupported item kind: ${item.kind}`);
    }
    planner(state, item, enabled);
  }

  return { filePath, jsonEdits: state.jsonEdits, previewEdits: state.previewEdits, itemIds };
}

/** The file's JSON, or null when it is missing, empty or does not parse. */
function readParsed(filePath: string, snapshotText: string | null | undefined): unknown {
  try {
    const text =
      snapshotText !== undefined ? snapshotText : fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    return text !== null ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function addEdit(state: PlanState, edit: JsonEdit, summary: string): void {
  state.jsonEdits.push(edit);
  state.previewEdits.push({ path: state.filePath, summary });
}

const PLANNERS: Partial<Record<SurfaceKind, ItemPlanner>> = {
  'mcp-server': (state, item, enabled) => {
    if (!enabled) {
      addEdit(state, { op: 'set', path: ['mcpServers', item.name, 'disabled'], value: true }, `set mcpServers."${item.name}".disabled = true`);
    } else {
      addEdit(state, { op: 'delete', path: ['mcpServers', item.name, 'disabled'] }, `delete mcpServers."${item.name}".disabled`);
    }
  },
  'mcp-tool': planMcpTool,
  plugin: (state, item, enabled) => {
    const dirName = getPluginDirName(item);
    addEdit(state, { op: 'set', path: ['plugins', dirName, 'enabled'], value: enabled }, `set plugins."${dirName}".enabled = ${enabled}`);
  },
  skill: planSkill,
  hook: (state, item, enabled) => {
    const isNestedInHooks =
      state.parsed?.hooks &&
      typeof state.parsed.hooks === 'object' &&
      !Array.isArray(state.parsed.hooks);
    const keyPath = isNestedInHooks ? ['hooks', item.name, 'enabled'] : [item.name, 'enabled'];
    const summaryPrefix = isNestedInHooks ? `hooks.${item.name}` : item.name;
    if (!enabled) {
      addEdit(state, { op: 'set', path: keyPath, value: false }, `set ${summaryPrefix}.enabled = false`);
    } else {
      addEdit(state, { op: 'delete', path: keyPath }, `delete ${summaryPrefix}.enabled`);
    }
  },
};

/** The server's disabledTools as planned so far, starting from the file. */
function disabledToolsOf(state: PlanState, server: string): unknown[] {
  if (!state.disabledToolsByServer.has(server)) {
    const raw = state.parsed?.mcpServers?.[server]?.disabledTools;
    state.disabledToolsByServer.set(server, Array.isArray(raw) ? [...raw] : []);
  }
  return state.disabledToolsByServer.get(server) ?? [];
}

function planMcpTool(state: PlanState, item: SurfaceItem, enabled: boolean): void {
  const server = item.parent ?? '';
  const list = disabledToolsOf(state, server);
  if (!enabled) {
    if (!list.includes(item.name)) {
      list.push(item.name);
    }
    addEdit(state, { op: 'set', path: ['mcpServers', server, 'disabledTools'], value: [...list] }, `add "${item.name}" to mcpServers."${server}".disabledTools`);
    return;
  }
  const filtered = list.filter((t) => t !== item.name);
  state.disabledToolsByServer.set(server, filtered);
  const edit: JsonEdit =
    filtered.length === 0
      ? { op: 'delete', path: ['mcpServers', server, 'disabledTools'] }
      : { op: 'set', path: ['mcpServers', server, 'disabledTools'], value: [...filtered] };
  addEdit(state, edit, `remove "${item.name}" from mcpServers."${server}".disabledTools`);
}

function planSkill(state: PlanState, item: SurfaceItem, enabled: boolean): void {
  const skillDirName = getSkillDirName(item);
  if (state.skillExclude === null) {
    const raw = state.parsed?.exclude;
    state.skillExclude = Array.isArray(raw) ? [...raw] : [];
  }
  const exclude = state.skillExclude;

  if (!enabled) {
    if (!exclude.includes(skillDirName)) {
      exclude.push(skillDirName);
    }
    addEdit(state, { op: 'set', path: ['exclude'], value: [...exclude] }, `add "${skillDirName}" to exclude`);
    return;
  }

  // The exclude list may name the skill by its folder, its listed name or its frontmatter name.
  const spellings = new Set<string>([skillDirName, item.name]);
  const fmName = frontmatterName(item.originPath);
  if (fmName) {
    spellings.add(fmName);
  }
  const matching = exclude.filter((x): x is string => typeof x === 'string' && spellings.has(x));
  state.skillExclude = exclude.filter((x) => typeof x !== 'string' || !spellings.has(x));
  const edit: JsonEdit =
    state.skillExclude.length === 0
      ? { op: 'delete', path: ['exclude'] }
      : { op: 'set', path: ['exclude'], value: [...state.skillExclude] };
  const uniqueMatching = Array.from(new Set(matching));
  const removedSummary = uniqueMatching.length > 0 ? uniqueMatching.join('", "') : skillDirName;
  addEdit(state, edit, `remove "${removedSummary}" from exclude`);
}

function frontmatterName(originPath: string | null): string | undefined {
  if (!originPath) return undefined;
  try {
    if (fs.existsSync(originPath)) {
      return parseSkillFrontmatter(fs.readFileSync(originPath, 'utf8')).name || undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}
