import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SurfacesStore } from '../surfacesStore';

describe('SurfacesStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-store-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('performs round-trip of intents and removedHooks', () => {
    const filePath = path.join(tmpDir, 'surfaces.json');
    const store = new SurfacesStore(filePath);

    store.recordIntent('claude', 'mcp__wmux__browser', false);
    store.recordIntent('codex', 'web_search', true);
    store.removedHooks.add('claude', {
      id: 'hook-1',
      definition: { type: 'prompt', prompt: 'test' },
      originPath: '/home/.claude/settings.json',
    });

    store.save();
    expect(fs.existsSync(filePath)).toBe(true);

    const store2 = new SurfacesStore(filePath);
    store2.load();

    expect(store2.getIntent('claude', 'mcp__wmux__browser')).toBe(false);
    expect(store2.getIntent('codex', 'web_search')).toBe(true);
    expect(store2.getIntent('agy', 'unknown')).toBeUndefined();

    const taken = store2.removedHooks.take('claude', 'hook-1');
    expect(taken).toEqual({
      id: 'hook-1',
      definition: { type: 'prompt', prompt: 'test' },
      originPath: '/home/.claude/settings.json',
    });
    // Second take returns undefined
    expect(store2.removedHooks.take('claude', 'hook-1')).toBeUndefined();
  });

  it('treats corrupt file as empty and reports warning without throwing', () => {
    const filePath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(filePath, '{\ninvalid json here', 'utf8');

    const store = new SurfacesStore(filePath);
    expect(() => store.load()).not.toThrow();

    expect(store.warnings.length).toBeGreaterThan(0);
    expect(store.warnings[0]).toContain('Corrupt surfaces store');
    expect(store.getIntent('claude', 'anything')).toBeUndefined();
  });

  it('refuses to overwrite future-version files and reports warning', () => {
    const filePath = path.join(tmpDir, 'future.json');
    const futurePayload = {
      version: 99,
      intents: { claude: { futureFeature: true } },
    };
    fs.writeFileSync(filePath, JSON.stringify(futurePayload), 'utf8');

    const store = new SurfacesStore(filePath);
    expect(() => store.load()).not.toThrow();

    expect(store.warnings.length).toBeGreaterThan(0);
    expect(store.warnings[0]).toContain('Unknown or unsupported surfaces store version: 99');
    expect(store.getIntent('claude', 'futureFeature')).toBeUndefined();

    // Now try to save
    store.recordIntent('claude', 'localIntent', true);
    store.save();

    expect(store.warnings.some((w) => w.includes('Refusing to save'))).toBe(true);

    // Verify on disk: file must still have version 99 untouched
    const diskContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(diskContent.version).toBe(99);
    expect(diskContent.intents.claude.futureFeature).toBe(true);
    expect(diskContent.intents.claude.localIntent).toBeUndefined();
  });

  it('reconciles recorded items with currently seen items', () => {
    const filePath = path.join(tmpDir, 'reconcile.json');
    const store = new SurfacesStore(filePath);

    store.recordIntent('claude', 'item-existing', true);
    store.recordIntent('claude', 'item-deleted-upstream', false);

    const { newItems, removedItems } = store.reconcile('claude', [
      'item-existing',
      'item-new-detected',
    ]);

    expect(newItems).toEqual(['item-new-detected']);
    expect(removedItems).toEqual(['item-deleted-upstream']);
  });
});
