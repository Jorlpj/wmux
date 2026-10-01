import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowAgyTrustFor, trustAgyForSpawningFolder, trustAgyWorkspace } from '../agyTrust';

let dir: string;
let settings: string;
const read = () => JSON.parse(fs.readFileSync(settings, 'utf8')) as Record<string, unknown>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agytrust-'));
  settings = path.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ agentMode: 'accept-edits', trustedWorkspaces: ['C:\\keep'] }, null, 2));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('agy trust for fan-out task folders', () => {
  it('adds the folder once and leaves every other setting alone', () => {
    const task = path.join(dir, 'wt', 'task-1');
    fs.mkdirSync(task, { recursive: true });
    expect(trustAgyWorkspace(task, { settingsPath: settings })).toEqual({ ok: true, added: true, pruned: 0 });
    expect(trustAgyWorkspace(task.toUpperCase(), { settingsPath: settings })).toMatchObject({ added: false });
    expect(read()).toEqual({ agentMode: 'accept-edits', trustedWorkspaces: ['C:\\keep', path.resolve(task)] });
  });

  it('prunes vanished task folders under the same root, never anything else', () => {
    const root = path.join(dir, 'wt');
    const gone = path.join(root, 'old-task');
    const live = path.join(root, 'task-2');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ trustedWorkspaces: ['C:\\keep', gone, path.join(dir, 'elsewhere-gone')] }));
    const r = trustAgyWorkspace(live, { settingsPath: settings, pruneUnder: root });
    expect(r).toEqual({ ok: true, added: true, pruned: 1 });
    expect(read().trustedWorkspaces).toEqual(['C:\\keep', path.join(dir, 'elsewhere-gone'), path.resolve(live)]);
  });

  it('fails soft on a missing or broken settings file', () => {
    expect(trustAgyWorkspace(dir, { settingsPath: path.join(dir, 'none.json') })).toMatchObject({ ok: false });
    fs.writeFileSync(settings, '{not json');
    expect(trustAgyWorkspace(dir, { settingsPath: settings })).toMatchObject({ ok: false });
    expect(fs.readFileSync(settings, 'utf8')).toBe('{not json');
  });

  it('trusts only a folder fan-out is spawning in right now', () => {
    const task = path.join(dir, 'wt', 'task-3');
    fs.mkdirSync(task, { recursive: true });
    expect(trustAgyForSpawningFolder(task, settings)).toMatchObject({ ok: false });
    const release = allowAgyTrustFor(task, path.join(dir, 'wt'));
    expect(trustAgyForSpawningFolder(task, settings)).toMatchObject({ ok: true, added: true });
    release();
    expect(trustAgyForSpawningFolder(path.join(dir, 'wt', 'other'), settings)).toMatchObject({ ok: false });
    expect(trustAgyForSpawningFolder(task, settings)).toMatchObject({ ok: false });
  });
});
