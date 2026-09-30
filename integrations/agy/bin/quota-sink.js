// wmux-managed: agy-quota-sensor
// wmux ↔ Antigravity CLI (agy) quota sensor (statusLine hook sink).
//
// Registered as agy's `statusLine` command in ~/.gemini/antigravity-cli/settings.json:
//   "statusLine": {
//     "type": "command",
//     "command": "\"<node>\" \"<abs path to quota-sink.js>\" agy",
//     "enabled": true,
//     "stack_with_default": true
//   }
// agy spawns this command whenever agent state changes, feeding full JSON on stdin.
// Its stdout becomes the status line text.
//
// This script:
//   1. Reads full JSON payload from stdin.
//   2. Extracts ONLY allowlisted fields:
//        quota, plan_tier, model.id (nested under model: { id }), context_window,
//        conversation_id, version, capturedAtMs (Date.now()).
//      Explicitly drops email, cwd, transcript_path, vcs, and any other field (privacy).
//   3. Writes the subset atomically to <homeDir>/.wmux/quota/agy.json via tmp + rename.
//      homeDir is overridable via WMUX_QUOTA_SINK_HOME.
//   4. If an original statusLine command was chained (via trailing CLI arg or
//      WMUX_AGY_ORIGINAL_STATUSLINE env var), re-executes that command piping the
//      same stdin through to it, and prints its stdout verbatim.
//      If no original command is configured, prints nothing (empty stdout).
//   5. Exits 0 (or chained command's exit code).
//
// SELF-CONTAINED: Node built-ins only, no external dependencies, no imports from src/.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

/**
 * Extracts ONLY the allowlisted fields from agy's statusLine JSON payload.
 *
 * Allowlist:
 * - quota
 * - plan_tier
 * - model.id (nested under model: { id })
 * - context_window
 * - conversation_id
 * - version
 * - capturedAtMs: Date.now()
 *
 * Explicitly drops: email, cwd, transcript_path, vcs, and any other field.
 */
function extractQuotaPayload(input) {
  const result = {
    capturedAtMs: Date.now(),
  };

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return result;
  }

  if (input.quota !== undefined) {
    result.quota = input.quota;
  }
  if (input.plan_tier !== undefined) {
    result.plan_tier = input.plan_tier;
  }
  if (typeof input.model === 'string') {
    result.model = { id: input.model };
  } else if (input.model && typeof input.model === 'object' && !Array.isArray(input.model)) {
    if (input.model.id !== undefined) {
      result.model = { id: input.model.id };
    }
  }
  if (input.context_window !== undefined) {
    result.context_window = input.context_window;
  }
  if (input.conversation_id !== undefined) {
    result.conversation_id = input.conversation_id;
  }
  if (input.version !== undefined) {
    result.version = input.version;
  }

  return result;
}

/**
 * Resolves the target home directory.
 * Overridable via WMUX_QUOTA_SINK_HOME for testing without touching real user home.
 */
function getHomeDir(env = process.env) {
  return env.WMUX_QUOTA_SINK_HOME || env.USERPROFILE || env.HOME || os.homedir();
}

/**
 * Atomic rename with bounded retry for transient Windows file-lock errors.
 */
function renameWithRetry(from, to, maxAttempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = err && err.code;
      if (attempt >= maxAttempts || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) {
        throw err;
      }
      const ms = 10 * 2 ** (attempt - 1);
      const end = Date.now() + ms;
      while (Date.now() < end) {
        // sync wait
      }
    }
  }
}

/**
 * Writes the extracted quota payload atomically to <homeDir>/.wmux/quota/agy.json.
 */
function writeQuotaFile(data, homeDir = getHomeDir()) {
  const dir = path.join(homeDir, '.wmux', 'quota');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const dest = path.join(dir, 'agy.json');
  const tmp = path.join(dir, `agy.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    renameWithRetry(tmp, dest);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) {
        fs.unlinkSync(tmp);
      }
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Resolves the original command to chain to, if any.
 * Checks WMUX_AGY_ORIGINAL_STATUSLINE env var first, then trailing CLI args.
 */
function resolveOriginalCommand(argv = process.argv, env = process.env) {
  if (typeof env.WMUX_AGY_ORIGINAL_STATUSLINE === 'string' && env.WMUX_AGY_ORIGINAL_STATUSLINE.trim().length > 0) {
    return env.WMUX_AGY_ORIGINAL_STATUSLINE.trim();
  }
  if (Array.isArray(argv)) {
    if (argv[2] === 'agy') {
      if (argv.length === 4) {
        return argv[3].trim() || null;
      }
      if (argv.length > 4) {
        return argv.slice(3).join(' ').trim() || null;
      }
    } else if (argv.length === 3) {
      return argv[2].trim() || null;
    } else if (argv.length > 3) {
      return argv.slice(2).join(' ').trim() || null;
    }
  }
  return null;
}

/**
 * Executes the original command, piping inputStdin to it, and writing its stdout verbatim.
 * Returns the child's exit code.
 */
function runChainCommand(command, inputStdin) {
  try {
    const res = spawnSync(command, {
      shell: true,
      input: inputStdin,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
      env: process.env,
    });
    if (res.stdout) {
      process.stdout.write(res.stdout);
    }
    if (res.status !== null && res.status !== undefined) {
      return res.status;
    }
    return 0;
  } catch {
    return 1;
  }
}

/**
 * Main entrypoint for quota-sink.
 */
function runQuotaSink() {
  let rawStdin = '';
  try {
    rawStdin = fs.readFileSync(0, 'utf8');
  } catch {
    rawStdin = '';
  }

  let payload = null;
  if (rawStdin.trim().length > 0) {
    try {
      payload = JSON.parse(rawStdin);
    } catch {
      payload = null;
    }
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    try {
      const extracted = extractQuotaPayload(payload);
      writeQuotaFile(extracted);
    } catch {
      // Do not let write failure abort statusLine hook or block chaining
    }
  }

  const originalCmd = resolveOriginalCommand(process.argv, process.env);
  if (originalCmd) {
    const exitCode = runChainCommand(originalCmd, rawStdin);
    process.exit(exitCode);
  }
}

module.exports = {
  extractQuotaPayload,
  getHomeDir,
  writeQuotaFile,
  renameWithRetry,
  resolveOriginalCommand,
  runChainCommand,
  runQuotaSink,
};

if (require.main === module) {
  runQuotaSink();
}
