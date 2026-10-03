// Stop the panes running inside a task worktree before it is removed.
//
// A shell or agent whose working directory is inside the worktree holds file
// handles, and on Windows `git worktree remove` then deregisters the worktree
// but leaves part of the folder behind. Task panes live in the daemon, so the
// sessions are found and destroyed there, and the removal waits until their
// processes are gone.

import { normalizeWorktreePath } from '../../shared/workTask';

export interface SessionsInDirPort {
  listSessions(): Promise<Array<{ id: string; pid?: number; cwd?: string; spawnCwd?: string }>>;
  destroySession(id: string): Promise<void>;
  /** Whether `pid` is still running. */
  isAlive(pid: number): boolean;
  sleep(ms: number): Promise<void>;
  platform?: NodeJS.Platform;
}

const EXIT_WAIT_MS = 5000;
const EXIT_POLL_MS = 100;

function isInside(dir: string, root: string, platform: NodeJS.Platform): boolean {
  const d = normalizeWorktreePath(dir, platform);
  const r = normalizeWorktreePath(root, platform);
  return d === r || d.startsWith(r + '/');
}

/**
 * Destroy every daemon session whose current or spawn directory is `dir` or
 * inside it, then wait (up to 5 s) for their processes to exit. Returns the
 * ids it destroyed. Throws when a session could not be destroyed, so the
 * caller does not remove a worktree a pane still holds.
 */
export async function stopSessionsInDir(dir: string, port: SessionsInDirPort): Promise<string[]> {
  const platform = port.platform ?? process.platform;
  const sessions = await port.listSessions();
  const inside = sessions.filter((s) =>
    [s.cwd, s.spawnCwd].some((c) => typeof c === 'string' && c.length > 0 && isInside(c, dir, platform)));
  for (const s of inside) await port.destroySession(s.id);

  const pids = inside.map((s) => s.pid).filter((p): p is number => typeof p === 'number' && p > 0);
  for (let waited = 0; waited < EXIT_WAIT_MS && pids.some((p) => port.isAlive(p)); waited += EXIT_POLL_MS) {
    await port.sleep(EXIT_POLL_MS);
  }
  return inside.map((s) => s.id);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
