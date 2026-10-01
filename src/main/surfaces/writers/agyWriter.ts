import type { SurfaceWriter } from './types';

export function createAgyWriter(): SurfaceWriter {
  return {
    provider: 'agy',
    async preview() {
      return { provider: 'agy', edits: [], requiresNewSession: true };
    },
    async apply() {
      return {
        provider: 'agy',
        ok: false,
        appliedItemIds: [],
        backups: [],
        error: 'Writing is not implemented for agy yet.',
      };
    },
  };
}
