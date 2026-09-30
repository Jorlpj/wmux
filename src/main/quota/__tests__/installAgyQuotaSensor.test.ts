import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  installAgyQuotaSensor,
  classifyAgyStatusLine,
  extractExistingCommand,
  escapeChainedCommandArg,
} from '../installAgyQuotaSensor';

describe('installAgyQuotaSensor', () => {
  let tmpHome: string;
  let mockSinkSource: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-agy-sensor-test-'));
    // Create a mock source script
    mockSinkSource = path.join(tmpHome, 'source', 'quota-sink.js');
    fs.mkdirSync(path.dirname(mockSinkSource), { recursive: true });
    fs.writeFileSync(mockSinkSource, '// mock quota-sink\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function settingsFilePath(): string {
    return path.join(tmpHome, '.gemini', 'antigravity-cli', 'settings.json');
  }

  function readSettings(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8'));
  }

  it('Case 1: Fresh install when settings.json does not exist yet', () => {
    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'C:\\Node\\node.exe',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('installed');
    expect(outcome.backupPath).toBeUndefined();

    // Destination script must have been copied
    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');
    expect(fs.existsSync(installedSink)).toBe(true);
    expect(fs.readFileSync(installedSink, 'utf8')).toBe('// mock quota-sink\n');

    // settings.json must be created with statusLine
    expect(fs.existsSync(settingsFilePath())).toBe(true);
    const settings = readSettings();
    const sl = settings.statusLine as {
      type: string;
      command: string;
      enabled: boolean;
      stack_with_default: boolean;
    };

    expect(sl.type).toBe('command');
    expect(sl.command).toBe(`"C:\\Node\\node.exe" "${installedSink}" agy`);
    expect(sl.enabled).toBe(true);
    expect(sl.stack_with_default).toBe(true);
  });

  it('Case 1b: Fresh install when settings.json exists without statusLine, preserving other keys', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const initialConfig = {
      theme: 'dracula',
      permissions: { allow: ['command(ls)'] },
      user_preference: 42,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'node',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('installed');
    expect(outcome.backupPath).toBeUndefined();

    const settings = readSettings();
    // Pre-existing keys must be completely preserved
    expect(settings.theme).toBe('dracula');
    expect(settings.permissions).toEqual({ allow: ['command(ls)'] });
    expect(settings.user_preference).toBe(42);

    // statusLine is merged in
    expect(settings.statusLine).toBeDefined();
    const sl = settings.statusLine as { type: string; command: string; enabled: boolean };
    expect(sl.type).toBe('command');
    expect(sl.command).toContain('quota-sink.js');
    expect(sl.enabled).toBe(true);
  });

  it('Case 1c: Fresh install when settings.json contains empty placeholder statusLine, preserving other keys and creating no backup', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const initialConfig = {
      theme: 'dracula',
      statusLine: { type: '', command: '', enabled: false },
      user_preference: 42,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'C:\\Node\\node.exe',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('installed');
    expect(outcome.backupPath).toBeUndefined();

    // No backup file created in the dir
    const geminiDir = path.dirname(settingsPath);
    const backups = fs.readdirSync(geminiDir).filter((f) => f.includes('.bak-wmux-'));
    expect(backups).toHaveLength(0);

    const settings = readSettings();
    expect(settings.theme).toBe('dracula');
    expect(settings.user_preference).toBe(42);

    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: `"C:\\Node\\node.exe" "${installedSink}" agy`,
      enabled: true,
      stack_with_default: true,
    });
  });

  it('Case 1d: Fresh install when settings.json contains whitespace command in statusLine, preserving other keys and creating no backup', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const initialConfig = {
      theme: 'solarized',
      statusLine: { type: 'command', command: '   ', enabled: false },
      user_preference: 100,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'node',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('installed');
    expect(outcome.backupPath).toBeUndefined();

    const geminiDir = path.dirname(settingsPath);
    const backups = fs.readdirSync(geminiDir).filter((f) => f.includes('.bak-wmux-'));
    expect(backups).toHaveLength(0);

    const settings = readSettings();
    expect(settings.theme).toBe('solarized');
    expect(settings.user_preference).toBe(100);

    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: `"node" "${installedSink}" agy`,
      enabled: true,
      stack_with_default: true,
    });
  });

  it('Case 2: Chains pre-existing foreign statusLine and backs up settings.json', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const initialConfig = {
      theme: 'solarized',
      statusLine: {
        type: 'command',
        command: 'my-custom-status --format=json',
        enabled: true,
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'C:\\node.exe',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('chained');
    expect(outcome.backupPath).toBeDefined();

    // Verify backup exists and contains original contents
    expect(fs.existsSync(outcome.backupPath!)).toBe(true);
    const backupContent = JSON.parse(fs.readFileSync(outcome.backupPath!, 'utf8'));
    expect(backupContent).toEqual(initialConfig);

    // Verify new settings has chained command
    const settings = readSettings();
    expect(settings.theme).toBe('solarized'); // preserved

    const sl = settings.statusLine as {
      type: string;
      command: string;
      enabled: boolean;
      stack_with_default: boolean;
    };
    expect(sl.type).toBe('command');
    expect(sl.enabled).toBe(true);
    expect(sl.stack_with_default).toBe(true);

    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');
    expect(sl.command).toBe(`"C:\\node.exe" "${installedSink}" agy "my-custom-status --format=json"`);
  });

  it('Case 2b: Chains foreign statusLine with non-empty command even when enabled is false, and creates a backup', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const initialConfig = {
      theme: 'nord',
      statusLine: {
        type: 'command',
        command: 'my-disabled-command --flag',
        enabled: false,
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'C:\\node.exe',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('chained');
    expect(outcome.backupPath).toBeDefined();

    // Verify backup exists and contains original contents
    expect(fs.existsSync(outcome.backupPath!)).toBe(true);
    const backupContent = JSON.parse(fs.readFileSync(outcome.backupPath!, 'utf8'));
    expect(backupContent).toEqual(initialConfig);

    const geminiDir = path.dirname(settingsPath);
    const backups = fs.readdirSync(geminiDir).filter((f) => f.includes('.bak-wmux-'));
    expect(backups).toHaveLength(1);

    const settings = readSettings();
    expect(settings.theme).toBe('nord');

    const sl = settings.statusLine as {
      type: string;
      command: string;
      enabled: boolean;
      stack_with_default: boolean;
    };
    expect(sl.type).toBe('command');
    expect(sl.enabled).toBe(true);
    expect(sl.stack_with_default).toBe(true);

    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');
    expect(sl.command).toBe(`"C:\\node.exe" "${installedSink}" agy "my-disabled-command --flag"`);
  });

  it('Case 3: Idempotent re-run on already-installed sink is a no-op (no rewrite, no backup)', () => {
    // First install
    const first = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'node',
    });
    expect(first.action).toBe('installed');

    const statBefore = fs.statSync(settingsFilePath());
    const contentBefore = fs.readFileSync(settingsFilePath(), 'utf8');

    // List any backup files in the dir
    const geminiDir = path.dirname(settingsFilePath());
    const backupsBefore = fs.readdirSync(geminiDir).filter((f) => f.includes('.bak-wmux-'));
    expect(backupsBefore).toHaveLength(0);

    // Re-run installer
    const second = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'node',
    });

    expect(second.ok).toBe(true);
    expect(second.action).toBe('noop');
    expect(second.backupPath).toBeUndefined();

    // File content and mtime must be untouched
    const statAfter = fs.statSync(settingsFilePath());
    const contentAfter = fs.readFileSync(settingsFilePath(), 'utf8');
    expect(contentAfter).toBe(contentBefore);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

    // No backup created
    const backupsAfter = fs.readdirSync(geminiDir).filter((f) => f.includes('.bak-wmux-'));
    expect(backupsAfter).toHaveLength(0);
  });

  it('Case 3b: Idempotent re-run on chained sink is also a no-op', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: 'command', command: 'prev-cmd' } }),
      'utf8',
    );

    // First install chains and backs up
    const first = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'node',
    });
    expect(first.action).toBe('chained');
    expect(first.backupPath).toBeDefined();

    const geminiDir = path.dirname(settingsPath);
    const backupsAfterFirst = fs.readdirSync(geminiDir).filter((f) => f.includes('.bak-wmux-'));
    expect(backupsAfterFirst).toHaveLength(1);

    // Second install must be a no-op
    const second = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'node',
    });
    expect(second.ok).toBe(true);
    expect(second.action).toBe('noop');

    // No additional backup created
    const backupsAfterSecond = fs.readdirSync(geminiDir).filter((f) => f.includes('.bak-wmux-'));
    expect(backupsAfterSecond).toHaveLength(1);
  });

  it('handles corrupted settings.json cleanly without crashing', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, 'INVALID JSON {[[', 'utf8');

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.action).toBe('noop');
    expect(outcome.error).toContain('Failed to parse settings.json');
  });

  it('fails and does not write settings.json when quota-sink source script is missing', () => {
    const missingSource = path.join(tmpHome, 'nonexistent', 'quota-sink.js');
    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: missingSource,
      nodePath: 'C:\\Node\\node.exe',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.action).toBe('noop');
    expect(outcome.error).toContain('Source quota-sink.js script not found');
    expect(outcome.error).toContain(missingSource);

    // settings.json must NOT be written
    expect(fs.existsSync(settingsFilePath())).toBe(false);

    // Destination script must NOT be created
    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');
    expect(fs.existsSync(installedSink)).toBe(false);
  });

  it('fails cleanly without altering pre-existing settings.json when source script is missing', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const originalSettings = { custom_key: 'preserve_me' };
    fs.writeFileSync(settingsPath, JSON.stringify(originalSettings, null, 2), 'utf8');

    const missingSource = path.join(tmpHome, 'missing-sink.js');
    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: missingSource,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.action).toBe('noop');
    expect(outcome.error).toContain('Source quota-sink.js script not found');

    // Existing settings.json must remain completely intact
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual(originalSettings);

    // No backup should have been created
    const backups = fs.readdirSync(path.dirname(settingsPath)).filter((f) => f.includes('.bak-wmux-'));
    expect(backups).toHaveLength(0);
  });

  it('chains pre-existing foreign statusLine containing quotes using doubled quotes on Windows', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const foreignCommand = '"C:\\Program Files\\foo.exe" --flag';
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: 'command', command: foreignCommand } }, null, 2),
      'utf8',
    );

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: 'C:\\node.exe',
      platform: 'win32',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('chained');

    const settings = readSettings();
    const sl = settings.statusLine as { type: string; command: string };
    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');

    // Quotes must be doubled (""), not backslash-escaped (\")
    const expected = `"C:\\node.exe" "${installedSink}" agy """C:\\Program Files\\foo.exe"" --flag"`;
    expect(sl.command).toBe(expected);
  });

  it('chains foreign statusLine using backslash escaping on POSIX platforms', () => {
    const settingsPath = settingsFilePath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const foreignCommand = '"/usr/local/bin/foo" --flag';
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: 'command', command: foreignCommand } }, null, 2),
      'utf8',
    );

    const outcome = installAgyQuotaSensor(tmpHome, {
      sourceScriptPath: mockSinkSource,
      nodePath: '/usr/bin/node',
      platform: 'linux',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('chained');

    const settings = readSettings();
    const sl = settings.statusLine as { type: string; command: string };
    const installedSink = path.join(tmpHome, '.wmux', 'bin', 'quota-sink.js');

    const expected = `"/usr/bin/node" "${installedSink}" agy "\\"/usr/local/bin/foo\\" --flag"`;
    expect(sl.command).toBe(expected);
  });
});

describe('classifyAgyStatusLine & extractExistingCommand helper', () => {
  it('classifies none correctly', () => {
    expect(classifyAgyStatusLine({})).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: undefined })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: null })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: '' })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: '   ' })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: '\t\r\n ' })).toBe('none');

    // Fresh Antigravity CLI placeholder object: { type: "", command: "", enabled: false }
    expect(
      classifyAgyStatusLine({
        statusLine: { type: '', command: '', enabled: false },
      }),
    ).toBe('none');

    // Object with missing command key
    expect(classifyAgyStatusLine({ statusLine: {} })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: { type: 'command' } })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: { enabled: true } })).toBe('none');

    // Object with non-string command
    expect(classifyAgyStatusLine({ statusLine: { command: 123 } })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: { command: null } })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: { command: true } })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: { command: {} } })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: { command: [] } })).toBe('none');

    // Object with empty or whitespace-only command
    expect(classifyAgyStatusLine({ statusLine: { command: '' } })).toBe('none');
    expect(classifyAgyStatusLine({ statusLine: { command: '   ' } })).toBe('none');
    expect(
      classifyAgyStatusLine({
        statusLine: { type: 'command', command: '   ', enabled: false },
      }),
    ).toBe('none');
    expect(
      classifyAgyStatusLine({
        statusLine: { type: 'command', command: ' \r\n\t ', enabled: true },
      }),
    ).toBe('none');
  });

  it('classifies agy-sink correctly', () => {
    expect(
      classifyAgyStatusLine({
        statusLine: { command: '"node" "C:\\path\\quota-sink.js" agy' },
      }),
    ).toBe('agy-sink');

    expect(
      classifyAgyStatusLine({
        statusLine: { command: '"node" "C:\\custom\\sink.js" agy' },
      }, 'C:\\custom\\sink.js'),
    ).toBe('agy-sink');

    expect(
      classifyAgyStatusLine({
        statusLine: { command: 'node quota-sink.js', enabled: false },
      }),
    ).toBe('agy-sink');

    expect(
      classifyAgyStatusLine({
        statusLine: 'node "C:\\path\\quota-sink.js"',
      }),
    ).toBe('agy-sink');
  });

  it('classifies foreign correctly', () => {
    expect(
      classifyAgyStatusLine({
        statusLine: { command: 'node other-script.js' },
      }),
    ).toBe('foreign');

    expect(
      classifyAgyStatusLine({
        statusLine: { command: 'node other-script.js', enabled: false },
      }),
    ).toBe('foreign');

    expect(
      classifyAgyStatusLine({
        statusLine: { command: 'my-custom-command --flag', enabled: true },
      }),
    ).toBe('foreign');

    expect(
      classifyAgyStatusLine({
        statusLine: 'custom-string-command',
      }),
    ).toBe('foreign');
  });

  it('extractExistingCommand extracts string from object or string value', () => {
    expect(extractExistingCommand({ command: 'my-cmd --arg' })).toBe('my-cmd --arg');
    expect(extractExistingCommand('bare-cmd')).toBe('bare-cmd');
    expect(extractExistingCommand(null)).toBe('');
    expect(extractExistingCommand(undefined)).toBe('');
  });
});

describe('escapeChainedCommandArg helper', () => {
  it('doubles quotes for win32 (cmd.exe escaping)', () => {
    expect(escapeChainedCommandArg('"C:\\Program Files\\foo.exe" --flag', 'win32'))
      .toBe('""C:\\Program Files\\foo.exe"" --flag');
    expect(escapeChainedCommandArg('tool --message="hello world"', 'win32'))
      .toBe('tool --message=""hello world""');
    expect(escapeChainedCommandArg('"C:\\app.exe" "arg with space"', 'win32'))
      .toBe('""C:\\app.exe"" ""arg with space""');
    expect(escapeChainedCommandArg('simple-cmd', 'win32'))
      .toBe('simple-cmd');
  });

  it('uses backslash escaping for POSIX platforms', () => {
    expect(escapeChainedCommandArg('"/usr/local/bin/foo" --flag', 'linux'))
      .toBe('\\"/usr/local/bin/foo\\" --flag');
    expect(escapeChainedCommandArg('tool --msg="hello"', 'darwin'))
      .toBe('tool --msg=\\"hello\\"');
    expect(escapeChainedCommandArg('simple-cmd', 'linux'))
      .toBe('simple-cmd');
  });

  it('round-trips chained command arguments correctly through cmd.exe execution on Windows', () => {
    if (process.platform !== 'win32') return;

    const testCases = [
      '"C:\\Program Files\\foo.exe" --flag',
      '"C:\\Program Files\\app.exe" "arg with space"',
      'tool --message="hello world"',
      'simple-command --verbose',
    ];

    for (const originalCmd of testCases) {
      const escaped = escapeChainedCommandArg(originalCmd, 'win32');
      const cmdLine = `"${process.execPath}" -e "process.stdout.write(process.argv.slice(2)[0])" agy "${escaped}"`;
      const res = spawnSync(cmdLine, {
        shell: true,
        encoding: 'utf8',
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toBe(originalCmd);
    }
  });

  it('round-trips end-to-end through quota-sink.js and executes chained command with quotes', () => {
    if (process.platform !== 'win32') return;

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-roundtrip-test-'));
    try {
      const helperScript = path.join(tmpHome, 'quote-helper.js');
      fs.writeFileSync(
        helperScript,
        'process.stdout.write("ARG:" + process.argv.slice(2).join(","));',
        'utf8',
      );

      const foreignCmd = `"${process.execPath}" "${helperScript}" "hello world"`;
      const settingsDir = path.join(tmpHome, '.gemini', 'antigravity-cli');
      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(
        path.join(settingsDir, 'settings.json'),
        JSON.stringify({ statusLine: { type: 'command', command: foreignCmd } }),
        'utf8',
      );

      const outcome = installAgyQuotaSensor(tmpHome, {
        sourceScriptPath: path.resolve(__dirname, '../../../../integrations/agy/bin/quota-sink.js'),
        nodePath: process.execPath,
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.action).toBe('chained');

      // Execute statusLine.command via cmd.exe (shell: true)
      const res = spawnSync(outcome.commandWritten!, {
        shell: true,
        input: JSON.stringify({ quota: { remaining: 1 } }),
        encoding: 'utf8',
        env: {
          ...process.env,
          WMUX_QUOTA_SINK_HOME: tmpHome,
        },
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toBe('ARG:hello world');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

