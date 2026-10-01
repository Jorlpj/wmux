import type { SurfaceWriter } from './types';

export function createClaudeWriter(): SurfaceWriter {
  return {
    provider: 'claude',
    async preview() {
      return { provider: 'claude', edits: [], requiresNewSession: true };
    },
    async apply() {
      return {
        provider: 'claude',
        ok: false,
        appliedItemIds: [],
        backups: [],
        error: 'Writing is not implemented for claude yet.',
      };
    },
  };
}
