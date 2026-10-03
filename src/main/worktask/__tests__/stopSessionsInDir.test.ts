import { describe, expect, it, vi } from 'vitest';
import { stopSessionsInDir, type SessionsInDirPort } from '../stopSessionsInDir';

function port(sessions: Array<{ id: string; pid?: number; cwd?: string; spawnCwd?: string }>, platform: NodeJS.Platform) {
  const alive = new Set(sessions.map((s) => s.pid).filter((p): p is number => typeof p === 'number'));
  const p: SessionsInDirPort = {
    platform,
    listSessions: async () => sessions,
    destroySession: vi.fn(async (id: string) => {
      const pid = sessions.find((s) => s.id === id)?.pid;
      if (pid) setTimeout(() => alive.delete(pid), 0);
    }),
    isAlive: (pid) => alive.has(pid),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
  };
  return { p, alive };
}

describe('stopSessionsInDir', () => {
  it('stops sessions whose current or spawn directory is inside the worktree, and waits for them', async () => {
    const { p, alive } = port([
      { id: 'in-cwd', pid: 11, cwd: '/w/task-1/src' },
      { id: 'in-spawn', pid: 12, cwd: '/home/u', spawnCwd: '/w/task-1' },
      { id: 'sibling', pid: 13, cwd: '/w/task-10' },
      { id: 'outside', pid: 14, cwd: '/home/u' },
    ], 'linux');
    const stopped = await stopSessionsInDir('/w/task-1', p);
    expect(stopped.sort()).toEqual(['in-cwd', 'in-spawn']);
    expect(p.destroySession).toHaveBeenCalledTimes(2);
    expect(alive.has(11) || alive.has(12)).toBe(false);
    expect(alive.has(13) && alive.has(14)).toBe(true);
  });

  it('folds case only where the filesystem does', async () => {
    const sessions = [{ id: 's', pid: 1, cwd: 'C:\\W\\Task-1' }];
    expect(await stopSessionsInDir('c:/w/task-1', port(sessions, 'win32').p)).toEqual(['s']);
    expect(await stopSessionsInDir('/w/task-1', port([{ id: 's', cwd: '/W/Task-1' }], 'linux').p)).toEqual([]);
  });

  it('fails when a session cannot be destroyed', async () => {
    const { p } = port([{ id: 's', cwd: '/w/t' }], 'linux');
    p.destroySession = async () => { throw new Error('daemon offline'); };
    await expect(stopSessionsInDir('/w/t', p)).rejects.toThrow('daemon offline');
  });
});
