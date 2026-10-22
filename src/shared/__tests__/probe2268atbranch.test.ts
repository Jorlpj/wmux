// Probe for #2268 (issues agent, run 465, maintainer branch
// fix/2268-powershell-data-folder-reason at e5b2344c3). Not a product test.
// Settles: does the new early refusal (dataDirNoShellRefusal) refuse exactly
// the data folders whose guard files isQuotable refused before, so no folder
// that started a worker before is now refused?
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isQuotable } from '../botWorkerGuard';
import { dataDirNoShellRefusal } from '../promptFileArgument';

const BS = String.fromCharCode(92);
const win = (...parts: string[]) => parts.join(BS);
const WIN = [
  ...['joe', "o'brien", 'a$b', 'a!b', 'a%b', 'a`b', 'a&b', 'a^b', 'a b', 'a(b)', 'jöe'].map((u) => win('C:', 'Users', u, '.wmux')),
  win('', '', 'server', 'share', 'joe', '.wmux'),
  win('D:', '.wmux-issues'),
];
const POSIX = ['/home/joe/.wmux', "/home/o'brien/.wmux", '/home/a$b/.wmux', '/Users/a!b/.wmux', '/Users/a%b/.wmux', '/home/a"b/.wmux',
  '/home/a`b/.wmux', '/home/a b/.wmux', `/home/a${BS}b/.wmux`, `/home/a${BS}${BS}b/.wmux`, '/home/a&b/.wmux'];

function check(p: typeof path.win32, dir: string): void {
  const files = ['worker-settings', 'worker-mcp'].map((f) => p.join(dir, 'factory', f, 'abc.json'));
  const before = files.every(isQuotable);
  const now = dataDirNoShellRefusal(dir);
  console.log(`${JSON.stringify(dir)}: isQuotable(files)=${before} refusal=${JSON.stringify(now)}`);
  expect(now === null).toBe(before);
}

describe('#2268 branch: the early refusal matches isQuotable on the guard files', () => {
  it('Windows-shaped data folders', () => { for (const d of WIN) check(path.win32, d); });
  it('POSIX-shaped data folders', () => { for (const d of POSIX) check(path.posix, d); });
});
