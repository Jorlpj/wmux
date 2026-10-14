// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/xterm';
import {
  createDeadWheelWatchdog,
  isReportedWheel,
  readXtermMouseEncoding,
  DEAD_WHEEL_THRESHOLD_DEFAULT,
  DEAD_WHEEL_WINDOW_MS_DEFAULT,
  DEAD_WHEEL_COOLDOWN_MS_DEFAULT,
  type DeadWheelReport,
  type DeadWheelSample,
} from '../deadWheelWatchdog';

// A Windows mouse notch over a Codex pane whose SGR flag was lost (#1843).
const notch = (s: Partial<DeadWheelSample> = {}): DeadWheelSample => ({
  deltaY: 100,
  deltaMode: 0,
  modified: false,
  defaultPrevented: false,
  tracking: 'any',
  encoding: 'DEFAULT',
  buffer: 'alternate',
  ...s,
});

const setup = () => {
  let t = 0;
  const reports: DeadWheelReport[] = [];
  const w = createDeadWheelWatchdog({ report: (r) => reports.push(r), now: () => t });
  /** One wheel, then whatever xterm emits for it, then 150ms. */
  const wheel = (s: Partial<DeadWheelSample> = {}, after?: 'data' | 'binary' | 'guard') => {
    w.onWheel(notch(s));
    if (after === 'data') w.onData();
    if (after === 'binary') w.onBinary();
    if (after === 'guard') w.onGuardDrop();
    t += 150;
  };
  return { w, reports, wheel, advance: (ms: number) => { t += ms; } };
};

describe('deadWheelWatchdog (#1843)', () => {
  it('reports wheels whose reports only went to onBinary, once per episode', () => {
    const { reports, wheel } = setup();
    for (let i = 0; i < 4; i++) wheel({}, 'binary');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({
      wheelCount: 3,
      spanMs: 450,
      tracking: ['any'],
      encodings: ['DEFAULT'],
      buffers: ['alternate'],
      binaryCount: 3,
      guardDropped: 0,
    });
  });

  it('never reports a healthy SGR pane: every report reaches onData', () => {
    const { reports, wheel } = setup();
    for (let i = 0; i < 20; i++) wheel({ encoding: 'SGR' }, 'data');
    expect(reports).toHaveLength(0);
  });

  it('counts reports the prompt-mode guard dropped', () => {
    const { reports, wheel } = setup();
    for (let i = 0; i < 4; i++) wheel({ encoding: 'SGR' }, 'guard');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ encodings: ['SGR'], binaryCount: 0, guardDropped: 3 });
  });

  it('reports wheels that produced nothing at all', () => {
    const { reports, wheel } = setup();
    for (let i = 0; i < 4; i++) wheel({ encoding: 'SGR' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ binaryCount: 0, guardDropped: 0 });
  });

  it('a fast burst shorter than the window does not report', () => {
    const { w, reports } = setup();
    for (let i = 0; i < 10; i++) w.onWheel(notch());
    expect(reports).toHaveLength(0);
  });

  it('waits out the cooldown before a second report', () => {
    const { reports, wheel, advance } = setup();
    for (let i = 0; i < 8; i++) wheel({}, 'binary');
    expect(reports).toHaveLength(1);
    advance(DEAD_WHEEL_COOLDOWN_MS_DEFAULT);
    for (let i = 0; i < 4; i++) wheel({}, 'binary');
    expect(reports).toHaveLength(2);
  });

  it('a new episode after onData does not inherit the previous one', () => {
    const { w, reports, wheel } = setup();
    wheel({ tracking: 'vt200', buffer: 'normal' }, 'binary');
    wheel({ tracking: 'vt200', buffer: 'normal' }, 'binary');
    w.onData();
    for (let i = 0; i < 4; i++) wheel({ encoding: 'SGR' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ tracking: ['any'], encodings: ['SGR'], buffers: ['alternate'], binaryCount: 0 });
  });

  it('onBinary and guard drops outside an episode are not carried into the next', () => {
    const { w, reports, wheel } = setup();
    w.onBinary();
    w.onGuardDrop();
    for (let i = 0; i < 4; i++) wheel({ encoding: 'SGR' });
    expect(reports[0]).toMatchObject({ binaryCount: 0, guardDropped: 0 });
  });

  it('ignores wheels xterm does not report, without resetting the episode', () => {
    const { reports, wheel } = setup();
    wheel({}, 'binary');
    wheel({ tracking: 'none' });
    wheel({ tracking: 'x10' });
    wheel({ modified: true });
    wheel({ defaultPrevented: true });
    wheel({ deltaY: 4 });
    wheel({ deltaY: 0 });
    expect(reports).toHaveLength(0);
    wheel({}, 'binary');
    wheel({}, 'binary');
    wheel({}, 'binary');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ wheelCount: 3, tracking: ['any'] });
  });

  it('isReportedWheel: notch-sized plain wheels under vt200/drag/any', () => {
    for (const tracking of ['vt200', 'drag', 'any']) expect(isReportedWheel(notch({ tracking }))).toBe(true);
    for (const tracking of ['none', 'x10']) expect(isReportedWheel(notch({ tracking }))).toBe(false);
    expect(isReportedWheel(notch({ deltaY: -100 }))).toBe(true);
    expect(isReportedWheel(notch({ deltaY: 49 }))).toBe(false);
    expect(isReportedWheel(notch({ deltaY: 1, deltaMode: 1 }))).toBe(true);
    expect(isReportedWheel(notch({ deltaY: 1, deltaMode: 2 }))).toBe(true);
  });

  it('dispose stops all reporting', () => {
    const { w, reports, wheel } = setup();
    w.dispose();
    for (let i = 0; i < 8; i++) wheel();
    expect(reports).toHaveLength(0);
  });

  it('defaults stay small enough to catch a short scroll attempt', () => {
    expect(DEAD_WHEEL_THRESHOLD_DEFAULT).toBeLessThanOrEqual(4);
    expect(DEAD_WHEEL_WINDOW_MS_DEFAULT).toBeLessThanOrEqual(500);
    expect(DEAD_WHEEL_COOLDOWN_MS_DEFAULT).toBeGreaterThanOrEqual(1000);
  });
});

describe('readXtermMouseEncoding against the bundled xterm (#1843)', () => {
  const write = (term: Terminal, data: string) => new Promise<void>((r) => term.write(data, r));

  it('reads DEFAULT, then SGR after ?1006h, and DEFAULT again after ?1006l', async () => {
    const term = new Terminal({ allowProposedApi: true });
    try {
      expect(readXtermMouseEncoding(term)).toBe('DEFAULT');
      await write(term, '\x1b[?1003;1006h');
      expect(term.modes.mouseTrackingMode).toBe('any');
      expect(readXtermMouseEncoding(term)).toBe('SGR');
      await write(term, '\x1b[?1006l');
      expect(readXtermMouseEncoding(term)).toBe('DEFAULT');
    } finally {
      term.dispose();
    }
  });

  it('answers ? for anything that is not an xterm with that private field', () => {
    expect(readXtermMouseEncoding({})).toBe('?');
    expect(readXtermMouseEncoding(null)).toBe('?');
    expect(readXtermMouseEncoding({ _core: { mouseStateService: { activeEncoding: '' } } })).toBe('?');
  });
});
