import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolveSafeRealpath(p: string): string {
  if (fs.existsSync(p)) {
    return fs.realpathSync(p);
  }
  let cur = path.resolve(p);
  const parts: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    parts.unshift(path.basename(cur));
    cur = parent;
  }
  const realBase = fs.existsSync(cur) ? fs.realpathSync(cur) : cur;
  return path.join(realBase, ...parts);
}

export function isInsideDir(child: string, parentDir: string): boolean {
  const normChild = path.resolve(child).toLowerCase();
  const normParent = path.resolve(parentDir).toLowerCase();
  const rel = path.relative(normParent, normChild);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function isPathSafe(filePath: string, homeDir: string, projectDir?: string): boolean {
  try {
    const realTarget = resolveSafeRealpath(filePath);
    const realHome = resolveSafeRealpath(homeDir);
    if (isInsideDir(realTarget, realHome)) {
      return true;
    }
    if (projectDir) {
      const realProject = resolveSafeRealpath(projectDir);
      if (isInsideDir(realTarget, realProject)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
