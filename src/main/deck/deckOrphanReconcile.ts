// ─── Command Deck — Startup Orphan Reconcile (WMX-06) ────────────────────────
//
// Reconciles orphan Deck state at startup:
//   - Identifies workspaces that no longer exist in wmux (not in liveWorkspaceIds)
//   - Archives active work records to deck-work.archive.json before teardown
//   - Applies parked-work TTL (72 hours) so only expired orphan work is purged;
//     parked work of a live workspace is never touched
//   - Calls teardownWorkspaceDeckState to clean up loop state, schedules,
//     autonomy, decisions, and commander sessions for orphan workspaces
//   - Fail-closed: does nothing if liveWorkspaceIds is null or empty
//   - Never throws

import { atomicReadJSONSync } from '../../daemon/util/atomicWrite';
import {
  getDeckWorkPath,
  loadActiveDeckWorks,
  isDeckWorkParked,
  archiveDeckWork,
} from './deckWorkStore';
import { getDeckLoopStatePath } from './deckLoopStateStore';
import { getDeckAutonomyPath } from './deckAutonomyStore';
import { getCommanderSessionPath } from './commanderSessionStore';
import { getDeckDecisionPath } from './deckDecisionStore';
import { getDeckSchedulesPath } from './deckScheduleStore';
import { teardownWorkspaceDeckState } from './deckWorkspaceTeardown';
import { getWorkspaceMirror } from '../workspace/WorkspaceMirror';
import { DEFAULT_MAX_SNAPSHOT_AGE_MS } from './stopGate';

export const PARKED_WORK_TTL_HOURS = 72;

const WORKSPACE_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

export interface OrphanReport {
  orphans: string[];
  archived: string[];
  skipped?: string;
}

export interface OrphanReconcileOptions {
  dir?: string;
  now?: number;
  log?: (line: string) => void;
  dryRun?: boolean;
  parkedWorkTtlHours?: number;
}

/**
 * Collect every workspace ID matching WORKSPACE_ID_RE present across all six
 * Deck store files:
 *   1. deck-work.json (keys in active)
 *   2. deck-loop-state.json (keys in map)
 *   3. deck-autonomy.json (keys in map)
 *   4. deck-commander.json (session keys <id> or <id>::...)
 *   5. deck-decisions.json (keys in map)
 *   6. deck-schedules.json (workspaceId of each schedule)
 */
export function collectDeckWorkspaceIds(dir?: string): Set<string> {
  const ids = new Set<string>();

  // 1. deck-work.json
  try {
    const raw = atomicReadJSONSync<unknown>(getDeckWorkPath(dir));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const active = (raw as Record<string, unknown>).active;
      if (active && typeof active === 'object' && !Array.isArray(active)) {
        for (const k of Object.keys(active)) {
          if (WORKSPACE_ID_RE.test(k)) ids.add(k);
        }
      }
    }
  } catch {
    // Missing or corrupt file is fine
  }

  // 2. deck-loop-state.json
  try {
    const raw = atomicReadJSONSync<unknown>(getDeckLoopStatePath(dir));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw as Record<string, unknown>)) {
        if (WORKSPACE_ID_RE.test(k)) ids.add(k);
      }
    }
  } catch {
    // Missing or corrupt file is fine
  }

  // 3. deck-autonomy.json
  try {
    const raw = atomicReadJSONSync<unknown>(getDeckAutonomyPath(dir));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw as Record<string, unknown>)) {
        if (WORKSPACE_ID_RE.test(k)) ids.add(k);
      }
    }
  } catch {
    // Missing or corrupt file is fine
  }

  // 4. deck-commander.json
  try {
    const raw = atomicReadJSONSync<unknown>(getCommanderSessionPath(dir));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const sessions = (raw as Record<string, unknown>).sessions;
      if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
        for (const k of Object.keys(sessions as Record<string, unknown>)) {
          const candidate = k.includes('::') ? k.split('::')[0] : k;
          if (WORKSPACE_ID_RE.test(candidate)) ids.add(candidate);
        }
      }
    }
  } catch {
    // Missing or corrupt file is fine
  }

  // 5. deck-decisions.json
  try {
    const raw = atomicReadJSONSync<unknown>(getDeckDecisionPath(dir));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw as Record<string, unknown>)) {
        if (WORKSPACE_ID_RE.test(k)) ids.add(k);
      }
    }
  } catch {
    // Missing or corrupt file is fine
  }

  // 6. deck-schedules.json
  try {
    const raw = atomicReadJSONSync<unknown>(getDeckSchedulesPath(dir));
    if (Array.isArray(raw)) {
      for (const s of raw) {
        if (s && typeof s === 'object') {
          const wsId = (s as Record<string, unknown>).workspaceId;
          if (typeof wsId === 'string' && WORKSPACE_ID_RE.test(wsId)) {
            ids.add(wsId);
          }
        }
      }
    }
  } catch {
    // Missing or corrupt file is fine
  }

  return ids;
}

/**
 * Reconcile orphan Deck state at startup:
 *   - Compares existing Deck state against liveWorkspaceIds.
 *   - Fail-closed: null or empty array -> skips with log.
 *   - For each orphan: archives work record, then tears down workspace state.
 *   - Parked work TTL: parked work older than parkedWorkTtlHours is purged;
 *     parked work of a live workspace is never touched.
 *   - dryRun: reports orphans, changes nothing.
 *   - Never throws.
 */
export async function reconcileOrphanDeckState(
  liveWorkspaceIds: readonly string[] | null,
  opts?: OrphanReconcileOptions,
): Promise<OrphanReport> {
  const log = opts?.log ?? ((line: string) => {
    // eslint-disable-next-line no-console
    console.log(`[deck:reconcile] ${line}`);
  });

  const emptyReport: OrphanReport = {
    orphans: [],
    archived: [],
  };

  try {
    // FAIL CLOSED: when liveWorkspaceIds is null or empty, do nothing
    if (!liveWorkspaceIds || liveWorkspaceIds.length === 0) {
      const skipped = 'skipped: workspace list not loaded';
      log(skipped);
      return { orphans: [], archived: [], skipped };
    }

    const liveSet = new Set<string>();
    for (const id of liveWorkspaceIds) {
      if (typeof id === 'string' && id.trim()) {
        liveSet.add(id.trim());
      }
    }

    if (liveSet.size === 0) {
      const skipped = 'skipped: workspace list not loaded';
      log(skipped);
      return { orphans: [], archived: [], skipped };
    }

    const dir = opts?.dir;
    const now = opts?.now ?? Date.now();
    const ttlHours = opts?.parkedWorkTtlHours ?? PARKED_WORK_TTL_HOURS;
    const ttlMs = ttlHours * 60 * 60 * 1000;

    const allIds = collectDeckWorkspaceIds(dir);
    const orphans = Array.from(allIds)
      .filter((id) => !liveSet.has(id))
      .sort();

    if (opts?.dryRun) {
      return { orphans, archived: [] };
    }

    const archived: string[] = [];
    const activeWorks = loadActiveDeckWorks(dir);

    for (const id of orphans) {
      const work = activeWorks[id];

      if (work) {
        // Check parked work TTL: only remove if older than TTL
        if (isDeckWorkParked(work)) {
          const workTs = work.updatedAt || work.startedAt || 0;
          const ageMs = now - workTs;
          if (ageMs < ttlMs) {
            log(
              `skipping orphan ${id}: parked work is ${Math.round(ageMs / 3600000)}h old (< ${ttlHours}h TTL)`,
            );
            continue;
          }
        }

        // Archive before teardown
        try {
          archiveDeckWork(work, dir);
          archived.push(id);
          log(`archived active work ${work.id} for orphan ${id}`);
        } catch (err) {
          log(`failed to archive work for orphan ${id}: ${String(err)}`);
        }
      }

      // Teardown workspace state (log-only, do not raise decisions for non-existent workspace)
      try {
        await teardownWorkspaceDeckState(id, {
          dir,
          onStrandedWork: () => {
            /* noop: do not raise decisions for workspaces that do not exist */
          },
          log,
        });
        log(`torn down orphan workspace ${id}`);
      } catch (err) {
        log(`failed to teardown orphan workspace ${id}: ${String(err)}`);
      }
    }

    return { orphans, archived };
  } catch (err) {
    log(`unexpected error during orphan reconcile: ${String(err)}`);
    return emptyReport;
  }
}

let startupDeckReconcileDone = false;

export function isStartupDeckReconcileDone(): boolean {
  return startupDeckReconcileDone;
}

export function __resetStartupDeckReconcileForTest(): void {
  startupDeckReconcileDone = false;
}

/**
 * Attempt startup reconcile if workspace mirror is loaded and fresh.
 * Returns true if reconcile completed or was already completed; false if mirror not ready yet.
 */
export async function tryStartupDeckReconcile(opts?: {
  dir?: string;
  log?: (line: string) => void;
  maxSnapshotAgeMs?: number;
}): Promise<boolean> {
  if (startupDeckReconcileDone) return true;
  const mirror = getWorkspaceMirror();
  const entries = mirror.getEntries();
  const peek = mirror.peek();
  const maxAge = opts?.maxSnapshotAgeMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS;

  if (entries && entries.length > 0 && peek && peek.ageMs <= maxAge) {
    startupDeckReconcileDone = true;
    const liveIds = entries.map((e) => e.id);
    try {
      await reconcileOrphanDeckState(liveIds, opts);
      return true;
    } catch (err) {
      opts?.log?.(`startup reconcile error: ${String(err)}`);
      return true;
    }
  }
  return false;
}
