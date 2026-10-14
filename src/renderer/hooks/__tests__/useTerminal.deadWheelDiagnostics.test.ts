import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Source-level lock for the #1843 dead-wheel diagnostics. Like the #1950
 * dead-input lock, it pins the wiring in useTerminal: jsdom has no layout, so
 * xterm cannot turn a DOM wheel into a mouse report there.
 */

const SRC = readFileSync(
  path.resolve(process.cwd(), 'src/renderer/hooks/useTerminal.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('useTerminal dead-wheel diagnostics (#1843, source-level lock)', () => {
  it('the wheel listener is a passive capture listener on the xterm element, removed with the same capture flag', () => {
    expect(SRC).toContain("terminal.element?.addEventListener('wheel', onWatchdogWheel, { capture: true, passive: true });");
    expect(SRC).toContain("terminal.element?.removeEventListener('wheel', onWatchdogWheel, true);");
  });

  it('the wheel sample carries the tracking mode, encoding, buffer and what other handlers did', () => {
    const start = SRC.indexOf('const onWatchdogWheel = (e: Event): void => {');
    expect(start).toBeGreaterThan(-1);
    const listener = SRC.slice(start, SRC.indexOf("terminal.element?.addEventListener('wheel'", start));
    expect(listener).toMatch(/defaultPrevented: we\.defaultPrevented/);
    expect(listener).toMatch(/modified: we\.ctrlKey \|\| we\.altKey \|\| we\.shiftKey \|\| we\.metaKey/);
    expect(listener).toMatch(/\.modes\?\.mouseTrackingMode \?\? 'none'/);
    expect(listener).toMatch(/encoding: readXtermMouseEncoding\(terminal\)/);
    expect(listener).toMatch(/buffer: terminal\.buffer\.active\.type/);
  });

  it('onBinary only counts, and the subscription is disposed', () => {
    expect(SRC).toContain('const onBinaryDisposable = terminal.onBinary(() => deadWheelWatchdog.onBinary());');
    expect(SRC).toMatch(/deadWheelWatchdog\.dispose\(\);\s*onBinaryDisposable\.dispose\(\);/);
  });

  it('every byte bound for the PTY resets the episode, and a guard drop is counted', () => {
    const start = SRC.indexOf('const noteUserKeystroke = (data: string) => {');
    expect(start).toBeGreaterThan(-1);
    expect(SRC.slice(start, SRC.indexOf('};', start))).toContain('deadWheelWatchdog.onData();');
    expect(SRC).toMatch(/if \(promptModeGuard\.dropsReport\(data\)\) \{\s*deadWheelWatchdog\.onGuardDrop\(\);\s*return;\s*\}/);
  });

  it('the log line carries every field', () => {
    const start = SRC.indexOf('`[wmux:dead-wheel] pty=');
    expect(start).toBeGreaterThan(-1);
    const line = SRC.slice(start, SRC.indexOf(');', start));
    for (const field of ['tracking=', 'encoding=', 'buffer=', 'onBinary=', 'guardDropped=', 'agent=']) {
      expect(line).toContain(field);
    }
  });
});
