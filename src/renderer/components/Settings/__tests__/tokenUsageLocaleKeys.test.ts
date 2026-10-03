import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../../i18n/locales/en';

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

describe('Token usage and MCP status locale key completeness', () => {
  const settingsDir = join(__dirname, '..');
  const tokenUsageDir = join(settingsDir, 'tabs', 'TokenUsageTab');
  const sourcesToScan = [
    ...collectSourceFiles(tokenUsageDir),
    join(settingsDir, 'tabs', 'TokenUsageTab.tsx'),
    join(settingsDir, 'McpStatusSection.tsx'),
  ];

  it('every t(...) key literal used under TokenUsageTab and McpStatusSection exists in en.ts', () => {
    const enKeySet = new Set(Object.keys(en));
    const scannedKeys = new Set<string>();
    const missing: { file: string; key: string }[] = [];

    const keyRegex = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;

    for (const filePath of sourcesToScan) {
      const content = readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(keyRegex)) {
        const key = match[1];
        scannedKeys.add(key);
        if (!enKeySet.has(key)) {
          missing.push({ file: filePath, key });
        }
      }
    }

    expect(scannedKeys.size).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });
});
