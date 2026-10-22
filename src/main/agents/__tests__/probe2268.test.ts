// Probe for #2268's side finding (issues agent, run 315, upstream 6a8214b07).
// Not a product test. Settles: is a data folder isQuotable refuses a silent
// "its pane could not be opened" on any OS, and what would
// cmdLaunchPathRefusal say for a macOS/Linux one if its win32 gate were lifted?
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isQuotable, withBotWorkerMergeGuard } from '../botWorkerMergeGuard';
import { cmdLaunchPathRefusal } from '../../../shared/promptFileArgument';
import { plainStartFailure } from '../../factory/botNotices';

const LINE = `claude --dangerously-skip-permissions "$(cat '/w/.wtask/prompt.md')"`;
const mcp = () => ({ mcpEntry: () => '/opt/wmux/mcp/index.js', registeredLevel: () => null, isolatedBridge: () => null });
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** pty:create's guard stage for a strict claude worker (no WSL, no
 *  connections), with `dir` as the data folder; the fan-out's card text. */
function start(dir: string): { ok: true } | { ok: false; error: string; card: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-probe-2268-cwd-'));
  made.push(cwd);
  try {
    withBotWorkerMergeGuard({ initialCommand: LINE, cwd, workspaceId: 'ws-task' }, { workspaceId: 'ws-task', strict: true }, { dir, ...mcp() });
    return { ok: true };
  } catch (err) {
    const error = `PTY_CREATE failed: ${String(err)}`;
    return { ok: false, error, card: plainStartFailure(error) };
  }
}

describe('#2268 side finding: data folder isQuotable refuses', () => {
  it('control: a plain data folder starts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-probe-2268-ab-'));
    made.push(dir);
    const r = start(dir);
    console.log(`plain ${JSON.stringify(dir)} -> ${JSON.stringify(r)}`);
    expect(r).toEqual({ ok: true });
  });

  for (const c of ["'", '$', '!', '%']) {
    it(`a data folder with ${c} is refused by the guard, shell-independently, and the card names no cause`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wmux-probe-2268-a${c}b-`));
      made.push(dir);
      const r = start(dir);
      console.log(`${c} ${JSON.stringify(dir)} -> ${JSON.stringify(r)}`);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toContain("the launch line cannot carry the worker's MCP config and rules");
      expect(r.card).toBe('its pane could not be opened');
    });
  }

  it('cmdLaunchPathRefusal on a POSIX data folder: the cmd "not a drive path" sentence for every folder, quotable or not', () => {
    for (const home of ["/home/o'brien", '/home/a$b', '/Users/a!b', '/Users/a%b', '/home/joe', '/Users/joe']) {
      const dataDir = `${home}/.wmux`;
      const quotable = isQuotable(`${dataDir}/factory/worker-settings/x.json`);
      const refusal = cmdLaunchPathRefusal(LINE, dataDir, true);
      console.log(`${dataDir}: isQuotable=${quotable} cmdLaunchPathRefusal=${JSON.stringify(refusal)}`);
      expect(quotable).toBe(!/['$!%]/.test(home));
      expect(refusal).toBe('Command Prompt cannot pass the wmux data folder (its path is not a drive path); set Default shell to PowerShell (Settings › Terminal) or move the folder');
    }
    // The Windows shape of the same folder is named (#2257's sentence).
    const win = cmdLaunchPathRefusal(LINE, "C:\\Users\\o'brien\\.wmux", true);
    console.log(`C:\\Users\\o'brien\\.wmux: cmdLaunchPathRefusal=${JSON.stringify(win)}`);
    expect(win).toMatch(/^Command Prompt cannot pass the wmux data folder \(its path contains "'"\), and no other shell can either/);
  });
});
