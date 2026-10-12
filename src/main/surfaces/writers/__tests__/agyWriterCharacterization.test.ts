// Characterization of the Antigravity (agy) writer: planEditsForFile (every
// item kind, both directions, lists already in the file, skill names spelled
// three ways, nested or top-level hooks, unreadable files) and the writer's
// preview and apply end to end (several files, refused paths, a failing file
// rolled back, the store). Each scenario compares the WHOLE outcome with a
// recorded golden file in ./fixtures/agy-writer, as text so key order is
// pinned too. Temp paths become <home>/<project>; backups are counted.
//
// Re-record only on purpose: WMUX_RECORD_AGY_WRITER=1 npx vitest run <this file>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SurfaceItem, SurfaceKind, SurfaceSource } from '../../../../shared/tokenUsage/surfaceTypes';
import { planEditsForFile } from '../agy/edits';
import { createAgyWriter } from '../agyWriter';
import type { ResolvedChange, WriterDeps } from '../types';

const RECORD = process.env.WMUX_RECORD_AGY_WRITER === '1';
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'agy-writer');

let home: string;
let project: string;
let tokens: [string, string][];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-agy-char-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-agy-char-proj-'));
  fs.mkdirSync(path.join(home, '.gemini', 'config', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(project, '.agents', 'skills'), { recursive: true });
  tokens = [];
  for (const [dir, token] of [[home, '<home>'], [project, '<project>']] as const) {
    for (const p of new Set([dir, fs.realpathSync(dir), fs.realpathSync.native(dir)])) {
      tokens.push([p, token], [p.replace(/\\/g, '/'), token]);
    }
  }
  tokens.sort((a, b) => b[0].length - a[0].length);
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

function portable(value: string): string {
  let s = value;
  for (const [abs, token] of tokens) s = s.split(abs).join(token);
  return s.replace(/\\/g, '/');
}

function portableDeep(value: unknown): unknown {
  if (typeof value === 'string') return portable(value);
  if (Array.isArray(value)) return value.map(portableDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [portable(k), portableDeep(v)]));
  }
  return value;
}

function golden(name: string, actual: unknown): void {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const text = JSON.stringify(portableDeep(actual), null, 2) + '\n';
  if (RECORD) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, text);
    return;
  }
  expect(text).toBe(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
}

function deps(): WriterDeps {
  return {
    homeDir: home,
    projectDir: project,
    run: async () => '1.2.14',
    now: () => 1_700_000_000_000,
    surfacesStorePath: path.join(home, '.wmux', 'surfaces.json'),
  };
}

interface ItemOpts {
  parent?: string;
  source?: SurfaceSource;
  originPath?: string;
}

function item(kind: SurfaceKind, name: string, o: ItemOpts = {}): SurfaceItem {
  return {
    id: `agy:${kind}:${o.parent ?? ''}:${name}`,
    provider: 'agy',
    kind,
    name,
    parent: o.parent ?? null,
    source: o.source ?? 'user',
    enabled: null,
    effect: 'removes',
    toggleable: true,
    readOnlyReason: null,
    hookEvent: null,
    hookCost: null,
    descriptionChars: null,
    originPath: o.originPath ?? null,
    wmuxRequired: false,
  };
}

const off = (i: SurfaceItem): ResolvedChange => ({ item: i, enabled: false });
const on = (i: SurfaceItem): ResolvedChange => ({ item: i, enabled: true });

const cfg = (...parts: string[]) => path.join(home, '.gemini', 'config', ...parts);

/** A skill folder with a SKILL.md whose frontmatter name may differ from the folder. */
function skillDir(root: string, dir: string, frontmatterName?: string): string {
  const p = path.join(root, dir, 'SKILL.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, frontmatterName ? `---\nname: ${frontmatterName}\ndescription: d\n---\nbody\n` : 'no frontmatter\n');
  return p;
}

const plan = (filePath: string, changes: ResolvedChange[], text?: string | null) => {
  try {
    return planEditsForFile(filePath, changes, text);
  } catch (e) {
    return { thrown: (e as Error).message };
  }
};

describe('agy writer characterization', () => {
  it('plans MCP servers and tools, plugins and hooks', () => {
    const mcp = JSON.stringify({ mcpServers: { s: { command: 'x', disabledTools: ['old', 'keep'] }, t: { disabledTools: 'not a list' } } });
    golden('plan-mcp-plugins-hooks', {
      mcp: plan(cfg('mcp_config.json'), [
        off(item('mcp-server', 's')),
        on(item('mcp-server', 'u')),
        off(item('mcp-tool', 'new', { parent: 's' })),
        off(item('mcp-tool', 'old', { parent: 's' })),
        on(item('mcp-tool', 'keep', { parent: 's' })),
        off(item('mcp-tool', 'a', { parent: 't' })),
        on(item('mcp-tool', 'a', { parent: 't' })),
        on(item('mcp-tool', 'x')),
      ], mcp),
      lastToolBack: plan(cfg('mcp_config.json'), [on(item('mcp-tool', 'only', { parent: 's' }))], JSON.stringify({ mcpServers: { s: { disabledTools: ['only'] } } })),
      plugins: plan(cfg('config.json'), [
        off(item('plugin', 'by-name')),
        on(item('plugin', 'by-dir', { originPath: cfg('plugins', 'dir-name', 'plugin.json') })),
      ], '{}'),
      hooksNested: plan(cfg('hooks.json'), [off(item('hook', 'h1')), on(item('hook', 'h2'))], JSON.stringify({ hooks: { h1: {} } })),
      hooksTopLevel: plan(cfg('hooks.json'), [off(item('hook', 'h1')), on(item('hook', 'h2'))], JSON.stringify({ h1: {} })),
      hooksArray: plan(cfg('hooks.json'), [off(item('hook', 'h1'))], JSON.stringify({ hooks: [] })),
      unsupported: plan(cfg('x.json'), [off(item('builtin-tool', 'Bash'))], '{}'),
    });
  });

  it('plans skill excludes, matching every spelling of the skill', () => {
    const userSkills = cfg('skills');
    const fmDiffers = skillDir(userSkills, 'folder-name', 'Front Name');
    const noFm = skillDir(userSkills, 'plain');
    const exclude = JSON.stringify({ exclude: ['folder-name', 'Front Name', 'item-name', 7, null, 'other', 'folder-name'] });
    golden('plan-skills', {
      enableAllSpellings: plan(cfg('skills.json'), [on(item('skill', 'item-name', { originPath: fmDiffers }))], exclude),
      enableNothingMatched: plan(cfg('skills.json'), [on(item('skill', 'absent', { originPath: noFm }))], exclude),
      enableLastLeaves: plan(cfg('skills.json'), [on(item('skill', 'solo'))], JSON.stringify({ exclude: ['solo'] })),
      originGone: plan(cfg('skills.json'), [on(item('skill', 'gone', { originPath: cfg('skills', 'missing', 'SKILL.md') }))], JSON.stringify({ exclude: ['missing', 'x'] })),
      disableTwice: plan(cfg('skills.json'), [off(item('skill', 'a')), off(item('skill', 'b', { originPath: noFm })), off(item('skill', 'a'))], JSON.stringify({ exclude: 'not a list' })),
      disableThenEnable: plan(cfg('skills.json'), [off(item('skill', 'z')), on(item('skill', 'z'))], '{}'),
    });
  });

  it('reads the file when no snapshot is given, and treats unreadable JSON as empty', () => {
    fs.writeFileSync(cfg('mcp_config.json'), JSON.stringify({ mcpServers: { s: { disabledTools: ['t'] } } }));
    golden('plan-file-states', {
      fromDisk: plan(cfg('mcp_config.json'), [off(item('mcp-tool', 'u', { parent: 's' }))]),
      missingFile: plan(cfg('none.json'), [off(item('mcp-tool', 'u', { parent: 's' }))]),
      invalidSnapshot: plan(cfg('mcp_config.json'), [off(item('mcp-tool', 'u', { parent: 's' }))], '{ nope'),
      nullSnapshot: plan(cfg('mcp_config.json'), [off(item('mcp-tool', 'u', { parent: 's' }))], null),
      nullJson: plan(cfg('mcp_config.json'), [off(item('mcp-tool', 'u', { parent: 's' }))], 'null'),
    });
  });

  describe('createAgyWriter', () => {
    const files = () => {
      const out: Record<string, unknown> = {};
      for (const p of [cfg('mcp_config.json'), cfg('config.json'), cfg('skills.json'), cfg('hooks.json'), path.join(project, '.agents', 'skills.json')]) {
        let v: unknown = null;
        try { v = fs.statSync(p).isDirectory() ? '<directory>' : JSON.parse(fs.readFileSync(p, 'utf8')); } catch { v = null; }
        out[p] = v;
      }
      return out;
    };
    const store = () => {
      try { return JSON.parse(fs.readFileSync(deps().surfacesStorePath, 'utf8')); } catch { return null; }
    };
    const apply = async (changes: ResolvedChange[]) => {
      const ctx = { deps: deps(), inventory: {} as never, changes };
      try {
        const preview = await createAgyWriter().preview(ctx);
        const res = await createAgyWriter().apply(ctx);
        return { preview, result: { ...res, backups: res.backups.length }, files: files(), store: store() };
      } catch (e) {
        return { thrown: (e as Error).message, files: files(), store: store() };
      }
    };

    it('writes every file a set of changes lands in, and records the intents', async () => {
      fs.writeFileSync(cfg('mcp_config.json'), JSON.stringify({ mcpServers: { s: { command: 'x' } } }, null, 2));
      fs.writeFileSync(cfg('hooks.json'), JSON.stringify({ hooks: { h: { command: 'y' } } }, null, 2));
      const projSkill = skillDir(path.join(project, '.agents', 'skills'), 'proj-skill');
      golden('writer-apply-files', await apply([
        off(item('mcp-server', 's')),
        off(item('mcp-tool', 't', { parent: 's' })),
        off(item('plugin', 'p')),
        off(item('skill', 'user-skill')),
        off(item('skill', 'proj-skill', { source: 'project', originPath: projSkill })),
        off(item('hook', 'h')),
      ]));
    });

    it('refuses paths outside home and project, and rolls back when a file fails', async () => {
      const outside = path.join(os.tmpdir(), 'wmux-agy-char-outside', 'mcp.json');
      const onlyRefused = await apply([off(item('mcp-server', 's', { originPath: outside }))]);
      fs.writeFileSync(cfg('mcp_config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
      const mixed = await apply([off(item('mcp-server', 'ok')), off(item('mcp-server', 's', { originPath: outside }))]);
      fs.writeFileSync(cfg('mcp_config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
      fs.writeFileSync(cfg('config.json'), '{ not json');
      const secondInvalid = await apply([off(item('mcp-server', 'rolled-back')), off(item('plugin', 'p'))]);
      fs.rmSync(cfg('config.json'));
      fs.writeFileSync(cfg('mcp_config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
      fs.mkdirSync(cfg('config.json'));
      const secondFails = await apply([off(item('mcp-server', 'first')), off(item('plugin', 'p'))]);
      const nothing = await apply([]);
      const builtinSkill = await apply([off(item('skill', 'b', { source: 'builtin' }))]);
      golden('writer-apply-failures', { onlyRefused, mixed, secondInvalid, secondFails, nothing, builtinSkill });
    });
  });
});
