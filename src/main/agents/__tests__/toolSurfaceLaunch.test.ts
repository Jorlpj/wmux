import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyWmuxToolsToCommand, isWmuxToolsHint } from '../toolSurfaceLaunch';
import { codexConfigPath, codexHasWmuxServer } from '../../../shared/mcpRegistration';

const mcpDir = path.join('C:', 'u', '.wmux', 'mcp');
const entry = path.join(mcpDir, 'index.js');

function run(command: string, tools: 'full' | 'core' | 'role', role?: string, exists = true, codexRegistered = true) {
  const written: Record<string, string> = {};
  const logs: string[] = [];
  const out = applyWmuxToolsToCommand(command, { tools, ...(role ? { role } : {}) }, {
    mcpDir,
    exists: () => exists,
    writeFile: (p, d) => { written[p] = d; },
    codexHasWmuxServer: () => codexRegistered,
    log: (line) => logs.push(line),
  });
  return { out, written, logs };
}

describe('wmux tool level on a role-bound launch line', () => {
  it('claude gets a config FILE (no JSON on the shell line) naming the surface', () => {
    const { out, written } = run('claude --model claude-sonnet-5-5', 'role', 'Planner');
    const file = path.join(mcpDir, 'surface-role-planner.json');
    expect(out).toBe(`claude --mcp-config "${file}" --model claude-sonnet-5-5`);
    expect(JSON.parse(written[file])).toEqual({ mcpServers: { wmux: { command: 'node', args: [entry, '--role=Planner'] } } });
  });

  it('codex gets TOML literal strings inside one double-quoted -c', () => {
    expect(run('codex --model gpt-6-sol', 'core', 'Reviewer').out).toBe(
      `codex -c "mcp_servers.wmux.args=['${entry}','--core']" --model gpt-6-sol`,
    );
    expect(run('codex', 'role', 'Tester').out).toBe('codex -c mcp_servers.wmux.enabled=false');
    expect(run('codex', 'full', 'Reviewer').out).toBe(`codex -c "mcp_servers.wmux.args=['${entry}']"`);
  });

  it('leaves agy, unknown launchers, hand-configured lines and a missing bundle alone', () => {
    expect(run('agy -i "x"', 'role', 'Builder').out).toBe('agy -i "x"');
    expect(run('npm test', 'core').out).toBe('npm test');
    expect(run('claude --mcp-config my.json', 'role', 'Planner').out).toBe('claude --mcp-config my.json');
    expect(run('claude', 'core', undefined, false).out).toBe('claude');
    expect(run('claude', 'role', 'Custom').out).toBe('claude');
  });

  it('launches codex unchanged (and says why) when codex has no wmux server registered', () => {
    // codex-cli 0.158 aborts on either override without a registered server:
    // "invalid transport in `mcp_servers.wmux`".
    for (const [tools, role] of [['core', 'Reviewer'], ['role', 'Tester'], ['full', 'Reviewer']] as const) {
      const { out, logs } = run('codex --model gpt-6-sol', tools, role, true, false);
      expect(out).toBe('codex --model gpt-6-sol');
      expect(logs.join(' ')).toMatch(/codex has no wmux MCP server registered/);
    }
    // claude is unaffected: its --mcp-config file carries the whole server entry.
    expect(run('claude', 'core', undefined, true, false).out).toMatch(/^claude --mcp-config /);
  });

  it('validates the hint shape', () => {
    expect(isWmuxToolsHint({ tools: 'core' })).toBe(true);
    expect(isWmuxToolsHint({ tools: 'core', role: 'Planner' })).toBe(true);
    expect(isWmuxToolsHint({ tools: 'all' })).toBe(false);
    expect(isWmuxToolsHint('core')).toBe(false);
  });
});

describe('codex wmux server detection', () => {
  const write = (text: string | null): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-codexcfg-'));
    const file = path.join(dir, 'config.toml');
    if (text !== null) fs.writeFileSync(file, text);
    return file;
  };

  it('needs a [mcp_servers.wmux] table with a command', () => {
    const toml = (...lines: string[]) => `${lines.join('\n')}\n`;
    expect(codexHasWmuxServer(write(toml('[mcp_servers.wmux]', 'command = "node"', 'args = ["C:/u/.wmux/mcp/index.js"]')))).toBe(true);
    expect(codexHasWmuxServer(write(null))).toBe(false);
    expect(codexHasWmuxServer(write(''))).toBe(false);
    expect(codexHasWmuxServer(write(toml('[mcp_servers.other]', 'command = "node"')))).toBe(false);
    expect(codexHasWmuxServer(write(toml('[mcp_servers.wmux]', 'enabled = false')))).toBe(false);
    expect(codexHasWmuxServer(write('this is = = not toml'))).toBe(false);
  });

  it('reads CODEX_HOME from the launch env first, then falls back to <home>/.codex', () => {
    const home = path.join('C:', 'h');
    const saved = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    try {
      expect(codexConfigPath({ CODEX_HOME: path.join('C:', 'acct') }, home)).toBe(path.join('C:', 'acct', 'config.toml'));
      expect(codexConfigPath({}, home)).toBe(path.join(home, '.codex', 'config.toml'));
    } finally {
      if (saved !== undefined) process.env.CODEX_HOME = saved;
    }
  });
});
