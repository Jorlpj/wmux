import path from 'node:path';
import type { HookCostHint, ProviderInventory, SurfaceItem, SurfaceSource } from '../../../shared/tokenUsage/surfaceTypes';
import {
  normalizePath,
  parseSkillFrontmatter,
  queryCliVersion,
  safeParseJson,
  safeReaddir,
  safeReadFile,
} from './helpers';
import {
  allocateUniqueItemId,
  LOCATION_SOURCE_ORDER,
  makeItem,
  type InventoryDeps,
} from './types';

export async function readClaudeInventory(deps: InventoryDeps): Promise<ProviderInventory> {
  const warnings: string[] = [];
  const items: SurfaceItem[] = [];
  const seenItemIds = new Set<string>();

  function addItem(item: SurfaceItem): void {
    const uniqueId = allocateUniqueItemId(seenItemIds, item.id, item.source);
    if (uniqueId !== item.id) {
      items.push({ ...item, id: uniqueId });
    } else {
      items.push(item);
    }
  }

  const cliVersion = await queryCliVersion('claude', deps.run);
  const versionSupported = cliVersion !== null;
  const writable = versionSupported;

  // 1. Settings files
  const settingsPaths = [
    path.join(deps.homeDir, '.claude', 'settings.json'),
    path.join(deps.homeDir, '.claude', 'settings.local.json'),
  ];
  if (deps.projectDir) {
    settingsPaths.push(path.join(deps.projectDir, '.claude', 'settings.json'));
    settingsPaths.push(path.join(deps.projectDir, '.claude', 'settings.local.json'));
  }

  const deniedMcpServers = new Set<string>();
  const mcpToolDenies = new Map<string, Set<string>>(); // serverName -> Set<toolName>
  const skillOverrides = new Map<string, string>();
  let disableAllHooks = false;
  let hasMcpServers = false;

  for (const sp of settingsPaths) {
    const content = await safeReadFile(sp, deps, warnings);
    if (!content) continue;

    const parsed = safeParseJson<Record<string, unknown>>(sp, content, warnings);
    if (!parsed || typeof parsed !== 'object') continue;

    if (parsed.disableAllHooks === true) {
      disableAllHooks = true;
    }

    // deniedMcpServers
    if (Array.isArray(parsed.deniedMcpServers)) {
      for (const d of parsed.deniedMcpServers) {
        if (d && typeof d === 'object' && typeof (d as { serverName?: unknown }).serverName === 'string') {
          deniedMcpServers.add((d as { serverName: string }).serverName);
        }
      }
    }

    // permissions.deny
    const permissions = parsed.permissions;
    if (permissions && typeof permissions === 'object') {
      const deny = (permissions as { deny?: unknown }).deny;
      if (Array.isArray(deny)) {
        for (const item of deny) {
          if (typeof item !== 'string') continue;
          const mcpMatch = /^mcp__([a-zA-Z0-9_-]+)__(.+)$/.exec(item);
          if (mcpMatch) {
            const server = mcpMatch[1];
            const tool = mcpMatch[2];
            let set = mcpToolDenies.get(server);
            if (!set) {
              set = new Set<string>();
              mcpToolDenies.set(server, set);
            }
            set.add(tool);
          } else {
            // Bare tool denial
            addItem(
              makeItem({
                provider: 'claude',
                kind: 'builtin-tool',
                name: item,
                source: 'builtin',
                enabled: false,
                effect: 'removes',
                toggleable: true,
                originPath: sp,
              }),
            );
          }
        }
      }
    }

    // enabledPlugins
    const plugins = parsed.enabledPlugins;
    if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
      for (const [pluginName, val] of Object.entries(plugins)) {
        addItem(
          makeItem({
            provider: 'claude',
            kind: 'plugin',
            name: pluginName,
            source: 'user',
            enabled: val !== false,
            effect: 'removes',
            toggleable: true,
            originPath: sp,
          }),
        );
      }
    }

    // skillOverrides
    const so = parsed.skillOverrides;
    if (so && typeof so === 'object' && !Array.isArray(so)) {
      for (const [k, v] of Object.entries(so)) {
        if (typeof v === 'string') {
          skillOverrides.set(k, v);
        }
      }
    }

    // Context settings
    const contextKeys = [
      'autoMemoryEnabled',
      'claudeMdExcludes',
      'skillListingBudgetFraction',
      'skillListingMaxDescChars',
      'autoCompactEnabled',
      'disableBundledSkills',
    ];
    for (const ck of contextKeys) {
      if (ck in parsed) {
        addItem(
          makeItem({
            provider: 'claude',
            kind: 'context-setting',
            name: ck,
            source: 'user',
            enabled: true,
            effect: 'removes',
            toggleable: true,
            originPath: sp,
          }),
        );
      }
    }

    // Hooks in settings.json
    const hooks = parsed.hooks;
    if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
      for (const [event, eventHooks] of Object.entries(hooks)) {
        const hookList: unknown[] = Array.isArray(eventHooks) ? eventHooks : [eventHooks];
        for (const hookDef of hookList) {
          if (!hookDef || typeof hookDef !== 'object') continue;
          const h = hookDef as Record<string, unknown>;
          const type = typeof h.type === 'string' ? h.type : 'command';
          let hookCost: HookCostHint = 'none';
          if (type === 'prompt' || type === 'agent') {
            hookCost = 'calls-model';
          } else if (event === 'Stop' || event === 'SubagentStop') {
            hookCost = 'extra-turn';
          } else if (['SessionStart', 'UserPromptSubmit', 'UserPromptExpansion'].includes(event)) {
            hookCost = 'injects-context';
          }

          const cmd = String(h.command ?? h.prompt ?? h.script ?? '');
          const isWmux = cmd.includes('wmux') || cmd.includes('.wmux');
          const isManaged = h.managed === true;
          const hookName = (typeof h.name === 'string' && h.name) || `${event}-${type}`;
          const source: SurfaceSource = isWmux ? 'wmux' : isManaged ? 'managed' : 'user';

          addItem(
            makeItem({
              provider: 'claude',
              kind: 'hook',
              name: hookName,
              source,
              enabled: !disableAllHooks,
              effect: 'removes',
              toggleable: !isManaged,
              readOnlyReason: isManaged ? 'Managed hooks cannot be toggled' : null,
              hookEvent: event,
              hookCost,
              originPath: sp,
              wmuxRequired: isWmux,
            }),
          );
        }
      }
    }
  }

  // 2. ~/.claude.json for MCP servers
  const claudeJsonPath = path.join(deps.homeDir, '.claude.json');
  const claudeJsonContent = await safeReadFile(claudeJsonPath, deps, warnings);
  const parsedClaudeJson = claudeJsonContent
    ? safeParseJson<Record<string, unknown>>(claudeJsonPath, claudeJsonContent, warnings)
    : null;

  const projectDisabledMcpServers = new Set<string>();
  if (parsedClaudeJson && deps.projectDir && parsedClaudeJson.projects && typeof parsedClaudeJson.projects === 'object') {
    const normProjDir = normalizePath(deps.projectDir);
    for (const [projPath, projConf] of Object.entries(parsedClaudeJson.projects as Record<string, unknown>)) {
      if (normalizePath(projPath) === normProjDir && projConf && typeof projConf === 'object') {
        const disabled = (projConf as { disabledMcpServers?: unknown }).disabledMcpServers;
        if (Array.isArray(disabled)) {
          for (const s of disabled) {
            if (typeof s === 'string') projectDisabledMcpServers.add(s);
          }
        }
      }
    }
  }

  const addMcpServerWithTools = (
    serverName: string,
    source: SurfaceSource,
    originPath: string,
    disabledByConfig = false,
  ) => {
    hasMcpServers = true;
    const isWmux = serverName === 'wmux';
    const isDenied = deniedMcpServers.has(serverName) || projectDisabledMcpServers.has(serverName) || disabledByConfig;
    const finalSource: SurfaceSource = isWmux ? 'wmux' : source;

    addItem(
      makeItem({
        provider: 'claude',
        kind: 'mcp-server',
        name: serverName,
        source: finalSource,
        enabled: !isDenied,
        effect: 'removes',
        toggleable: true,
        originPath,
        wmuxRequired: isWmux,
      }),
    );

    const deniedTools = mcpToolDenies.get(serverName);
    if (deniedTools) {
      for (const tool of deniedTools) {
        addItem(
          makeItem({
            provider: 'claude',
            kind: 'mcp-tool',
            name: tool,
            parent: serverName,
            source: finalSource,
            enabled: false,
            effect: 'removes',
            toggleable: true,
            originPath,
          }),
        );
      }
    }
  };

  if (parsedClaudeJson && typeof parsedClaudeJson === 'object') {
    const servers = parsedClaudeJson.mcpServers;
    if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
      for (const serverName of Object.keys(servers)) {
        addMcpServerWithTools(serverName, 'user', claudeJsonPath);
      }
    }

    if (deps.projectDir && parsedClaudeJson.projects && typeof parsedClaudeJson.projects === 'object') {
      const normProjDir = normalizePath(deps.projectDir);
      for (const [projPath, projConf] of Object.entries(parsedClaudeJson.projects as Record<string, unknown>)) {
        if (normalizePath(projPath) === normProjDir && projConf && typeof projConf === 'object') {
          const projServers = (projConf as { mcpServers?: unknown }).mcpServers;
          if (projServers && typeof projServers === 'object' && !Array.isArray(projServers)) {
            for (const serverName of Object.keys(projServers)) {
              addMcpServerWithTools(serverName, 'project', claudeJsonPath);
            }
          }
        }
      }
    }
  }

  // 3. Project .mcp.json
  if (deps.projectDir) {
    const projectMcpJsonPath = path.join(deps.projectDir, '.mcp.json');
    const pcontent = await safeReadFile(projectMcpJsonPath, deps, warnings);
    if (pcontent) {
      const parsedPMcp = safeParseJson<Record<string, unknown>>(projectMcpJsonPath, pcontent, warnings);
      if (parsedPMcp && parsedPMcp.mcpServers && typeof parsedPMcp.mcpServers === 'object' && !Array.isArray(parsedPMcp.mcpServers)) {
        for (const serverName of Object.keys(parsedPMcp.mcpServers)) {
          addMcpServerWithTools(serverName, 'project', projectMcpJsonPath);
        }
      }
    }
  }

  // 4. Skills (user, project, plugin)
  // 4a. User skills in ~/.claude/skills
  const userSkillsDir = path.join(deps.homeDir, '.claude', 'skills');
  const userSkillDirs = await safeReaddir(userSkillsDir, deps);
  for (const sdir of userSkillDirs) {
    const skillMdPath = path.join(userSkillsDir, sdir, 'SKILL.md');
    const skillContent = await safeReadFile(skillMdPath, deps, warnings);
    if (skillContent === null) continue;

    const fm = parseSkillFrontmatter(skillContent);
    const skillName = fm.name || sdir;
    const desc = fm.description ?? '';
    const descChars = skillName.length + desc.length;

    const override = skillOverrides.get(skillName) ?? skillOverrides.get(sdir);
    const enabled = override !== 'off';

    addItem(
      makeItem({
        provider: 'claude',
        kind: 'skill',
        name: skillName,
        source: 'user',
        enabled,
        effect: 'removes',
        toggleable: true,
        descriptionChars: descChars,
        originPath: skillMdPath,
      }),
    );
  }

  // 4b. Project skills in <project>/.claude/skills
  if (deps.projectDir) {
    const projectSkillsDir = path.join(deps.projectDir, '.claude', 'skills');
    const projectSkillDirs = await safeReaddir(projectSkillsDir, deps);
    for (const sdir of projectSkillDirs) {
      const skillMdPath = path.join(projectSkillsDir, sdir, 'SKILL.md');
      const skillContent = await safeReadFile(skillMdPath, deps, warnings);
      if (skillContent === null) continue;

      const fm = parseSkillFrontmatter(skillContent);
      const skillName = fm.name || sdir;
      const desc = fm.description ?? '';
      const descChars = skillName.length + desc.length;

      const override = skillOverrides.get(skillName) ?? skillOverrides.get(sdir);
      const enabled = override !== 'off';

      addItem(
        makeItem({
          provider: 'claude',
          kind: 'skill',
          name: skillName,
          source: 'project',
          enabled,
          effect: 'removes',
          toggleable: true,
          descriptionChars: descChars,
          originPath: skillMdPath,
        }),
      );
    }
  }

  // 4c. Plugin skills
  const pluginSkillsBaseDir = path.join(deps.homeDir, '.claude', 'plugins');
  const pluginDirs = await safeReaddir(pluginSkillsBaseDir, deps);
  for (const pdir of pluginDirs) {
    const pskillsDir = path.join(pluginSkillsBaseDir, pdir, 'skills');
    const pskills = await safeReaddir(pskillsDir, deps);
    for (const psdir of pskills) {
      const skillMdPath = path.join(pskillsDir, psdir, 'SKILL.md');
      const skillContent = await safeReadFile(skillMdPath, deps, warnings);
      if (skillContent === null) continue;

      const fm = parseSkillFrontmatter(skillContent);
      const skillName = fm.name || psdir;
      const desc = fm.description ?? '';
      const descChars = skillName.length + desc.length;

      addItem(
        makeItem({
          provider: 'claude',
          kind: 'skill',
          name: skillName,
          source: 'plugin',
          enabled: true,
          effect: 'removes',
          toggleable: false,
          readOnlyReason: 'Plugin skills cannot be toggled in Claude Code',
          descriptionChars: descChars,
          originPath: skillMdPath,
        }),
      );
    }
  }

  if (hasMcpServers) {
    warnings.push('Full MCP tool list requires live tools/list (config only records tool overrides).');
  }

  if (!versionSupported) {
    for (const item of items) {
      if (item.toggleable) {
        item.toggleable = false;
        item.readOnlyReason = 'CLI version not supported (read-only)';
      }
    }
  }

  return {
    provider: 'claude',
    cliVersion,
    versionSupported,
    writable,
    items,
    warnings,
    scannedAtMs: deps.now ? deps.now() : Date.now(),
  };
}
