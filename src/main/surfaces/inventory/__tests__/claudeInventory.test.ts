import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readClaudeInventory } from '../claudeInventory';
import type { InventoryDeps } from '../types';

describe('readClaudeInventory', () => {
  it('reads claude inventory with all required fixture scenarios', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-inventory-test-'));
    const projectDir = path.join(tempDir, 'my-project');

    try {
      const claudeHomeDir = path.join(tempDir, '.claude');
      const userSkillsDir = path.join(claudeHomeDir, 'skills');
      const pluginSkillsDir = path.join(claudeHomeDir, 'plugins', 'my-plugin', 'skills');
      const projectClaudeDir = path.join(projectDir, '.claude');

      await fs.mkdir(claudeHomeDir, { recursive: true });
      await fs.mkdir(userSkillsDir, { recursive: true });
      await fs.mkdir(pluginSkillsDir, { recursive: true });
      await fs.mkdir(projectClaudeDir, { recursive: true });

      // 1. ~/.claude.json
      const claudeJson = {
        mcpServers: {
          wmux: { command: 'node', args: ['wmux.js'] },
          'user-server': { command: 'node' },
          'globally-denied-server': { command: 'node' },
        },
        projects: {
          [projectDir]: {
            disabledMcpServers: ['project-disabled-server'],
            mcpServers: {
              'project-server': { command: 'node' },
              'project-disabled-server': { command: 'node' },
            },
          },
        },
      };
      await fs.writeFile(
        path.join(tempDir, '.claude.json'),
        JSON.stringify(claudeJson),
        'utf8',
      );

      // 2. ~/.claude/settings.json
      const settingsJson = {
        permissions: {
          deny: ['WebSearch', 'mcp__user-server__denied_tool'],
        },
        enabledPlugins: {
          'plugin-active': true,
          'plugin-disabled': false,
        },
        skillOverrides: {
          'disabled-skill': 'off',
          'active-skill': 'on',
        },
        deniedMcpServers: [{ serverName: 'globally-denied-server' }],
        hooks: {
          PreToolUse: [
            { type: 'prompt', name: 'prompt-hook', prompt: 'check tool' },
          ],
          Stop: [
            { type: 'command', name: 'stop-hook', command: 'node stop.js' },
          ],
          SessionStart: [
            { type: 'command', name: 'session-hook', command: 'node session.js' },
          ],
          PostInvocation: [
            { type: 'command', name: 'wmux-hook', command: 'node ~/.wmux/bridge.js' },
          ],
        },
        autoMemoryEnabled: true,
      };
      await fs.writeFile(
        path.join(claudeHomeDir, 'settings.json'),
        JSON.stringify(settingsJson),
        'utf8',
      );

      // 3. Skills on disk
      const disabledSkillDir = path.join(userSkillsDir, 'disabled-skill');
      await fs.mkdir(disabledSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(disabledSkillDir, 'SKILL.md'),
        '---\nname: disabled-skill\ndescription: Disabled skill\n---\nBody',
        'utf8',
      );

      const activeSkillDir = path.join(userSkillsDir, 'active-skill');
      await fs.mkdir(activeSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(activeSkillDir, 'SKILL.md'),
        '---\nname: active-skill\ndescription: Active skill\n---\nBody',
        'utf8',
      );

      // Plugin skill
      const pSkillDir = path.join(pluginSkillsDir, 'plugin-skill');
      await fs.mkdir(pSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(pSkillDir, 'SKILL.md'),
        '---\nname: plugin-skill\ndescription: Plugin skill\n---\nBody',
        'utf8',
      );

      const deps: InventoryDeps = {
        homeDir: tempDir,
        projectDir,
        run: async (cmd, args) => {
          if (cmd === 'claude' && args[0] === '--version') {
            return '1.0.5';
          }
          throw new Error(`Unexpected command: ${cmd}`);
        },
      };

      const inventory = await readClaudeInventory(deps);

      expect(inventory.provider).toBe('claude');
      expect(inventory.cliVersion).toBe('1.0.5');
      expect(inventory.versionSupported).toBe(true);
      expect(inventory.writable).toBe(true);

      // MCP servers
      const wmuxServer = inventory.items.find((i) => i.name === 'wmux' && i.kind === 'mcp-server');
      expect(wmuxServer).toBeDefined();
      expect(wmuxServer?.source).toBe('wmux');
      expect(wmuxServer?.wmuxRequired).toBe(true);
      expect(wmuxServer?.enabled).toBe(true);

      const globalDenied = inventory.items.find((i) => i.name === 'globally-denied-server' && i.kind === 'mcp-server');
      expect(globalDenied?.enabled).toBe(false);

      const projDisabled = inventory.items.find((i) => i.name === 'project-disabled-server' && i.kind === 'mcp-server');
      expect(projDisabled?.enabled).toBe(false);

      const projServer = inventory.items.find((i) => i.name === 'project-server' && i.kind === 'mcp-server');
      expect(projServer?.enabled).toBe(true);
      expect(projServer?.source).toBe('project');

      const deniedTool = inventory.items.find((i) => i.name === 'denied_tool' && i.kind === 'mcp-tool');
      expect(deniedTool).toBeDefined();
      expect(deniedTool?.parent).toBe('user-server');
      expect(deniedTool?.enabled).toBe(false);

      // Bare tool from permissions.deny
      const webSearch = inventory.items.find((i) => i.name === 'WebSearch' && i.kind === 'builtin-tool');
      expect(webSearch).toBeDefined();
      expect(webSearch?.enabled).toBe(false);

      // Plugins
      const activePlugin = inventory.items.find((i) => i.name === 'plugin-active' && i.kind === 'plugin');
      expect(activePlugin?.enabled).toBe(true);

      const disabledPlugin = inventory.items.find((i) => i.name === 'plugin-disabled' && i.kind === 'plugin');
      expect(disabledPlugin?.enabled).toBe(false);

      // Skills: skillOverrides: off -> disabled
      const disabledSkill = inventory.items.find((i) => i.name === 'disabled-skill' && i.kind === 'skill');
      expect(disabledSkill?.enabled).toBe(false);
      expect(disabledSkill?.toggleable).toBe(true);

      const activeSkill = inventory.items.find((i) => i.name === 'active-skill' && i.kind === 'skill');
      expect(activeSkill?.enabled).toBe(true);

      // Plugin skills not toggleable
      const pluginSkill = inventory.items.find((i) => i.name === 'plugin-skill' && i.kind === 'skill');
      expect(pluginSkill).toBeDefined();
      expect(pluginSkill?.source).toBe('plugin');
      expect(pluginSkill?.toggleable).toBe(false);
      expect(pluginSkill?.readOnlyReason).toBe('Plugin skills cannot be toggled in Claude Code');

      // Hooks costs
      const promptHook = inventory.items.find((i) => i.name === 'prompt-hook' && i.kind === 'hook');
      expect(promptHook?.hookCost).toBe('calls-model');

      const stopHook = inventory.items.find((i) => i.name === 'stop-hook' && i.kind === 'hook');
      expect(stopHook?.hookCost).toBe('extra-turn');

      const sessionHook = inventory.items.find((i) => i.name === 'session-hook' && i.kind === 'hook');
      expect(sessionHook?.hookCost).toBe('injects-context');

      const wmuxHook = inventory.items.find((i) => i.name === 'wmux-hook' && i.kind === 'hook');
      expect(wmuxHook?.source).toBe('wmux');
      expect(wmuxHook?.wmuxRequired).toBe(true);

      // Context setting
      const autoMemory = inventory.items.find((i) => i.name === 'autoMemoryEnabled' && i.kind === 'context-setting');
      expect(autoMemory).toBeDefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles malformed settings file with a warning', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-malformed-test-'));

    try {
      const claudeHomeDir = path.join(tempDir, '.claude');
      await fs.mkdir(claudeHomeDir, { recursive: true });
      await fs.writeFile(path.join(claudeHomeDir, 'settings.json'), 'not json {{{', 'utf8');

      const deps: InventoryDeps = {
        homeDir: tempDir,
        run: async () => '1.0.0',
      };

      const inventory = await readClaudeInventory(deps);
      expect(inventory.warnings.some((w) => w.includes('Failed to parse JSON'))).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves same-named skills in user and project roots without dropping', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-dup-skills-home-'));
    const projDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-dup-skills-proj-'));

    try {
      const userSkillDir = path.join(tempDir, '.claude', 'skills', 'shared-skill');
      const projSkillDir = path.join(projDir, '.claude', 'skills', 'shared-skill');

      await fs.mkdir(userSkillDir, { recursive: true });
      await fs.mkdir(projSkillDir, { recursive: true });

      await fs.writeFile(
        path.join(userSkillDir, 'SKILL.md'),
        '---\nname: shared-skill\ndescription: User shared skill\n---\nBody',
        'utf8',
      );
      await fs.writeFile(
        path.join(projSkillDir, 'SKILL.md'),
        '---\nname: shared-skill\ndescription: Project shared skill\n---\nBody',
        'utf8',
      );

      const deps: InventoryDeps = {
        homeDir: tempDir,
        projectDir: projDir,
        run: async () => '1.0.0',
      };

      const inventory = await readClaudeInventory(deps);
      const sharedSkills = inventory.items.filter(
        (i) => i.name === 'shared-skill' && i.kind === 'skill',
      );

      expect(sharedSkills).toHaveLength(2);
      expect(sharedSkills[0].source).toBe('user');
      expect(sharedSkills[0].id).toBe('claude:skill::shared-skill');

      expect(sharedSkills[1].source).toBe('project');
      expect(sharedSkills[1].id).toBe('claude:skill::shared-skill@project');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rm(projDir, { recursive: true, force: true });
    }
  });
});
