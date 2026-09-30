import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sweepOrphanAtomicTemps } from '../sweep';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-sweep-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sweepOrphanAtomicTemps', () => {
  it('promotes valid temp with missing primary to primary by rename', () => {
    // Primary deck-work.json is missing
    const tempFile = 'deck-work.json.tmp.999999.1';
    const tempPath = path.join(tmpDir, tempFile);
    fs.writeFileSync(tempPath, JSON.stringify({ version: 1, active: {} }));

    const logs: string[] = [];
    const report = sweepOrphanAtomicTemps(tmpDir, { log: (l) => logs.push(l) });

    expect(report.promoted).toEqual([tempFile]);
    expect(report.deleted).toEqual([]);
    expect(report.left).toEqual([]);

    const primaryPath = path.join(tmpDir, 'deck-work.json');
    expect(fs.existsSync(primaryPath)).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(JSON.parse(fs.readFileSync(primaryPath, 'utf8'))).toEqual({ version: 1, active: {} });
    expect(logs.some((l) => l.includes('promoted'))).toBe(true);
  });

  it('leaves invalid JSON temp untouched when primary is missing', () => {
    const tempFile = 'deck-work.json.tmp.999999.1';
    const tempPath = path.join(tmpDir, tempFile);
    fs.writeFileSync(tempPath, '{ broken json content');

    const logs: string[] = [];
    const report = sweepOrphanAtomicTemps(tmpDir, { log: (l) => logs.push(l) });

    expect(report.promoted).toEqual([]);
    expect(report.deleted).toEqual([]);
    expect(report.left).toEqual([tempFile]);

    const primaryPath = path.join(tmpDir, 'deck-work.json');
    expect(fs.existsSync(primaryPath)).toBe(false);
    expect(fs.existsSync(tempPath)).toBe(true);
    expect(logs.some((l) => l.includes('left unparseable temp'))).toBe(true);
  });

  it('deletes temp with existing primary', () => {
    const primaryPath = path.join(tmpDir, 'deck-work.json');
    fs.writeFileSync(primaryPath, JSON.stringify({ version: 1, active: {} }));

    const tempFile = 'deck-work.json.tmp.999999.1';
    const tempPath = path.join(tmpDir, tempFile);
    fs.writeFileSync(tempPath, JSON.stringify({ version: 1, active: {} }));

    const logs: string[] = [];
    const report = sweepOrphanAtomicTemps(tmpDir, { log: (l) => logs.push(l) });

    expect(report.promoted).toEqual([]);
    expect(report.deleted).toEqual([tempFile]);
    expect(report.left).toEqual([]);

    expect(fs.existsSync(primaryPath)).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(logs.some((l) => l.includes('deleted dead temp with existing primary'))).toBe(true);
  });

  it('leaves temp owned by a live pid (process.pid) untouched', () => {
    const tempFile = `deck-work.json.tmp.${process.pid}.1`;
    const tempPath = path.join(tmpDir, tempFile);
    fs.writeFileSync(tempPath, JSON.stringify({ version: 1, active: {} }));

    const logs: string[] = [];
    const report = sweepOrphanAtomicTemps(tmpDir, { log: (l) => logs.push(l) });

    expect(report.promoted).toEqual([]);
    expect(report.deleted).toEqual([]);
    expect(report.left).toEqual([tempFile]);

    expect(fs.existsSync(tempPath)).toBe(true);
    expect(logs.some((l) => l.includes('skipped live-pid temp'))).toBe(true);
  });

  it('promotes only the newest of two temps when primary is missing', () => {
    const olderFile = 'deck-schedules.json.tmp.999998.1';
    const newerFile = 'deck-schedules.json.tmp.999999.2';
    const olderPath = path.join(tmpDir, olderFile);
    const newerPath = path.join(tmpDir, newerFile);

    // Older schedule list
    fs.writeFileSync(olderPath, JSON.stringify([{ id: 'sched-1', prompt: 'old' }]));
    // Set older mtime
    const past = new Date(Date.now() - 100000);
    fs.utimesSync(olderPath, past, past);

    // Newer schedule list
    fs.writeFileSync(newerPath, JSON.stringify([{ id: 'sched-1', prompt: 'new' }]));
    const recent = new Date(Date.now() - 1000);
    fs.utimesSync(newerPath, recent, recent);

    const logs: string[] = [];
    const report = sweepOrphanAtomicTemps(tmpDir, { log: (l) => logs.push(l) });

    expect(report.promoted).toEqual([newerFile]);
    expect(report.deleted).toEqual([olderFile]);
    expect(report.left).toEqual([]);

    const primaryPath = path.join(tmpDir, 'deck-schedules.json');
    expect(fs.existsSync(primaryPath)).toBe(true);
    expect(fs.existsSync(olderPath)).toBe(false);
    expect(fs.existsSync(newerPath)).toBe(false);

    const promotedContent = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
    expect(promotedContent).toEqual([{ id: 'sched-1', prompt: 'new' }]);
  });

  it('rejects promotion if root type does not match expected store type (e.g. array expected for schedules)', () => {
    const tempFile = 'deck-schedules.json.tmp.999999.1';
    const tempPath = path.join(tmpDir, tempFile);
    // deck-schedules.json expects array, give it an object
    fs.writeFileSync(tempPath, JSON.stringify({ not: 'an array' }));

    const report = sweepOrphanAtomicTemps(tmpDir);
    expect(report.promoted).toEqual([]);
    expect(report.left).toEqual([tempFile]);
    expect(fs.existsSync(path.join(tmpDir, 'deck-schedules.json'))).toBe(false);
  });

  it('rejects promotion if root type does not match expected store type (e.g. object expected for work)', () => {
    const tempFile = 'deck-work.json.tmp.999999.1';
    const tempPath = path.join(tmpDir, tempFile);
    // deck-work.json expects object, give it an array
    fs.writeFileSync(tempPath, JSON.stringify(['not', 'an', 'object']));

    const report = sweepOrphanAtomicTemps(tmpDir);
    expect(report.promoted).toEqual([]);
    expect(report.left).toEqual([tempFile]);
    expect(fs.existsSync(path.join(tmpDir, 'deck-work.json'))).toBe(false);
  });

  it('handles non-existent dir gracefully without throwing', () => {
    const nonExistent = path.join(tmpDir, 'non-existent-dir');
    const report = sweepOrphanAtomicTemps(nonExistent);
    expect(report).toEqual({ promoted: [], deleted: [], left: [] });
  });

  it('ignores non-temp files in dir', () => {
    fs.writeFileSync(path.join(tmpDir, 'regular.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'deck-work.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'temp.tmp'), 'not matching pattern');

    const report = sweepOrphanAtomicTemps(tmpDir);
    expect(report).toEqual({ promoted: [], deleted: [], left: [] });
    expect(fs.existsSync(path.join(tmpDir, 'regular.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'deck-work.json'))).toBe(true);
  });
});
