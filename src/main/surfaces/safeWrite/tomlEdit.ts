import { parse as parseTomlText } from 'smol-toml';

export class TomlEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TomlEditError';
  }
}

export interface TomlTableEdit {
  table?: string[];
  key: string;
  op: 'set' | 'delete';
  value?: string | number | boolean | string[];
}

export interface TomlArrayTableEdit {
  arrayTable: string[];
  match: Record<string, string>;
  key: string;
  op: 'set' | 'delete';
  value?: string | number | boolean | string[];
}

export type TomlEdit = TomlTableEdit | TomlArrayTableEdit;

function isArrayTableEdit(edit: TomlEdit): edit is TomlArrayTableEdit {
  return 'arrayTable' in edit && Array.isArray(edit.arrayTable);
}

function splitTomlKeyPath(path: string): string[] {
  const segs: string[] = [];
  let i = 0;
  while (i < path.length) {
    while (i < path.length && /\s/.test(path[i])) i++;
    if (i >= path.length) break;
    let seg = '';
    const ch = path[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < path.length && path[i] !== quote) {
        if (quote === '"' && path[i] === '\\') {
          seg += path[i + 1] ?? '';
          i += 2;
        } else {
          seg += path[i];
          i++;
        }
      }
      i++;
    } else {
      while (i < path.length && path[i] !== '.' && !/\s/.test(path[i])) seg += path[i++];
      seg = seg.trim();
    }
    segs.push(seg);
    while (i < path.length && /\s/.test(path[i])) i++;
    if (path[i] === '.') i++;
  }
  return segs;
}

export function formatTomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) {
    return key;
  }
  if (key.includes('\\') && !key.includes("'")) {
    return `'${key}'`;
  }
  return JSON.stringify(key);
}

export function formatTomlValue(value: string | number | boolean | string[]): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.includes('\\') && !value.includes("'") && !value.includes('\n') && !value.includes('\r')) {
      return `'${value}'`;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatTomlValue).join(', ')}]`;
  }
  throw new TomlEditError(`Unsupported TOML value type: ${typeof value}`);
}

function parseHeaderLine(line: string): { type: 'table' | 'arrayTable'; segments: string[] } | null {
  const m = line.match(/^\s*(\[\[?)\s*([^\]]*?)\s*(\]\]?)\s*(?:#.*)?$/);
  if (!m) return null;
  if (m[1] === '[' && m[3] === ']') {
    return { type: 'table', segments: splitTomlKeyPath(m[2]) };
  }
  if (m[1] === '[[' && m[3] === ']]') {
    return { type: 'arrayTable', segments: splitTomlKeyPath(m[2]) };
  }
  return null;
}

function parseKeyValueLine(line: string): {
  key: string;
  rawValue: string;
  inlineComment: string;
  indent: string;
} | null {
  const m = line.match(/^(\s*)([A-Za-z0-9_.-]+|"[^"]*"|'[^']*')\s*=\s*(.*)$/);
  if (!m) return null;
  const indent = m[1];
  const rawKey = m[2];
  const rest = m[3];
  const key = splitTomlKeyPath(rawKey)[0];

  let inDouble = false;
  let inSingle = false;
  let commentIndex = -1;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '"' && !inSingle) {
      if (i === 0 || rest[i - 1] !== '\\') inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '#' && !inDouble && !inSingle) {
      commentIndex = i;
      break;
    }
  }

  let rawValue = rest.trimEnd();
  let inlineComment = '';
  if (commentIndex !== -1) {
    rawValue = rest.slice(0, commentIndex).trimEnd();
    inlineComment = rest.slice(commentIndex);
  }
  return { key, rawValue, inlineComment, indent };
}

/**
 * Number of lines the value starting on `lines[keyLineIdx]` spans. A multi-line array or inline table
 * (`disabled_tools = [
  "a",
]`) continues until its brackets balance; strings and comments are skipped.
 */
function valueLineSpan(lines: string[], keyLineIdx: number): number {
  const first = lines[keyLineIdx];
  let i = first.indexOf('=') + 1;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let row = keyLineIdx; row < lines.length; row++) {
    const line = lines[row];
    for (; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (quote === '"' && ch === '\\') i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '#') {
        break;
      } else if (ch === '[' || ch === '{') {
        depth++;
      } else if (ch === ']' || ch === '}') {
        depth--;
      }
    }
    if (depth <= 0) return row - keyLineIdx + 1;
    quote = null;
    i = 0;
  }
  return 1;
}

function parseTomlScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function segmentsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, k)) return false;
    if (!deepEqual(objA[k], objB[k])) return false;
  }
  return true;
}

function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(cloneDeep) as unknown as T;
  const res: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    res[k] = cloneDeep(v);
  }
  return res as T;
}

function applyEditToExpected(expected: Record<string, unknown>, edit: TomlEdit): void {
  if (isArrayTableEdit(edit)) {
    applyArrayTableEditToExpected(expected, edit);
  } else {
    applyTableEditToExpected(expected, edit);
  }
}

/** The table at `path`, created level by level for a set; null when a delete meets a missing level. */
function tableAt(root: Record<string, unknown>, path: string[], create: boolean): any {
  let cur: any = root;
  for (const seg of path) {
    if (cur[seg] === undefined || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) {
      if (!create) return null;
      cur[seg] = {};
    }
    cur = cur[seg];
  }
  return cur;
}

function applyTableEditToExpected(expected: Record<string, unknown>, edit: TomlTableEdit): void {
  const table = tableAt(expected, edit.table ?? [], edit.op === 'set');
  if (table === null) return;
  if (edit.op === 'set') {
    table[edit.key] = edit.value;
  } else {
    delete table[edit.key];
  }
}

function applyArrayTableEditToExpected(expected: Record<string, unknown>, edit: TomlArrayTableEdit): void {
  const parent = tableAt(expected, edit.arrayTable.slice(0, -1), edit.op === 'set');
  if (parent === null) return;
  const last = edit.arrayTable[edit.arrayTable.length - 1];
  if (!Array.isArray(parent[last])) {
    if (edit.op !== 'set') return;
    parent[last] = [];
  }
  const arr = parent[last] as Record<string, unknown>[];
  const matchEntry = arr.find((item) =>
    Object.entries(edit.match).every(([k, v]) => String(item[k]) === String(v)),
  );
  if (matchEntry) {
    if (edit.op === 'set') {
      matchEntry[edit.key] = edit.value;
    } else {
      delete matchEntry[edit.key];
    }
  } else if (edit.op === 'set') {
    const newEntry: Record<string, unknown> = { ...edit.match };
    newEntry[edit.key] = edit.value;
    arr.push(newEntry);
  }
}

export function editTomlKeys(text: string, edits: TomlEdit[]): string {
  for (const edit of edits) {
    if (edit.key === 'trusted_hash') {
      throw new TomlEditError('Cannot modify protected key: trusted_hash');
    }
  }

  let originalParsed: Record<string, unknown>;
  try {
    originalParsed = (text.trim() ? parseTomlText(text) : {}) as Record<string, unknown>;
  } catch (err) {
    throw new TomlEditError(`Original text is not valid TOML: ${(err as Error).message}`);
  }

  if (edits.length === 0) {
    return text;
  }

  const expected = cloneDeep(originalParsed);
  for (const edit of edits) {
    applyEditToExpected(expected, edit);
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNewline = text.endsWith('\n') || text.endsWith('\r\n') || text.trim() === '';
  let lines = text.length === 0 ? [] : text.split(/\r?\n/);

  for (const edit of edits) {
    if (isArrayTableEdit(edit)) {
      lines = applyArrayTableEdit(lines, edit);
    } else {
      lines = applyTableEdit(lines, edit);
    }
  }

  let newText = lines.join(eol);
  if (hasTrailingNewline && newText.length > 0 && !newText.endsWith(eol)) {
    newText += eol;
  }

  let newParsed: Record<string, unknown>;
  try {
    newParsed = (newText.trim() ? parseTomlText(newText) : {}) as Record<string, unknown>;
  } catch (err) {
    throw new TomlEditError(`Edited text is not valid TOML: ${(err as Error).message}`);
  }

  if (!deepEqual(newParsed, expected)) {
    throw new TomlEditError('Verification failed: edited TOML does not match expected state');
  }

  return newText;
}

/** The key/value lines under one header: `[start, end)`. */
interface Section {
  start: number;
  end: number;
}

/** Index of the next header at or after `from`, or the end of the file. */
function sectionEnd(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (parseHeaderLine(lines[i])) return i;
  }
  return lines.length;
}

/** Where a new key goes in a section: after its last non-blank line. */
function insertionPoint(lines: string[], section: Section): number {
  let insertIdx = section.end;
  while (insertIdx > section.start && lines[insertIdx - 1].trim() === '') {
    insertIdx--;
  }
  return insertIdx;
}

/** Appends a block at the end of the file, one blank line after the last non-blank one. */
function appendBlock(lines: string[], block: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
    trimmed.pop();
  }
  return trimmed.length > 0 ? [...trimmed, '', ...block] : block;
}

function keyLineIn(lines: string[], section: Section, key: string): number {
  for (let i = section.start; i < section.end; i++) {
    const kv = parseKeyValueLine(lines[i]);
    if (kv && kv.key === key) return i;
  }
  return -1;
}

function firstIndentIn(lines: string[], section: Section): string {
  for (let i = section.start; i < section.end; i++) {
    const kv = parseKeyValueLine(lines[i]);
    if (kv) return kv.indent;
  }
  return '';
}

/**
 * Sets or deletes one key in a section. A set replaces the whole value (all lines of a multi-line one)
 * and keeps a one-line value's inline comment; a new key takes the section's indent.
 */
function editKeyInSection(
  lines: string[],
  section: Section,
  edit: { key: string; op: 'set' | 'delete'; value?: string | number | boolean | string[] },
): string[] {
  const keyLineIdx = keyLineIn(lines, section, edit.key);
  if (keyLineIdx !== -1) {
    const span = valueLineSpan(lines, keyLineIdx);
    const nextLines = [...lines];
    if (edit.op === 'delete') {
      nextLines.splice(keyLineIdx, span);
      return nextLines;
    }
    const existing = parseKeyValueLine(lines[keyLineIdx])!;
    const commentPart = existing.inlineComment && span === 1 ? ` ${existing.inlineComment.trim()}` : '';
    nextLines.splice(keyLineIdx, span, `${existing.indent}${formatTomlKey(edit.key)} = ${formatTomlValue(edit.value!)}${commentPart}`);
    return nextLines;
  }

  if (edit.op === 'delete') {
    return lines;
  }
  const nextLines = [...lines];
  nextLines.splice(insertionPoint(lines, section), 0, `${firstIndentIn(lines, section)}${formatTomlKey(edit.key)} = ${formatTomlValue(edit.value!)}`);
  return nextLines;
}

function tableSection(lines: string[], table: string[]): Section | null {
  if (table.length === 0) {
    return { start: 0, end: sectionEnd(lines, 0) };
  }
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeaderLine(lines[i]);
    if (h && h.type === 'table' && segmentsMatch(h.segments, table)) {
      return { start: i + 1, end: sectionEnd(lines, i + 1) };
    }
  }
  return null;
}

function applyTableEdit(lines: string[], edit: TomlTableEdit): string[] {
  const table = edit.table ?? [];
  const section = tableSection(lines, table);
  if (section) {
    return editKeyInSection(lines, section, edit);
  }
  if (edit.op === 'delete') {
    return lines;
  }
  return appendBlock(lines, [
    '[' + table.map(formatTomlKey).join('.') + ']',
    `${formatTomlKey(edit.key)} = ${formatTomlValue(edit.value!)}`,
  ]);
}

function arrayTableEntries(lines: string[], arrayTable: string[]): Section[] {
  const entries: Section[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeaderLine(lines[i]);
    if (h && h.type === 'arrayTable' && segmentsMatch(h.segments, arrayTable)) {
      entries.push({ start: i + 1, end: sectionEnd(lines, i + 1) });
    }
  }
  return entries;
}

/** Every `match` key holds the same value (compared as text) in this entry. */
function entryMatches(lines: string[], entry: Section, match: Record<string, string>): boolean {
  const kvMap = new Map<string, unknown>();
  for (let i = entry.start; i < entry.end; i++) {
    const kv = parseKeyValueLine(lines[i]);
    if (kv) {
      kvMap.set(kv.key, parseTomlScalar(kv.rawValue));
    }
  }
  return Object.entries(match).every(([k, v]) => String(kvMap.get(k)) === String(v));
}

function newEntryLines(edit: TomlArrayTableEdit): string[] {
  const entryLines: string[] = ['[[' + edit.arrayTable.map(formatTomlKey).join('.') + ']]'];
  for (const [mKey, mVal] of Object.entries(edit.match)) {
    if (mKey === edit.key) continue;
    entryLines.push(`${formatTomlKey(mKey)} = ${formatTomlValue(mVal)}`);
  }
  entryLines.push(`${formatTomlKey(edit.key)} = ${formatTomlValue(edit.value!)}`);
  return entryLines;
}

/** Edits the first entry that matches; a set with no match adds an entry after the last one (or at the end). */
function applyArrayTableEdit(lines: string[], edit: TomlArrayTableEdit): string[] {
  const entries = arrayTableEntries(lines, edit.arrayTable);
  const matchingEntry = entries.find((entry) => entryMatches(lines, entry, edit.match));
  if (matchingEntry) {
    return editKeyInSection(lines, matchingEntry, edit);
  }
  if (edit.op === 'delete') {
    return lines;
  }
  if (entries.length > 0) {
    const nextLines = [...lines];
    nextLines.splice(insertionPoint(lines, entries[entries.length - 1]), 0, '', ...newEntryLines(edit));
    return nextLines;
  }
  return appendBlock(lines, newEntryLines(edit));
}
