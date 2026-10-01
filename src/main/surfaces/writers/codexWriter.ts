import type { SurfaceWriter } from './types';

export function createCodexWriter(): SurfaceWriter {
  return {
    provider: 'codex',
    async preview() {
      return { provider: 'codex', edits: [], requiresNewSession: true };
    },
    async apply() {
      return {
        provider: 'codex',
        ok: false,
        appliedItemIds: [],
        backups: [],
        error: 'Writing is not implemented for codex yet.',
      };
    },
  };
}
