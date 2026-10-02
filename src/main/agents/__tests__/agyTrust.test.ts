import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGY_TRUST_DISABLED_REASON, allowAgyTrustFor, trustAgyForSpawningFolder, trustAgyWorkspace } from '../agyTrust';
import { getFanoutWorkerPolicyPath, setFanoutTrustAgyFolders } from '../../worktask/fanoutWorkerPolicy';

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
    const on = { settingsPath: settings, enabled: true };
    expect(trustAgyForSpawningFolder(task, on)).toMatchObject({ ok: false });
    const release = allowAgyTrustFor(task, path.join(dir, 'wt'));
    expect(trustAgyForSpawningFolder(task, on)).toMatchObject({ ok: true, added: true });
    release();
    expect(trustAgyForSpawningFolder(path.join(dir, 'wt', 'other'), on)).toMatchObject({ ok: false });
    expect(trustAgyForSpawningFolder(task, on)).toMatchObject({ ok: false });
  });
});

describe('agy trust is opt-in', () => {
  it('writes nothing while the setting is off, and says so', () => {
    const task = path.join(dir, 'wt', 'task-off');
    fs.mkdirSync(task, { recursive: true });
    const before = fs.readFileSync(settings, 'utf8');
    const release = allowAgyTrustFor(task);
    try {
      expect(trustAgyForSpawningFolder(task, { settingsPath: settings, enabled: false })).toEqual({
        ok: false,
        reason: AGY_TRUST_DISABLED_REASON,
        disabled: true,
      });
      // No `enabled` given: read from the (isolated) policy file, which is off by default.
      fs.rmSync(getFanoutWorkerPolicyPath(), { force: true });
      expect(trustAgyForSpawningFolder(task, { settingsPath: settings })).toMatchObject({ ok: false, disabled: true });
    } finally {
      release();
    }
    expect(fs.readFileSync(settings, 'utf8')).toBe(before);
  });

  it('follows the policy file when it is turned on', async () => {
    const task = path.join(dir, 'wt', 'task-on');
    fs.mkdirSync(task, { recursive: true });
    await setFanoutTrustAgyFolders(true);
    const release = allowAgyTrustFor(task);
    try {
      expect(trustAgyForSpawningFolder(task, { settingsPath: settings })).toMatchObject({ ok: true, added: true });
    } finally {
      release();
      fs.rmSync(getFanoutWorkerPolicyPath(), { force: true });
    }
  });
});

describe('agy trust write safety', () => {
  const task = () => {
    const t = path.join(dir, 'wt', 'task-w');
    fs.mkdirSync(t, { recursive: true });
    return t;
  };

  it('does not write while another wmux process holds the lock', () => {
    const before = fs.readFileSync(settings, 'utf8');
    fs.writeFileSync(`${settings}.wmux.lock`, '12345');
    const r = trustAgyWorkspace(task(), { settingsPath: settings }, { lockAttempts: 2, sleep: () => undefined });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/locked/);
    expect(fs.readFileSync(settings, 'utf8')).toBe(before);
    expect(fs.existsSync(`${settings}.wmux.lock`)).toBe(true);
  });

  it('breaks a stale lock left by a dead writer, and releases its own', () => {
    const lock = `${settings}.wmux.lock`;
    fs.writeFileSync(lock, '12345');
    const old = (Date.now() - 60_000) / 1000;
    fs.utimesSync(lock, old, old);
    expect(trustAgyWorkspace(task(), { settingsPath: settings }, { sleep: () => undefined })).toMatchObject({ ok: true, added: true });
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('redoes the edit on top of a write agy made meanwhile instead of overwriting it', () => {
    const t = task();
    let reads = 0;
    const readFile = (p: string): string => {
      reads += 1;
      // The re-read before the first commit sees agy's own concurrent write.
      if (reads === 3) {
        fs.writeFileSync(p, JSON.stringify({ agentMode: 'plan', trustedWorkspaces: ['C:\\keep', 'C:\\agy-added'] }, null, 2));
      }
      return fs.readFileSync(p, 'utf8');
    };
    expect(trustAgyWorkspace(t, { settingsPath: settings }, { readFile })).toMatchObject({ ok: true, added: true });
    expect(read()).toEqual({ agentMode: 'plan', trustedWorkspaces: ['C:\\keep', 'C:\\agy-added', path.resolve(t)] });
  });

  it('gives up without writing when the file keeps changing', () => {
    let n = 0;
    const readFile = (): string => JSON.stringify({ trustedWorkspaces: [], n: n++ });
    const before = fs.readFileSync(settings, 'utf8');
    expect(trustAgyWorkspace(task(), { settingsPath: settings }, { readFile })).toMatchObject({ ok: false });
    expect(fs.readFileSync(settings, 'utf8')).toBe(before);
  });

  it('writes through a symlinked settings file and keeps the link', (ctx) => {
    const real = path.join(dir, 'dotfiles', 'settings.json');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, JSON.stringify({ trustedWorkspaces: [] }));
    const link = path.join(dir, 'linked-settings.json');
    try {
      fs.symlinkSync(real, link);
    } catch {
      ctx.skip(); // no symlink privilege on this machine (Windows without developer mode)
      return;
    }
    const t = task();
    expect(trustAgyWorkspace(t, { settingsPath: link })).toMatchObject({ ok: true, added: true });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(real, 'utf8')).trustedWorkspaces).toEqual([path.resolve(t)]);
  });
});
