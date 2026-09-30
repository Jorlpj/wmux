import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSessionPath, handleRole, resolveRole } from '../role';
import { dataSuffix } from '../../../shared/constants';

const SESSION = JSON.stringify({
  orchestratorRoleBindings: {
    Builder: { agent: 'agy', model: 'gemini-3.8-flash-low', skipPermissions: true },
    Reviewer: { agent: 'codex', model: 'gpt-6-sol', effort: 'low' },
    Planner: { agent: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', args: '--verbose' },
    Tester: { agent: 'agy', model: 'bad model; rm -rf /' },
  },
});

async function run(args: string[], json = true, readFile: (p: string) => string = () => SESSION) {
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;
  await handleRole(args, json, {
    sessionPath: '/fake/session.json',
    readFile,
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    exit: (c) => {
      code = c;
    },
  });
  return { out, err, code };
}

describe('wmux role resolve', () => {
  it('prints exec-ready tokens for a bound agy role (effort from the model id)', async () => {
    const { out, code } = await run(['resolve', 'Builder']);
    expect(code).toBe(0);
    const r = JSON.parse(out[0]);
    expect(r).toMatchObject({ bound: true, agent: 'agy', model: 'gemini-3.8-flash-low', effort: 'low' });
    expect(r.argv).toEqual(['agy', '--model', 'gemini-3.8-flash-low', '--dangerously-skip-permissions']);
    expect(r.flags).toEqual(['--model', 'gemini-3.8-flash-low', '--dangerously-skip-permissions']);
  });

  it('uses each CLI grammar for effort and keeps extra args', async () => {
    expect(JSON.parse((await run(['resolve', 'Reviewer'])).out[0]).argv).toEqual([
      'codex', '--model', 'gpt-6-sol', '-c', 'model_reasoning_effort=low',
    ]);
    expect(JSON.parse((await run(['resolve', 'Planner'])).out[0]).argv).toEqual([
      'claude', '--model', 'claude-sonnet-5-5', '--effort', 'medium', '--verbose',
    ]);
  });

  it('drops an unsafe model through the app normalizer', async () => {
    const r = JSON.parse((await run(['resolve', 'Tester'])).out[0]);
    expect(r.model).toBeUndefined();
    expect(r.argv).toEqual(['agy']);
  });

  it('exits 2 for an unbound role and 1 for an unreadable file', async () => {
    const unbound = await run(['resolve', 'Nobody']);
    expect(unbound.code).toBe(2);
    expect(JSON.parse(unbound.out[0])).toEqual({ role: 'Nobody', bound: false });
    const missing = await run(['resolve', 'Builder'], true, () => {
      throw new Error('ENOENT');
    });
    expect(missing.code).toBe(1);
  });

  it('prints a plain command line without --json', async () => {
    expect((await run(['resolve', 'Reviewer'], false)).out[0]).toBe(
      'codex --model gpt-6-sol -c model_reasoning_effort=low',
    );
  });

  it('resolves the app userData session.json per platform', () => {
    expect(defaultSessionPath({ APPDATA: 'C:/Users/u/AppData/Roaming' }, 'win32')).toBe(
      path.join('C:/Users/u/AppData/Roaming', `wmux${dataSuffix()}`, 'session.json'),
    );
    expect(defaultSessionPath({ XDG_CONFIG_HOME: '/x' }, 'linux')).toBe(path.join('/x', `wmux${dataSuffix()}`, 'session.json'));
  });

  it('ignores a stale freshContext field in session.json', async () => {
    const session = JSON.stringify({
      orchestratorRoleBindings: { Builder: { agent: 'claude', effort: 'low', freshContext: true } },
    });
    const r = JSON.parse((await run(['resolve', 'Builder'], true, () => session)).out[0]);
    expect(r).not.toHaveProperty('freshContext');
    expect(r.argv).toEqual(['claude', '--effort', 'low']);
  });

  it('resolveRole reports fields without an agent', () => {
    expect(resolveRole('R', { model: 'm' })).toMatchObject({ role: 'R', model: 'm', argv: [], flags: [] });
  });
});
