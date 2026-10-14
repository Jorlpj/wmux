// Diagnostic-only watchdog for "the wheel does nothing in this pane" (#1843:
// long-running Codex panes on Windows stop scrolling and plain drag stops
// selecting, while keys and PageUp/PageDown still work). Like the dead-input
// watchdog (#1950) it attempts no recovery; it logs the evidence that tells the
// candidate causes apart the next time it happens in the wild.
//
// While the foreground app tracks the mouse, xterm turns every wheel notch over
// the pane into a mouse report instead of scrolling. In the SGR encoding
// (`?1006h`) that report comes out of `terminal.onData` and reaches the PTY. In
// xterm's DEFAULT (X10-style) encoding it comes out of `terminal.onBinary`,
// which wmux does not forward, so the app never hears the wheel and xterm does
// not scroll either. A daemon snapshot that dropped the SGR flag of a combined
// `?1003;1006h` produced exactly that (sandbox, see docs on #1843).
//
// Signal: several notch-sized wheel events while xterm reports the mouse, and
// none of them produced `onData` within a time window. The report carries the
// tracking mode, xterm's active mouse encoding, the active buffer, and how many
// reports went to `onBinary` or were dropped by the #1794 prompt-mode guard
// instead, so one log line says which of those it was. An app that receives the
// reports and ignores them is NOT reported: the bytes reached the PTY.
//
// What is deliberately not counted, so a healthy pane never self-reports:
//   - wheels while tracking is off (`none`) or X10 (`?9h`, which never reports
//     the wheel): xterm scrolls locally;
//   - wheels with a modifier, or with no vertical delta (xterm does not report
//     those as plain wheel notches);
//   - small pixel deltas (trackpads): xterm accumulates them and may send no
//     report for many events. A mouse notch is 100 px on Windows; 50 px is
//     where xterm's own wheel scaling stops damping the delta;
//   - wheels another wmux handler already took (`defaultPrevented`, e.g. the
//     alt-screen PageUp/PageDown mapping for Grok, which writes to the PTY
//     itself).
//
// This module never touches the terminal. Pure logic with an injectable clock.
// Rate-limited so one stuck pane logs once per cooldown, not per notch.

/** xterm `modes.mouseTrackingMode` values under which a wheel is reported. */
const WHEEL_REPORTING_MODES: ReadonlySet<string> = new Set(['vt200', 'drag', 'any']);

/** |deltaY| in pixels from which one event is a wheel notch, not trackpad drift. */
export const DEAD_WHEEL_MIN_PIXEL_DELTA = 50;

/** WheelEvent.deltaMode for pixels. */
const DOM_DELTA_PIXEL = 0;

export interface DeadWheelSample {
  deltaY: number;
  deltaMode: number;
  /** Any of Ctrl/Alt/Shift/Meta held. */
  modified: boolean;
  defaultPrevented: boolean;
  /** xterm `modes.mouseTrackingMode` (`none`, `x10`, `vt200`, `drag`, `any`). */
  tracking: string;
  /** xterm's active mouse encoding (`DEFAULT`, `SGR`, ...), `?` if unreadable. */
  encoding: string;
  /** `buffer.active.type` (`normal` / `alternate`). */
  buffer: string;
}

export interface DeadWheelReport {
  /** Counted wheel events since a report last reached the PTY. */
  wheelCount: number;
  /** Span from the first unanswered wheel to the report, in ms. */
  spanMs: number;
  /** Distinct tracking modes seen. */
  tracking: string[];
  /** Distinct mouse encodings seen. */
  encodings: string[];
  /** Distinct active buffers seen. */
  buffers: string[];
  /** Reports xterm emitted through `onBinary` (DEFAULT encoding) meanwhile. */
  binaryCount: number;
  /** Reports the #1794 prompt-mode guard dropped meanwhile. */
  guardDropped: number;
}

/** Whether xterm would answer this wheel with at least one mouse report. */
export function isReportedWheel(s: DeadWheelSample): boolean {
  if (s.defaultPrevented || s.modified || s.deltaY === 0) return false;
  if (!WHEEL_REPORTING_MODES.has(s.tracking)) return false;
  if (s.deltaMode === DOM_DELTA_PIXEL && Math.abs(s.deltaY) < DEAD_WHEEL_MIN_PIXEL_DELTA) return false;
  return true;
}

/**
 * xterm's active mouse encoding (`MouseStateService.activeEncoding`), for the
 * log only. Private API: `?` when this xterm build does not have it.
 */
export function readXtermMouseEncoding(terminal: unknown): string {
  try {
    const encoding = (terminal as {
      _core?: { mouseStateService?: { activeEncoding?: unknown } };
    })._core?.mouseStateService?.activeEncoding;
    return typeof encoding === 'string' && encoding !== '' ? encoding : '?';
  } catch {
    return '?';
  }
}

export interface DeadWheelWatchdogOptions {
  /** Called once per episode when the wheel reaches nothing. */
  report: (info: DeadWheelReport) => void;
  /** Unanswered wheel notches required before a report fires. Default 3. */
  threshold?: number;
  /** The unanswered notches must span at least this long. Default 300ms. */
  windowMs?: number;
  /** Minimum gap between reports. Default 10s. */
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export const DEAD_WHEEL_THRESHOLD_DEFAULT = 3;
export const DEAD_WHEEL_WINDOW_MS_DEFAULT = 300;
export const DEAD_WHEEL_COOLDOWN_MS_DEFAULT = 10_000;

export interface DeadWheelWatchdog {
  /** A wheel event reached the terminal, before xterm handled it. */
  onWheel(sample: DeadWheelSample): void;
  /** xterm data reached the PTY path (a mouse report or a key): reset. */
  onData(): void;
  /** xterm emitted a report through `onBinary`, which goes nowhere. */
  onBinary(): void;
  /** The prompt-mode guard dropped a report before the PTY. */
  onGuardDrop(): void;
  /** Drop all state (no-op after). */
  dispose(): void;
}

export function createDeadWheelWatchdog(options: DeadWheelWatchdogOptions): DeadWheelWatchdog {
  const {
    report,
    threshold = DEAD_WHEEL_THRESHOLD_DEFAULT,
    windowMs = DEAD_WHEEL_WINDOW_MS_DEFAULT,
    cooldownMs = DEAD_WHEEL_COOLDOWN_MS_DEFAULT,
    now = Date.now,
  } = options;

  let disposed = false;
  let count = 0;
  let firstAt = 0;
  let binaryCount = 0;
  let guardDropped = 0;
  const tracking = new Set<string>();
  const encodings = new Set<string>();
  const buffers = new Set<string>();
  let lastReportAt = -Infinity;

  const reset = (): void => {
    count = 0;
    firstAt = 0;
    binaryCount = 0;
    guardDropped = 0;
    tracking.clear();
    encodings.clear();
    buffers.clear();
  };

  return {
    onWheel(sample: DeadWheelSample): void {
      if (disposed) return;
      // Not a wheel xterm reports: it scrolls locally or another handler
      // took it. Neither evidence nor activity.
      if (!isReportedWheel(sample)) return;
      const t = now();
      // xterm reports this wheel synchronously after this listener returns, so
      // the check below only sees the earlier, still unanswered notches.
      const spanMs = count === 0 ? 0 : t - firstAt;
      if (count >= threshold && spanMs >= windowMs && t - lastReportAt >= cooldownMs) {
        lastReportAt = t;
        const info: DeadWheelReport = {
          wheelCount: count,
          spanMs,
          tracking: [...tracking],
          encodings: [...encodings],
          buffers: [...buffers],
          binaryCount,
          guardDropped,
        };
        reset();
        report(info);
      }
      if (count === 0) firstAt = t;
      count += 1;
      tracking.add(sample.tracking);
      encodings.add(sample.encoding);
      buffers.add(sample.buffer);
    },

    onData(): void {
      if (disposed) return;
      reset();
    },

    onBinary(): void {
      if (disposed || count === 0) return;
      binaryCount += 1;
    },

    onGuardDrop(): void {
      if (disposed || count === 0) return;
      guardDropped += 1;
    },

    dispose(): void {
      disposed = true;
      reset();
    },
  };
}
