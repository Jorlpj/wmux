import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TTL_MS, FAILURE_TTL_MS, ModelCatalog } from '../ModelCatalog';
import { agyFamilyOf, parseAgyModels, parseCodexModels } from '../../../shared/modelCatalog';

// Captured 2026-09-30 from agy 1.2.x (`agy models`) and codex-cli 0.159.2
// (`codex debug models`, trimmed to the fields the parser reads).
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const AGY = fixture('agy-models.txt');
const CODEX = fixture('codex-debug-models.json');

describe('parseAgyModels', () => {
  it('reads every id/label line and skips the banner', () => {
    const models = parseAgyModels(AGY);
    expect(models).toHaveLength(14);
    expect(models[0]).toEqual({
      id: 'gemini-3.8-flash-high',
      label: 'Gemini 3.8 Flash (High)',
      defaultEffort: 'high',
    });
    expect(models.find((m) => m.id === 'claude-sonnet-4-6')?.defaultEffort).toBeUndefined();
  });

  it('derives the family without the effort suffix', () => {
    expect(agyFamilyOf('gemini-3.8-flash-low')).toBe('gemini-3.8-flash');
    expect(agyFamilyOf('claude-opus-4-6-thinking')).toBe('claude-opus-4-6-thinking');
  });

  it('ignores garbage', () => {
    expect(parseAgyModels('error: not logged in\n')).toEqual([]);
  });
});

describe('parseCodexModels', () => {
  it('keeps listed models with their reasoning levels', () => {
    const models = parseCodexModels(CODEX);
    const ids = models.map((m) => m.id);
    expect(ids).toContain('gpt-6.1-sol');
    expect(ids).not.toContain('gpt-reserve'); // visibility: hide
    const sol = models.find((m) => m.id === 'gpt-6.1-sol');
    expect(sol?.label).toBe('GPT-6.1-Sol');
    expect(sol?.efforts).toContain('ultra');
    expect(sol?.defaultEffort).toBe('low');
  });

  it('returns [] for invalid JSON or an unexpected shape', () => {
    expect(parseCodexModels('not json')).toEqual([]);
    expect(parseCodexModels('{"models": 3}')).toEqual([]);
  });
});

describe('ModelCatalog', () => {
  let dir: string;
  let clock: number;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-model-catalog-'));
    clock = 1_000_000;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const make = (run: (c: string, a: string[]) => Promise<string>) =>
    new ModelCatalog({ run, now: () => clock, cachePath: path.join(dir, 'model-catalog.json') });

  it('serves claude from the static list without running anything', async () => {
    const run = vi.fn();
    const r = await make(run).list('claude');
    expect(r.status).toBe('static');
    expect(r.models.map((m) => m.id)).toContain('claude-opus-5-5');
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the verified discovery command and caches the result', async () => {
    const run = vi.fn(async () => AGY);
    const catalog = make(run);
    const r = await catalog.list('agy');
    expect(run).toHaveBeenCalledWith('agy', ['models']);
    expect(r.status).toBe('ok');
    clock += CACHE_TTL_MS - 1;
    await catalog.list('agy');
    expect(run).toHaveBeenCalledTimes(1);
    await catalog.list('agy', { refresh: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reuses the cache file across instances', async () => {
    await make(async () => CODEX).list('codex');
    const run = vi.fn(async () => CODEX);
    const r = await make(run).list('codex');
    expect(r.status).toBe('ok');
    expect(run).not.toHaveBeenCalled();
  });

  it('turns a failing CLI into unavailable and retries after the failure TTL', async () => {
    const run = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    const catalog = make(run);
    expect((await catalog.list('codex')).status).toBe('unavailable');
    await catalog.list('codex');
    expect(run).toHaveBeenCalledTimes(1);
    clock += FAILURE_TTL_MS;
    await catalog.list('codex');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports an unknown agent as unavailable', async () => {
    expect((await make(vi.fn()).list('opencode')).status).toBe('unavailable');
  });
});
