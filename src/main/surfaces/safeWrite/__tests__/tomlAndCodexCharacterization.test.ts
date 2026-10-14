// Characterization of editTomlKeys (tables and array tables, set and delete,
// multi-line values, comments, quoting, new sections, verification failures)
// and the Codex writer's planEdits (every item kind, MCP tool lists, skill
// paths, hook state keys). Each scenario compares the WHOLE outcome with a
// recorded golden file in ./fixtures/toml-codex: the exact edited text (or the
// error), and the planned edits in order. Temp paths become <home>.
//
// Re-record only on purpose: WMUX_RECORD_TOML_CODEX=1 npx vitest run <this file>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SurfaceItem, SurfaceKind, SurfaceSource } from '../../../../shared/tokenUsage/surfaceTypes';
import { editTomlKeys, type TomlEdit } from '../tomlEdit';
import { planEdits } from '../../writers/codex/planEdits';
import type { ResolvedChange, WriterDeps } from '../../writers/types';

const RECORD = process.env.WMUX_RECORD_TOML_CODEX === '1';
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'toml-codex');

let home: string;
let tokens: [string, string][];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-toml-char-'));
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  tokens = [];
  for (const p of new Set([home, fs.realpathSync(home), fs.realpathSync.native(home)])) {
    tokens.push([p, '<home>'], [p.replace(/\\/g, '/'), '<home>'], [p.replace(/\\/g, '/').toLowerCase(), '<home>']);
    // Codex hook state keys lower-case the drive letter only.
    const fwd = p.replace(/\\/g, '/');
    tokens.push([/^[A-Za-z]:/.test(fwd) ? fwd[0].toLowerCase() + fwd.slice(1) : fwd, '<home>']);
  }
  tokens.sort((a, b) => b[0].length - a[0].length);
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function portable(value: string): string {
  // Separators first: a hook state key may be written with either one (see the hooks case), and a TOML basic
  // string doubles a Windows path's backslashes. Only then are the temp dirs masked.
  let s = value.replace(/\\\\/g, '/').replace(/\\/g, '/');
  for (const [abs, token] of tokens) s = s.split(abs.replace(/\\/g, '/')).join(token);
  // A Windows path holds backslashes, so TOML writes it single-quoted; the same path elsewhere is double-quoted.
  return s.replace(/'(<home>[^']*)'/g, '"$1"');
}

function portableDeep(value: unknown): unknown {
  if (typeof value === 'string') return portable(value);
  if (Array.isArray(value)) return value.map(portableDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [portable(k), portableDeep(v)]));
  }
  return value;
}

function golden(name: string, actual: unknown, opts: { portable?: boolean } = {}): void {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const value = opts.portable ? portableDeep(actual) : actual;
  // TOML parser messages carry positions that can change with the parser version; only the kind is pinned.
  const text = (JSON.stringify(value, null, 2) + '\n').replace(/(is not valid TOML): (?:[^"\\]|\\.)*/g, '$1: <parse error>');
  if (RECORD) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, text);
    return;
  }
  expect(text).toBe(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
}

const edit = (text: string, edits: TomlEdit[]) => {
  try {
    return editTomlKeys(text, edits);
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`;
  }
};

const set = (table: string[] | undefined, key: string, value: TomlEdit['value']): TomlEdit => ({ table, key, op: 'set', value });
const del = (table: string[] | undefined, key: string): TomlEdit => ({ table, key, op: 'delete' });
const aset = (arrayTable: string[], match: Record<string, string>, key: string, value: TomlEdit['value']): TomlEdit => ({ arrayTable, match, key, op: 'set', value });
const adel = (arrayTable: string[], match: Record<string, string>, key: string): TomlEdit => ({ arrayTable, match, key, op: 'delete' });

const CONFIG = [
  '# top comment',
  'model = "gpt-5"   # inline',
  'approval = "never"',
  '',
  '[mcp_servers.alpha]',
  '  command = "node"',
  '  disabled_tools = [',
  '    "a", # first',
  '    "b",',
  '  ]',
  '',
  '[mcp_servers."with.dot"]',
  'command = \'C:\\tools\\x.exe\'',
  '',
  '[[skills.config]]',
  'path = "/s/one"',
  'enabled = false',
  '',
  '[[skills.config]]',
  'path = "/s/two"',
  '',
  '[features]',
  'web_search = "live" # keep',
  '',
].join('\n');

describe('editTomlKeys characterization', () => {
  it('edits tables: root, nested, quoted, multi-line values, comments', () => {
    golden('toml-tables', {
      setRootExisting: edit(CONFIG, [set(undefined, 'model', 'o4')]),
      setRootNew: edit(CONFIG, [set(undefined, 'new_key', 3)]),
      deleteRoot: edit(CONFIG, [del(undefined, 'approval')]),
      setInIndentedTable: edit(CONFIG, [set(['mcp_servers', 'alpha'], 'enabled', false)]),
      replaceMultiLine: edit(CONFIG, [set(['mcp_servers', 'alpha'], 'disabled_tools', ['x'])]),
      deleteMultiLine: edit(CONFIG, [del(['mcp_servers', 'alpha'], 'disabled_tools')]),
      quotedTable: edit(CONFIG, [set(['mcp_servers', 'with.dot'], 'enabled', true)]),
      keepInlineComment: edit(CONFIG, [set(['features'], 'web_search', 'disabled')]),
      newTable: edit(CONFIG, [set(['plugins', 'my plugin'], 'enabled', true)]),
      newTableBackslashKey: edit(CONFIG, [set(['hooks', 'state', 'C:\\h.json:stop:0:0'], 'enabled', false)]),
      deleteMissingTable: edit(CONFIG, [del(['nope'], 'x')]),
      deleteMissingKey: edit(CONFIG, [del(['features'], 'nope')]),
      values: edit('', [set(undefined, 'b', true), set(undefined, 'n', -1.5), set(undefined, 's', 'with "quote"'), set(undefined, 'w', 'C:\\path'), set(undefined, 'l', ['a', 'C:\\b']), set(undefined, 'nl', 'two\nlines')]),
      emptyText: edit('', [set(['t'], 'k', 1)]),
      blankText: edit('\n\n', [set(['t'], 'k', 1)]),
      noEdits: edit('a = 1', []),
      crlf: edit('a = 1\r\n[t]\r\nk = 1\r\n', [set(['t'], 'k', 2), set(['u'], 'k', 3)]),
      noFinalNewline: edit('a = 1', [set(undefined, 'b', 2)]),
      trailingBlankLines: edit('a = 1\n\n\n', [set(['t'], 'k', 1)]),
      insertBeforeBlank: edit('[t]\n  a = 1\n\n[u]\nb = 2\n', [set(['t'], 'c', 3)]),
    });
  });

  it('edits array tables by match, appends entries, and refuses what it cannot verify', () => {
    golden('toml-array-tables', {
      setExistingKey: edit(CONFIG, [aset(['skills', 'config'], { path: '/s/one' }, 'enabled', true)]),
      setNewKeyInEntry: edit(CONFIG, [aset(['skills', 'config'], { path: '/s/two' }, 'enabled', false)]),
      deleteKey: edit(CONFIG, [adel(['skills', 'config'], { path: '/s/one' }, 'enabled')]),
      deleteNoEntry: edit(CONFIG, [adel(['skills', 'config'], { path: '/s/zzz' }, 'enabled')]),
      deleteNoKey: edit(CONFIG, [adel(['skills', 'config'], { path: '/s/two' }, 'enabled')]),
      appendAfterLastEntry: edit(CONFIG, [aset(['skills', 'config'], { path: '/s/three' }, 'enabled', false)]),
      firstEntryAtEnd: edit('a = 1\n\n', [aset(['skills', 'config'], { path: 'C:\\s\\x' }, 'enabled', false)]),
      firstEntryEmpty: edit('', [aset(['skills', 'config'], { path: '/x', name: 'n' }, 'enabled', true)]),
      matchKeyIsEditKey: edit('', [aset(['a'], { k: 'v' }, 'k', 'v')]),
      matchByNumber: edit('[[a]]\nid = 2\nx = 1\n', [aset(['a'], { id: '2' }, 'x', 5)]),
      protectedKey: edit(CONFIG, [set(['projects', 'x'], 'trusted_hash', 'h')]),
      invalidOriginal: edit('a = = 1', [set(undefined, 'b', 1)]),
      setUnderArrayTablePath: edit('[[t]]\nk = 1\n', [set(['t'], 'k', 2)]),
      tableWhereScalar: edit('t = 1\n', [set(['t'], 'k', 2)]),
      deleteThroughScalar: edit('t = 1\n', [del(['t', 'u'], 'k')]),
      arrayDeleteThroughScalar: edit('a = 1\n', [adel(['a', 'b'], { k: 'v' }, 'x')]),
      arrayWhereTable: edit('[a]\nb = 1\n', [aset(['a'], { k: 'v' }, 'x', 1)]),
      dottedKeyLine: edit('a.b = 1\n', [set(['a'], 'b', 2)]),
    });
  });
});

describe('Codex planEdits characterization', () => {
  const configPath = () => path.join(home, '.codex', 'config.toml');
  const deps = (): WriterDeps => ({
    homeDir: home,
    run: async () => '0.130.0',
    now: () => 1_700_000_000_000,
    surfacesStorePath: path.join(home, '.wmux', 'surfaces.json'),
  });
  function item(kind: SurfaceKind, name: string, o: { parent?: string; source?: SurfaceSource; originPath?: string; hookEvent?: string; wmuxRequired?: boolean } = {}): SurfaceItem {
    return {
      id: `codex:${kind}:${o.parent ?? ''}:${name}`,
      provider: 'codex',
      kind,
      name,
      parent: o.parent ?? null,
      source: o.source ?? 'user',
      enabled: null,
      effect: 'removes',
      toggleable: true,
      readOnlyReason: null,
      hookEvent: o.hookEvent ?? null,
      hookCost: null,
      descriptionChars: null,
      originPath: o.originPath ?? null,
      wmuxRequired: o.wmuxRequired ?? false,
    };
  }
  const off = (i: SurfaceItem): ResolvedChange => ({ item: i, enabled: false });
  const on = (i: SurfaceItem): ResolvedChange => ({ item: i, enabled: true });
  const plan = (text: string, changes: ResolvedChange[]) => {
    try {
      return planEdits(text, configPath(), changes, deps());
    } catch (e) {
      return { thrown: (e as Error).message };
    }
  };

  it('plans servers, plugins, features and MCP tool lists', () => {
    const text = [
      '[mcp_servers.s]',
      'disabled_tools = ["old", "keep", 3]',
      'enabled_tools = ["keep", "x"]',
      '[mcp_servers.t]',
      'disabled_tools = ["only"]',
      '[mcp_servers.u]',
      'command = "x"',
      '[features]',
      'custom_flag = true',
      '',
    ].join('\n');
    golden('codex-plan-kinds', {
      mixed: plan(text, [
        off(item('mcp-server', 'srv one')),
        on(item('mcp-server', 's')),
        off(item('plugin', 'p@m')),
        off(item('builtin-tool', 'web_search')),
        on(item('builtin-tool', 'web_search')),
        off(item('builtin-tool', 'shell_tool')),
        on(item('builtin-tool', 'custom_flag')),
        off(item('mcp-tool', 'new', { parent: 's' })),
        on(item('mcp-tool', 'old', { parent: 's' })),
        off(item('mcp-tool', 'keep', { parent: 's' })),
        on(item('mcp-tool', 'only', { parent: 't' })),
        off(item('mcp-tool', 'a', { parent: 'u' })),
        on(item('mcp-tool', 'b', { parent: 'u' })),
        on(item('mcp-tool', 'never-listed', { parent: 'v' })),
      ]),
      sameAsBefore: plan('[mcp_servers.s]\ndisabled_tools = ["a"]\nenabled_tools = ["b"]\n', [off(item('mcp-tool', 'a', { parent: 's' })), on(item('mcp-tool', 'b', { parent: 's' }))]),
      emptyListKept: plan('[mcp_servers.s]\ndisabled_tools = []\n', [on(item('mcp-tool', 'z', { parent: 's' }))]),
      invalidToml: plan('[[[', [off(item('builtin-tool', 'memories'))]),
      unknownBuiltin: plan('', [off(item('builtin-tool', 'nope'))]),
      unsupportedKind: plan('', [off(item('context-setting', 'x'))]),
      toolWithoutParent: plan('', [off(item('mcp-tool', 'x'))]),
    }, { portable: true });
  });

  it('plans skills by the path the config already uses, and hooks by their state key', () => {
    const skillsDir = path.join(home, '.codex', 'skills');
    const absSkill = path.join(skillsDir, 'abs', 'SKILL.md');
    const relSkill = path.join(skillsDir, 'rel', 'SKILL.md');
    const text = [
      '[[skills.config]]',
      `path = ${JSON.stringify(absSkill)}`,
      'enabled = false',
      '[[skills.config]]',
      'path = "skills/rel/SKILL.md"',
      '',
    ].join('\n');
    const hooksPath = path.join(home, '.codex', 'hooks.json');
    fs.writeFileSync(hooksPath, JSON.stringify({ hooks: { first: { event: 'PreToolUse' }, second: { type: 'SessionStart' }, third: {}, bad: 'x' } }));
    const flat = path.join(home, '.codex', 'flat.json');
    fs.writeFileSync(flat, JSON.stringify({ only: { event: 'Stop' } }));
    // Written with the other separator, as another tool might; the writer must reuse it rather than add a second key.
    const otherSeparators = hooksPath.includes('\\') ? hooksPath.replace(/\\/g, '/') : hooksPath.replace(/\//g, '\\');
    const stateKey = `${otherSeparators}:pre_tool_use:0:0`;
    golden('codex-plan-skills-hooks', {
      skills: plan(text, [
        on(item('skill', 'abs', { originPath: absSkill })),
        on(item('skill', 'rel', { originPath: relSkill })),
        off(item('skill', 'new', { originPath: path.join(skillsDir, 'new', 'SKILL.md') })),
      ]),
      skillsDottedKey: plan(`"skills.config" = [{ path = ${JSON.stringify(relSkill)} }]\n`, [on(item('skill', 'rel', { originPath: relSkill }))]),
      skillWithoutOrigin: plan('', [on(item('skill', 'x'))]),
      hooks: plan(`[hooks.state.${JSON.stringify(stateKey)}]\nenabled = true\n`, [
        off(item('hook', 'first')),
        on(item('hook', 'second')),
        off(item('hook', 'third', { hookEvent: 'Stop' })),
        on(item('hook', 'only', { originPath: flat })),
      ]),
      reusesExistingStateKey: (() => {
        const r = planEdits(`[hooks.state.${JSON.stringify(stateKey)}]\nenabled = true\n`, configPath(), [off(item('hook', 'first'))], deps());
        return (r.tomlEdits[0] as { table: string[] }).table[2] === stateKey;
      })(),
      hookNoEvent: plan('', [off(item('hook', 'third'))]),
      hookBadConfig: plan('', [off(item('hook', 'bad'))]),
      hookMissing: plan('', [off(item('hook', 'nope'))]),
      hookFileMissing: plan('', [off(item('hook', 'x', { originPath: path.join(home, 'none.json') }))]),
      hookFileInvalid: (() => { fs.writeFileSync(path.join(home, 'bad.json'), '{'); return plan('', [off(item('hook', 'x', { originPath: path.join(home, 'bad.json') }))]); })(),
      hookFileArray: (() => { fs.writeFileSync(path.join(home, 'arr.json'), '[]'); return plan('', [off(item('hook', 'x', { originPath: path.join(home, 'arr.json') }))]); })(),
      wmuxHooks: [
        plan('', [off(item('hook', 'wmux-stop'))]),
        plan('', [off(item('hook', 'codex-notify'))]),
        plan('', [off(item('hook', 'x', { source: 'wmux' }))]),
        plan('', [off(item('hook', 'y', { wmuxRequired: true }))]),
      ],
    }, { portable: true });
  });
});
