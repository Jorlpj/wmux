// ─── agy project trust for fan-out task folders ──────────────────────────────
//
// agy (Antigravity CLI) stops on "Do you trust the contents of this project?"
// in any folder that is not listed in its own settings file, even with
// --dangerously-skip-permissions, and trust is NOT inherited from a trusted
// parent. A fan-out worker lands in a brand-new worktree, so without help it
// waits forever on a screen only a keypress answers.
//
// Verified 2026-09-30, agy 1.2.14 on Windows: accepting the screen appends the
// exact folder to `trustedWorkspaces` in ~/.gemini/antigravity-cli/settings.json,
// and a folder pre-listed there launches straight into `-i "<prompt>"`.
//
// So fan-out lists exactly the task folder it is about to launch agy in — the
// same entry the operator's own keypress would write — and, on every call,
// drops entries for task folders under the same root that no longer exist, so
// removed worktrees do not accumulate. Nothing else in the file is touched.
// Only main writes here, and only for a folder FanOutService is spawning right
// now (see allowAgyTrustFor), never for a path the renderer names on its own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function agySettingsPath(home: string = os.homedir()): string {
  return path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
}

const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

export type AgyTrustResult =
  | { ok: true; added: boolean; pruned: number }
  | { ok: false; reason: string };

/** List `folder` in agy's trustedWorkspaces; prune missing folders under `pruneUnder`. */
export function trustAgyWorkspace(
  folder: string,
  opts: { settingsPath?: string; pruneUnder?: string } = {},
): AgyTrustResult {
  const file = opts.settingsPath ?? agySettingsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, reason: `agy settings not found at ${file} (run agy once to create it)` };
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    data = parsed as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `agy settings are not valid JSON: ${(err as Error).message}` };
  }
  const list = Array.isArray(data.trustedWorkspaces)
    ? data.trustedWorkspaces.filter((x): x is string => typeof x === 'string')
    : [];
  const root = opts.pruneUnder ? norm(opts.pruneUnder) + path.sep : undefined;
  const kept = list.filter((entry) => !(root && norm(entry).startsWith(root) && !fs.existsSync(entry)));
  const pruned = list.length - kept.length;
  const target = path.resolve(folder);
  const added = !kept.some((entry) => norm(entry) === norm(target));
  if (added) kept.push(target);
  if (!added && pruned === 0) return { ok: true, added: false, pruned: 0 };
  data.trustedWorkspaces = kept;
  const tmp = `${file}.wmux-${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    return { ok: false, reason: `could not write agy settings: ${(err as Error).message}` };
  }
  return { ok: true, added, pruned };
}

// Folders FanOutService is spawning a worker in right now. The renderer decides
// the final launcher (a role binding may turn the default agent into agy), so it
// asks main to trust the folder — and main only agrees for these.
const spawning = new Map<string, string | undefined>();

export function allowAgyTrustFor(folder: string, pruneUnder?: string): () => void {
  const key = norm(folder);
  spawning.set(key, pruneUnder);
  return () => {
    spawning.delete(key);
  };
}

export function trustAgyForSpawningFolder(folder: string, settingsPath?: string): AgyTrustResult {
  const key = norm(folder);
  if (!spawning.has(key)) return { ok: false, reason: 'not a folder fan-out is launching a worker in' };
  const pruneUnder = spawning.get(key);
  return trustAgyWorkspace(folder, {
    ...(settingsPath ? { settingsPath } : {}),
    ...(pruneUnder ? { pruneUnder } : {}),
  });
}
