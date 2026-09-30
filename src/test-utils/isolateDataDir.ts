import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Save the real home before overriding; do not overwrite if already set.
if (!process.env.WMUX_TEST_REAL_HOME) {
  process.env.WMUX_TEST_REAL_HOME = os.homedir();
}

// mkdtempSync a directory under os.tmpdir() ('wmux-test-'), set HOME and USERPROFILE,
// and default WMUX_DATA_SUFFIX to '-vitest'.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-test-'));
process.env.HOME = tempDir;
process.env.USERPROFILE = tempDir;
process.env.WMUX_DATA_SUFFIX ??= '-vitest';

// Register best-effort removal of the temp dir on process exit (never throw).
process.once('exit', () => {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup on exit; never throw.
  }
});
