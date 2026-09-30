import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyWmuxToolsToCommand, isWmuxToolsHint } from '../toolSurfaceLaunch';

const mcpDir = path.join('C:', 'u', '.wmux', 'mcp');
const entry = path.join(mcpDir, 'index.js');

function run(command: string, tools: 'full' | 'core' | 'role', role?: string, exists = true) {
  const written: Record<string, string> = {};
  const out = applyWmuxToolsToCommand(command, { tools, ...(role ? { role } : {}) }, {
    mcpDir,
    exists: () => exists,
    writeFile: (p, d) => { written[p] = d; },
  });
  return { out, written };
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

  it('validates the hint shape', () => {
    expect(isWmuxToolsHint({ tools: 'core' })).toBe(true);
    expect(isWmuxToolsHint({ tools: 'core', role: 'Planner' })).toBe(true);
    expect(isWmuxToolsHint({ tools: 'all' })).toBe(false);
    expect(isWmuxToolsHint('core')).toBe(false);
  });
});
