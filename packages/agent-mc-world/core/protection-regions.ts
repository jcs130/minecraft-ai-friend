import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ProtectedRegion {
  dimension: string;
  x: [number, number];
  z: [number, number];
  /** Server statement time; refreshed when the server repeats the notice. */
  at: string;
  text: string;
}

const AXIS = (axis: string) => new RegExp(`${axis}\\s*[=:]?\\s*(-?\\d+)\\s*(?:\\.\\.|~|～|…|到|to|至)\\s*(-?\\d+)`, 'i');
const X_RANGE = AXIS('X'), Z_RANGE = AXIS('Z');
const RESTRICTED = /保护区|保护区域|受保护|(?:禁止|不允许|不能|请勿|勿|不可)[^。；;\n]{0,24}(?:采集|建造|搭建|放置|破坏|挖掘|改动|build|break|place|dig)/i;

const span = (match: RegExpMatchArray | null): [number, number] | null => {
  if (!match) return null;
  const a = Number(match[1]), b = Number(match[2]);
  if (![a, b].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 30_000_000)) return null;
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  return hi - lo <= 10_000 ? [lo, hi] : null;
};

/**
 * A server notice that restricts terrain actions inside an explicit X/Z box.
 * This stays a standing observation: it never grants permission and never
 * replaces the server's own per-cell verdict.
 */
export function parseProtectedRegion(text: string): { x: [number, number]; z: [number, number] } | null {
  if (!text || text.length > 4096 || !RESTRICTED.test(text)) return null;
  const x = span(text.match(X_RANGE)), z = span(text.match(Z_RANGE));
  return x && z ? { x, z } : null;
}

export class ProtectedRegions {
  private rows: ProtectedRegion[] = [];
  constructor(private readonly file?: string | null, private readonly server = '') {}

  load(): void {
    this.rows = [];
    if (!this.file) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed?.v === 1 && parsed.server === this.server && Array.isArray(parsed.regions)) {
        this.rows = parsed.regions.filter((row: ProtectedRegion) => typeof row?.dimension === 'string'
          && Array.isArray(row.x) && Array.isArray(row.z) && row.x.length === 2 && row.z.length === 2
          && [...row.x, ...row.z].every(n => Number.isSafeInteger(n)) && typeof row.text === 'string');
      }
    } catch { /* A missing or damaged ledger only means no remembered regions. */ }
  }

  private save(): void {
    if (!this.file) return;
    try { mkdirSync(dirname(this.file), { recursive: true }); } catch { /* best effort */ }
    try { writeFileSync(this.file, JSON.stringify({ v: 1, server: this.server, regions: this.rows })); } catch { /* ledger is advisory */ }
  }

  note(text: string, dimension: string, now = new Date()): boolean {
    const range = parseProtectedRegion(text);
    if (!range) return false;
    const dim = dimension.replace(/^minecraft:/, '');
    const same = this.rows.find(row => row.dimension === dim && row.x.join() === range.x.join() && row.z.join() === range.z.join());
    const at = now.toISOString();
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (same) { same.at = at; same.text = clean; return false; }
    this.rows.push({ dimension: dim, ...range, at, text: clean });
    this.rows = this.rows.slice(-64);
    this.save();
    return true;
  }

  covers(dimension: string, cell: { x: number; z: number }): ProtectedRegion | null {
    const dim = dimension.replace(/^minecraft:/, '');
    return this.rows.find(row => row.dimension === dim
      && cell.x >= row.x[0] && cell.x <= row.x[1] && cell.z >= row.z[0] && cell.z <= row.z[1]) ?? null;
  }

  /** Standing fact for the World readout; the server remains the authority per cell. */
  read(dimension?: string): string | null {
    const dim = dimension?.replace(/^minecraft:/, '');
    const rows = this.rows.filter(row => !dim || row.dimension === dim);
    if (!rows.length) return null;
    return '服务端声明过的方块保护区（地点事实，不授予也不否决权限；区内采集、建造、挖掘发包前会先向服务端查询，被拒即停）：\n'
      + rows.map(row => `[${row.dimension}] X=${row.x[0]}..${row.x[1]}、Z=${row.z[0]}..${row.z[1]}（${row.at} 声明：${row.text}）`).join('\n');
  }

  get size(): number { return this.rows.length; }
}
