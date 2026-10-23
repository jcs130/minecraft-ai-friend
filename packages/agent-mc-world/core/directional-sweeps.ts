/** Short-lived evidence of directional searches that actually finished without a hit. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Cell } from './geometry.ts';
import { DIRECTIONS, type Direction } from './terrain.ts';

export interface DirectionalSweep {
  at: number;
  dimension: string;
  target: string;
  direction: Direction;
  from: Cell;
  distance: number;
}

function validSweep(value: unknown): value is DirectionalSweep {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<DirectionalSweep>;
  const from = entry.from;
  return Number.isFinite(entry.at) && typeof entry.dimension === 'string'
    && typeof entry.target === 'string' && entry.target.length > 0 && entry.target.length < 128
    && typeof entry.direction === 'string' && entry.direction in DIRECTIONS
    && !!from && Number.isFinite(from.x) && Number.isFinite(from.y) && Number.isFinite(from.z)
    && Number.isFinite(entry.distance) && entry.distance! > 0 && entry.distance! <= 256;
}

export class DirectionalSweepBook {
  private entries: DirectionalSweep[] = [];

  constructor(private readonly file: string | null) {
    if (!file || !existsSync(file)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) this.entries = parsed.filter(validSweep).slice(-64);
    } catch { /* A damaged cache must never prevent a World from starting. */ }
  }

  recent(now: number, holdMs: number): readonly DirectionalSweep[] {
    this.entries = this.entries.filter((entry) => entry.at <= now && now - entry.at < holdMs);
    return this.entries;
  }

  record(entry: DirectionalSweep, now: number, holdMs: number): void {
    this.recent(now, holdMs);
    this.entries.push(entry);
    this.entries = this.entries.slice(-64);
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.entries), 'utf8');
      renameSync(tmp, this.file);
    } catch { /* Retain the in-memory guard if the cache cannot be saved. */ }
  }
}
