import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getWmuxHomeDir } from '../../shared/constants';
import { getWmuxDir } from '../../daemon/config';

describe('isolateDataDir setup', () => {
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origDataSuffix = process.env.WMUX_DATA_SUFFIX;

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;

    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;

    if (origDataSuffix === undefined) delete process.env.WMUX_DATA_SUFFIX;
    else process.env.WMUX_DATA_SUFFIX = origDataSuffix;
  });

  it('inside the suite os.homedir() is under os.tmpdir() and WMUX_DATA_SUFFIX is -vitest', () => {
    const homedir = os.homedir();
    const tmpdir = os.tmpdir();
    const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    expect(norm(homedir).startsWith(norm(tmpdir))).toBe(true);
    expect(process.env.WMUX_DATA_SUFFIX).toBe('-vitest');
  });

  it('getWmuxHomeDir() does not equal the real home path', () => {
    const realHome = process.env.WMUX_TEST_REAL_HOME;
    expect(realHome).toBeDefined();
    if (!realHome) return;
    const wmuxHome = getWmuxHomeDir();
    const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    expect(norm(wmuxHome)).not.toBe(norm(realHome));
    expect(norm(wmuxHome)).not.toBe(norm(path.join(realHome, '.wmux')));
  });

  it('with WMUX_DATA_SUFFIX deleted and HOME/USERPROFILE set to WMUX_TEST_REAL_HOME, getWmuxHomeDir() throws the refusal', () => {
    const realHome = process.env.WMUX_TEST_REAL_HOME;
    expect(realHome).toBeDefined();
    if (!realHome) return;

    delete process.env.WMUX_DATA_SUFFIX;
    process.env.HOME = realHome;
    process.env.USERPROFILE = realHome;

    expect(() => getWmuxHomeDir()).toThrow('Refusing to touch the live wmux data dir from a test');
    expect(() => getWmuxDir()).toThrow('Refusing to touch the live wmux data dir from a test');
  });
});
