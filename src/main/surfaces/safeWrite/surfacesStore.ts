import * as fs from 'fs';
import { writeFileAtomic } from './atomicWrite';

export interface RemovedHookEntry {
  id: string;
  definition: unknown;
  originPath?: string;
}

export interface SurfacesStoreData {
  version: number;
  intents?: Record<string, Record<string, boolean>>;
  removedHooks?: Record<string, RemovedHookEntry[]>;
}

export class SurfacesStore {
  readonly filePath: string;
  readonly warnings: string[] = [];

  private intents: Record<string, Record<string, boolean>> = {};
  private removedHooksStore: Record<string, RemovedHookEntry[]> = {};
  private hasRefusedVersion = false;

  readonly removedHooks = {
    add: (provider: string, hook: RemovedHookEntry): void => {
      if (!this.removedHooksStore[provider]) {
        this.removedHooksStore[provider] = [];
      }
      const list = this.removedHooksStore[provider];
      const idx = list.findIndex((h) => h.id === hook.id);
      if (idx !== -1) {
        list[idx] = hook;
      } else {
        list.push(hook);
      }
    },

    take: (provider: string, id: string): RemovedHookEntry | undefined => {
      const list = this.removedHooksStore[provider];
      if (!list) return undefined;
      const idx = list.findIndex((h) => h.id === id);
      if (idx === -1) return undefined;
      const [item] = list.splice(idx, 1);
      return item;
    },

    get: (provider: string, id: string): RemovedHookEntry | undefined => {
      const list = this.removedHooksStore[provider];
      return list?.find((h) => h.id === id);
    },

    list: (provider: string): RemovedHookEntry[] => {
      return [...(this.removedHooksStore[provider] ?? [])];
    },
  };

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): void {
    this.intents = {};
    this.removedHooksStore = {};
    this.hasRefusedVersion = false;

    if (!fs.existsSync(this.filePath)) {
      return;
    }

    let parsed: unknown;
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      parsed = JSON.parse(content);
    } catch (err) {
      this.warnings.push(`Corrupt surfaces store file: ${(err as Error).message}`);
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.warnings.push('Corrupt surfaces store: content is not a JSON object');
      return;
    }

    const data = parsed as SurfacesStoreData;
    if (typeof data.version !== 'number' || data.version !== 1) {
      this.warnings.push(`Unknown or unsupported surfaces store version: ${data.version}`);
      this.hasRefusedVersion = true;
      return;
    }

    if (data.intents && typeof data.intents === 'object') {
      this.intents = data.intents;
    }
    if (data.removedHooks && typeof data.removedHooks === 'object') {
      this.removedHooksStore = data.removedHooks;
    }
  }

  save(): void {
    if (this.hasRefusedVersion) {
      this.warnings.push('Refusing to save: newer version file exists on disk');
      return;
    }

    // The check-then-rename race window is not closed without OS file locking.
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const diskData = JSON.parse(raw) as SurfacesStoreData;
        if (diskData && typeof diskData.version === 'number' && diskData.version > 1) {
          this.warnings.push(`Refusing to save: newer version ${diskData.version} detected on disk`);
          this.hasRefusedVersion = true;
          return;
        }
      } catch {
        /* proceed to overwrite if corrupt or unparseable */
      }
    }

    const payload: SurfacesStoreData = {
      version: 1,
      intents: this.intents,
      removedHooks: this.removedHooksStore,
    };

    writeFileAtomic(this.filePath, JSON.stringify(payload, null, 2) + '\n');
  }

  recordIntent(provider: string, itemId: string, wantedEnabled: boolean): void {
    if (!this.intents[provider]) {
      this.intents[provider] = {};
    }
    this.intents[provider][itemId] = wantedEnabled;
  }

  getIntent(provider: string, itemId: string): boolean | undefined {
    return this.intents[provider]?.[itemId];
  }

  reconcile(
    provider: string,
    currentItemIds: string[],
  ): { newItems: string[]; removedItems: string[] } {
    const recordedMap = this.intents[provider] ?? {};
    const recordedIds = Object.keys(recordedMap);
    const recordedSet = new Set(recordedIds);
    const currentSet = new Set(currentItemIds);

    const newItems = currentItemIds.filter((id) => !recordedSet.has(id));
    const removedItems = recordedIds.filter((id) => !currentSet.has(id));

    return { newItems, removedItems };
  }
}
