// wmux ↔ Antigravity CLI (agy) quota sensor installer.
// Configures agy's statusLine hook to feed the quota sink while preserving any
// pre-existing statusLine configuration via chaining.

import * as fs from 'fs';
import * as path from 'path';
import { writeJsonAtomic, copyFileAtomic } from '../../shared/settingsFile';

export type AgyStatusLineKind = 'none' | 'agy-sink' | 'foreign';
export type InstallAgyQuotaSensorAction = 'installed' | 'chained' | 'noop';

export interface InstallAgyQuotaSensorOptions {
  /** Node executable path to write into statusLine.command (defaults to process.execPath). */
  nodePath?: string;
  /** Destination script path (defaults to <homeDir>/.wmux/bin/quota-sink.js). */
  sinkScriptPath?: string;
  /** Source script path to copy from (searched automatically if omitted). */
  sourceScriptPath?: string;
  /** Whether to copy the quota-sink.js script to sinkScriptPath (defaults to true). */
  copyScript?: boolean;
  /** Target OS platform for command line quoting (defaults to process.platform). */
  platform?: NodeJS.Platform;
}

export interface InstallAgyQuotaSensorOutcome {
  ok: boolean;
  action: InstallAgyQuotaSensorAction;
  settingsPath: string;
  backupPath?: string;
  commandWritten?: string;
  error?: string;
}

/**
 * Searches upward candidate paths to find the bundled or repository quota-sink.js script.
 */
export function findQuotaSinkSourceFrom(startDir: string): string | null {
  const candidates = [
    'quota-sink.js',
    path.join('cli-bundle', 'quota-sink.js'),
    path.join('dist', 'cli-bundle', 'quota-sink.js'),
    path.join('integrations', 'agy', 'bin', 'quota-sink.js'),
  ];
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    for (const rel of candidates) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Escapes an existing statusLine command so it can be safely passed as a single quoted argument
 * in statusLine.command.
 *
 * On Windows (cmd.exe), double quotes are escaped by doubling them (`""`), because cmd.exe
 * does not use backslashes to escape quotes inside command line strings.
 * On POSIX systems (sh/bash), double quotes are escaped with backslashes (`\"`).
 */
export function escapeChainedCommandArg(cmd: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return cmd.replace(/"/g, '""');
  }
  return cmd.replace(/"/g, '\\"');
}

/**
 * Classifies the current statusLine entry in settings.json:
 * - 'none': missing, null, or undefined.
 * - 'agy-sink': already configured to point to wmux's quota-sink.js.
 * - 'foreign': another command is configured.
 */
export function classifyAgyStatusLine(
  settings: Record<string, unknown>,
  sinkScriptPath?: string,
): AgyStatusLineKind {
  const sl = settings.statusLine;
  if (sl === undefined || sl === null) return 'none';
  if (typeof sl === 'object' && !Array.isArray(sl)) {
    const cmd = (sl as Record<string, unknown>).command;
    if (typeof cmd === 'string') {
      if (sinkScriptPath && cmd.includes(sinkScriptPath)) return 'agy-sink';
      if (cmd.includes('quota-sink.js')) return 'agy-sink';
    }
  } else if (typeof sl === 'string') {
    if (sinkScriptPath && sl.includes(sinkScriptPath)) return 'agy-sink';
    if (sl.includes('quota-sink.js')) return 'agy-sink';
  }
  return 'foreign';
}

/**
 * Extracts the raw command string from an existing statusLine entry.
 */
export function extractExistingCommand(statusLine: unknown): string {
  if (typeof statusLine === 'object' && statusLine !== null && !Array.isArray(statusLine)) {
    const cmd = (statusLine as Record<string, unknown>).command;
    if (typeof cmd === 'string') return cmd;
  }
  if (typeof statusLine === 'string') return statusLine;
  return '';
}

/**
 * Installs the wmux quota sensor into ~/.gemini/antigravity-cli/settings.json.
 *
 * Injected home directory ensures safe execution in tests without touching real user home.
 *
 * Behavior:
 * 1. Copies quota-sink.js to <homeDir>/.wmux/bin/quota-sink.js (unless copyScript is false).
 *    Returns ok: false if the source script cannot be found.
 * 2. Reads <homeDir>/.gemini/antigravity-cli/settings.json (creates parent dirs / {} if missing).
 * 3. If no statusLine key exists:
 *    Writes `"statusLine": { "type": "command", "command": "\"<node>\" \"<sink>\" agy", "enabled": true, "stack_with_default": true }`.
 * 4. If statusLine already points to quota-sink.js:
 *    No-op: returns action='noop' without rewriting settings.json or creating a backup.
 * 5. If statusLine exists and is foreign:
 *    Backs up settings.json to <settingsPath>.bak-wmux-<timestamp>, then rewrites statusLine to chain
 *    to the original command via trailing argument with platform-safe quote escaping:
 *    `"\"<node>\" \"<sink>\" agy \"<original>\""`.
 * 6. Preserves all other keys in settings.json; writes atomically via writeJsonAtomic.
 */
export function installAgyQuotaSensor(
  homeDir: string,
  options?: InstallAgyQuotaSensorOptions,
): InstallAgyQuotaSensorOutcome {
  const settingsPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');
  const nodePath = options?.nodePath ?? process.execPath;
  const sinkScriptPath = options?.sinkScriptPath ?? path.join(homeDir, '.wmux', 'bin', 'quota-sink.js');

  // Copy quota-sink.js into place
  if (options?.copyScript !== false) {
    const source = options?.sourceScriptPath ?? findQuotaSinkSourceFrom(__dirname);
    if (!source || !fs.existsSync(source)) {
      return {
        ok: false,
        action: 'noop',
        settingsPath,
        error: `Source quota-sink.js script not found${source ? ` at ${source}` : ''}`,
      };
    }
    copyFileAtomic(source, sinkScriptPath);
  }

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = parsed as Record<string, unknown>;
        } else {
          return {
            ok: false,
            action: 'noop',
            settingsPath,
            error: 'settings.json does not contain a JSON object',
          };
        }
      } catch (err) {
        return {
          ok: false,
          action: 'noop',
          settingsPath,
          error: `Failed to parse settings.json: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  const classification = classifyAgyStatusLine(settings, sinkScriptPath);

  // Round-trip safety: already correctly installed → no-op
  if (classification === 'agy-sink') {
    const currentCmd = extractExistingCommand(settings.statusLine);
    return {
      ok: true,
      action: 'noop',
      settingsPath,
      commandWritten: currentCmd,
    };
  }

  if (classification === 'foreign') {
    // Existing statusLine: back up file and chain original command
    const backupPath = `${settingsPath}.bak-wmux-${Date.now()}`;
    fs.copyFileSync(settingsPath, backupPath);

    const platform = options?.platform ?? process.platform;
    const existingCmd = extractExistingCommand(settings.statusLine);
    const escapedExistingCmd = escapeChainedCommandArg(existingCmd, platform);
    const chainedCommand = `"${nodePath}" "${sinkScriptPath}" agy "${escapedExistingCmd}"`;

    settings.statusLine = {
      type: 'command',
      command: chainedCommand,
      enabled: true,
      stack_with_default: true,
    };

    writeJsonAtomic(settingsPath, settings);

    return {
      ok: true,
      action: 'chained',
      settingsPath,
      backupPath,
      commandWritten: chainedCommand,
    };
  }

  // classification === 'none': fresh install
  const command = `"${nodePath}" "${sinkScriptPath}" agy`;
  settings.statusLine = {
    type: 'command',
    command,
    enabled: true,
    stack_with_default: true,
  };

  writeJsonAtomic(settingsPath, settings);

  return {
    ok: true,
    action: 'installed',
    settingsPath,
    commandWritten: command,
  };
}
