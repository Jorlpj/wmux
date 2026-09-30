import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
// Import quota-sink helpers directly
const quotaSink = require('../../../../integrations/agy/bin/quota-sink.js');
const {
  extractQuotaPayload,
  writeQuotaFile,
  resolveOriginalCommand,
} = quotaSink;

const SINK_SCRIPT = path.resolve(__dirname, '../../../../integrations/agy/bin/quota-sink.js');

describe('quota-sink.js field extraction and privacy allowlist', () => {
  it('extracts ONLY allowlisted fields and stamps capturedAtMs', () => {
    const fullPayload = {
      quota: {
        'gemini-weekly': {
          remaining_fraction: 0.85,
          reset_time: '2026-10-01T00:00:00Z',
          reset_in_seconds: 21600,
        },
      },
      plan_tier: 'pro_tier',
      model: {
        id: 'gemini-2.5-pro',
        display_name: 'Gemini 2.5 Pro',
        vendor: 'google',
      },
      context_window: {
        total_input_tokens: 1500,
        total_output_tokens: 300,
        context_window_size: 2000000,
      },
      conversation_id: 'conv-12345',
      version: '1.2.14',
      // SENSITIVE FIELDS TO DROP:
      email: 'sensitive-user@google.com',
      cwd: 'C:\\Users\\Lontra\\SecretProject',
      transcript_path: 'C:\\Users\\Lontra\\.gemini\\transcripts\\t1.json',
      vcs: { branch: 'main', commit: 'abcdef' },
      user: { id: 'u-999', name: 'John Doe' },
      messages: [{ role: 'user', content: 'hello' }],
      extra_junk: true,
    };

    const before = Date.now();
    const extracted = extractQuotaPayload(fullPayload);
    const after = Date.now();

    expect(extracted.capturedAtMs).toBeGreaterThanOrEqual(before);
    expect(extracted.capturedAtMs).toBeLessThanOrEqual(after);

    // Allowlisted fields must be present and accurate
    expect(extracted.quota).toEqual(fullPayload.quota);
    expect(extracted.plan_tier).toBe('pro_tier');
    expect(extracted.model).toEqual({ id: 'gemini-2.5-pro' });
    expect(extracted.context_window).toEqual(fullPayload.context_window);
    expect(extracted.conversation_id).toBe('conv-12345');
    expect(extracted.version).toBe('1.2.14');

    // Sensitive / non-allowlisted fields MUST be dropped
    expect((extracted as Record<string, unknown>).email).toBeUndefined();
    expect((extracted as Record<string, unknown>).cwd).toBeUndefined();
    expect((extracted as Record<string, unknown>).transcript_path).toBeUndefined();
    expect((extracted as Record<string, unknown>).vcs).toBeUndefined();
    expect((extracted as Record<string, unknown>).user).toBeUndefined();
    expect((extracted as Record<string, unknown>).messages).toBeUndefined();
    expect((extracted as Record<string, unknown>).extra_junk).toBeUndefined();

    // Nested model object should not leak extra properties like display_name or vendor
    expect(extracted.model.display_name).toBeUndefined();
    expect(extracted.model.vendor).toBeUndefined();
  });

  it('handles string model property by preserving id', () => {
    const payload = {
      model: 'gemini-2.5-flash',
    };
    const extracted = extractQuotaPayload(payload);
    expect(extracted.model).toEqual({ id: 'gemini-2.5-flash' });
  });

  it('gracefully handles missing, empty, or non-object inputs', () => {
    expect(extractQuotaPayload(null).capturedAtMs).toBeTypeOf('number');
    expect(extractQuotaPayload(undefined).capturedAtMs).toBeTypeOf('number');
    expect(extractQuotaPayload({}).capturedAtMs).toBeTypeOf('number');
    expect(Object.keys(extractQuotaPayload({}))).toEqual(['capturedAtMs']);
  });
});

describe('quota-sink.js atomic write and file handling', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-quota-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('atomically writes to <homeDir>/.wmux/quota/agy.json and leaves no tmp files', () => {
    const data = {
      capturedAtMs: Date.now(),
      quota: { remaining: 0.9 },
      plan_tier: 'free',
    };

    writeQuotaFile(data, tmpHome);

    const quotaDir = path.join(tmpHome, '.wmux', 'quota');
    const targetFile = path.join(quotaDir, 'agy.json');

    expect(fs.existsSync(targetFile)).toBe(true);
    const read = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    expect(read).toEqual(data);

    // Verify no temporary files remain in the quota directory
    const files = fs.readdirSync(quotaDir);
    expect(files).toEqual(['agy.json']);
  });
});

describe('quota-sink.js process execution and chaining', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-quota-proc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes quota file and outputs empty stdout when no original command is configured', () => {
    const payload = {
      quota: { bucket1: 0.5 },
      plan_tier: 'developer',
      email: 'do-not-leak@test.com',
      cwd: 'C:\\leak\\path',
    };

    const res = spawnSync(process.execPath, [SINK_SCRIPT, 'agy'], {
      input: JSON.stringify(payload),
      env: {
        ...process.env,
        WMUX_QUOTA_SINK_HOME: tmpHome,
      },
      encoding: 'utf8',
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toBe(''); // empty stdout

    const targetFile = path.join(tmpHome, '.wmux', 'quota', 'agy.json');
    expect(fs.existsSync(targetFile)).toBe(true);
    const written = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    expect(written.quota).toEqual({ bucket1: 0.5 });
    expect(written.plan_tier).toBe('developer');
    expect(written.email).toBeUndefined();
    expect(written.cwd).toBeUndefined();
  });

  it('chains to an original command passed via trailing argument, piping stdin through', () => {
    const payload = {
      quota: { percent: 99 },
    };

    // Helper script that reads stdin and writes back formatted text
    const helperScript = path.join(tmpHome, 'chained-helper.js');
    fs.writeFileSync(
      helperScript,
      'const fs = require("fs"); const raw = fs.readFileSync(0, "utf8"); const parsed = JSON.parse(raw); process.stdout.write("chained-pct:" + parsed.quota.percent);',
      'utf8',
    );

    const origCmd = `"${process.execPath}" "${helperScript}"`;

    const res = spawnSync(process.execPath, [SINK_SCRIPT, 'agy', origCmd], {
      input: JSON.stringify(payload),
      env: {
        ...process.env,
        WMUX_QUOTA_SINK_HOME: tmpHome,
      },
      encoding: 'utf8',
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toBe('chained-pct:99');

    // Verify agy.json was still written
    const targetFile = path.join(tmpHome, '.wmux', 'quota', 'agy.json');
    expect(fs.existsSync(targetFile)).toBe(true);
  });

  it('chains to an original command specified via WMUX_AGY_ORIGINAL_STATUSLINE env var', () => {
    const helperScript = path.join(tmpHome, 'env-helper.js');
    fs.writeFileSync(helperScript, 'process.stdout.write("env-chained");', 'utf8');

    const origCmd = `"${process.execPath}" "${helperScript}"`;

    const res = spawnSync(process.execPath, [SINK_SCRIPT, 'agy'], {
      input: JSON.stringify({ version: '1.0' }),
      env: {
        ...process.env,
        WMUX_QUOTA_SINK_HOME: tmpHome,
        WMUX_AGY_ORIGINAL_STATUSLINE: origCmd,
      },
      encoding: 'utf8',
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toBe('env-chained');
  });

  it('handles empty or malformed stdin gracefully without crashing or writing corrupt file', () => {
    const res = spawnSync(process.execPath, [SINK_SCRIPT, 'agy'], {
      input: 'not-valid-json',
      env: {
        ...process.env,
        WMUX_QUOTA_SINK_HOME: tmpHome,
      },
      encoding: 'utf8',
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
    const targetFile = path.join(tmpHome, '.wmux', 'quota', 'agy.json');
    expect(fs.existsSync(targetFile)).toBe(false);
  });
});

describe('resolveOriginalCommand helper', () => {
  it('resolves from WMUX_AGY_ORIGINAL_STATUSLINE env var first', () => {
    const cmd = resolveOriginalCommand(['node', 'quota-sink.js', 'agy', 'cli-arg'], {
      WMUX_AGY_ORIGINAL_STATUSLINE: 'env-cmd',
    });
    expect(cmd).toBe('env-cmd');
  });

  it('resolves from 4th CLI argument when argv[2] is agy', () => {
    const cmd = resolveOriginalCommand(['node', 'quota-sink.js', 'agy', 'my-command --flag'], {});
    expect(cmd).toBe('my-command --flag');
  });

  it('returns null when no original command is provided', () => {
    const cmd = resolveOriginalCommand(['node', 'quota-sink.js', 'agy'], {});
    expect(cmd).toBeNull();
  });
});
