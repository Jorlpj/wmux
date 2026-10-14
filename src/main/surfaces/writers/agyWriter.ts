import type { ResolvedChange, SurfaceWriter, WriterContext, WriterDeps } from './types';
import type { SurfaceApplyResult, SurfacePreview } from '../../../shared/tokenUsage/surfaceTypes';
import {
  applyConfigEdit,
  ConfigChangedError,
  rollbackWrittenFiles,
  snapshotFile,
  SurfacesStore,
  type WrittenFile,
} from '../safeWrite';
import { isPathAllowed, resolveTargetFile } from './agy/paths';
import { planEditsForFile } from './agy/edits';

const REFUSED_OUTSIDE = 'Refused to modify configuration outside allowed directories.';

/** Changes grouped by the file they land in; `refused` when one targets a file outside home and project. */
function changesByFile(changes: ResolvedChange[], deps: WriterDeps): { byFile: Map<string, ResolvedChange[]>; refused: boolean } {
  const byFile = new Map<string, ResolvedChange[]>();
  let refused = false;
  for (const change of changes) {
    const targetPath = resolveTargetFile(change.item, deps);
    if (!isPathAllowed(targetPath, deps)) {
      refused = true;
      continue;
    }
    byFile.set(targetPath, [...(byFile.get(targetPath) ?? []), change]);
  }
  return { byFile, refused };
}

/** Writes each file in turn; when one fails, the files written before it are put back. */
function writeFiles(
  byFile: Map<string, ResolvedChange[]>,
  deps: WriterDeps,
): { appliedItemIds: string[]; backups: string[]; error: string | null } {
  const appliedItemIds: string[] = [];
  const backups: string[] = [];
  const written: WrittenFile[] = [];
  for (const [targetPath, changes] of byFile.entries()) {
    const snapshot = snapshotFile(targetPath);
    const planned = planEditsForFile(targetPath, changes, snapshot.text);
    try {
      const res = applyConfigEdit({
        path: targetPath,
        kind: 'json',
        edits: planned.jsonEdits,
        backup: true,
        snapshot,
        now: deps.now(),
      });
      if (res.backupPath) {
        backups.push(res.backupPath);
      }
      if (res.changed) {
        written.push({
          path: targetPath,
          backupPath: res.backupPath,
          preExisted: snapshot.exists,
          postSnapshot: snapshotFile(targetPath),
        });
      }
      appliedItemIds.push(...planned.itemIds);
    } catch (err) {
      // Put back the files written before this one, so a failed apply changes nothing.
      const restored = rollbackWrittenFiles(written);
      return { appliedItemIds: [], backups, error: failureMessage(err, restored) };
    }
  }
  return { appliedItemIds, backups, error: null };
}

function failureMessage(err: unknown, restored: boolean): string {
  if (!restored) return 'Some files may have changed; check your agy settings.';
  if (err instanceof ConfigChangedError) return 'The configuration changed while editing; reload and try again.';
  return 'Applying the change failed; no file was left half-written.';
}

function recordIntents(ctx: WriterContext, appliedItemIds: string[]): void {
  try {
    const store = new SurfacesStore(ctx.deps.surfacesStorePath);
    store.load();
    for (const itemId of appliedItemIds) {
      const change = ctx.changes.find((c) => c.item.id === itemId);
      if (change) {
        store.recordIntent('agy', itemId, change.enabled);
      }
    }
    store.save();
  } catch {
    // A failing store must not fail the apply (ignore its warnings).
  }
}

export function createAgyWriter(): SurfaceWriter {
  return {
    provider: 'agy',

    async preview(ctx: WriterContext): Promise<Omit<SurfacePreview, 'rejected'>> {
      const edits = [];
      for (const [targetPath, changes] of changesByFile(ctx.changes, ctx.deps).byFile.entries()) {
        const planned = planEditsForFile(targetPath, changes);
        edits.push(...planned.previewEdits);
      }

      return {
        provider: 'agy',
        edits,
        requiresNewSession: true,
      };
    },

    async apply(ctx: WriterContext): Promise<SurfaceApplyResult> {
      const { byFile, refused } = changesByFile(ctx.changes, ctx.deps);
      if (byFile.size === 0) {
        return {
          provider: 'agy',
          ok: false,
          appliedItemIds: [],
          backups: [],
          error: refused ? REFUSED_OUTSIDE : 'Nothing to change.',
        };
      }

      const { appliedItemIds, backups, error } = writeFiles(byFile, ctx.deps);
      if (appliedItemIds.length > 0) {
        recordIntents(ctx, appliedItemIds);
      }
      return {
        provider: 'agy',
        ok: error === null && !refused,
        appliedItemIds,
        backups,
        error: error ?? (refused ? REFUSED_OUTSIDE : null),
      };
    },
  };
}
