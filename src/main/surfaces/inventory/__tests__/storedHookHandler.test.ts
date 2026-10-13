import { describe, expect, it } from 'vitest';
import { storedHookHandler } from '../helpers';

// One reader for a stored removed-hook definition, shared by the inventory
// (is the removed hook live again?) and the Claude hook writer (restore it).
describe('storedHookHandler', () => {
  it('returns the nested handler object as is', () => {
    const handler = { type: 'command', command: 'check.sh' };
    expect(storedHookHandler({ event: 'PreToolUse', handler, groupMeta: { matcher: 'Bash' } })).toBe(handler);
  });

  it('reads the older flat form: every field but event and groupMeta', () => {
    expect(storedHookHandler({ event: 'Stop', groupMeta: { matcher: '' }, type: 'command', command: 'x', timeout: 5 }))
      .toEqual({ type: 'command', command: 'x', timeout: 5 });
  });

  it('treats an array or a scalar handler as the flat form', () => {
    expect(storedHookHandler({ event: 'Stop', handler: ['x'] })).toEqual({ handler: ['x'] });
    expect(storedHookHandler({ event: 'Stop', handler: 'x' })).toEqual({ handler: 'x' });
    expect(storedHookHandler({ event: 'Stop', handler: null })).toEqual({ handler: null });
  });
});
