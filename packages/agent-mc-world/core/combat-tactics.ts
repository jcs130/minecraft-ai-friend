/** World-scoped tactic settings and observed combat receipts; neither is a learned conclusion. */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CombatTactic } from './combat-abilities.ts';
import { validCombatRules } from './combat-rules.ts';
import { validCombatProgram } from './combat-program.ts';
import { validCombatRoutines } from './combat-routines.ts';

import { sanitizeCombatResult } from './combat-observation.ts';
import type {CombatScene,CombatResult} from './combat-observation.ts';
export type {CombatScene,CombatResult} from './combat-observation.ts';
export interface CombatCastAttempt {
  spell: string;
  sentAt: string;
  source: 'automatic' | 'manual' | 'support';
  tacticRevision: number;
  manaBefore: number | null;
  ruleId?: string;
  reply?: string;
  replyAt?: string;
}

export interface CombatReceipt extends CombatResult {
  id: number;
  tacticRevision: number;
  tacticAtEnd: CombatTactic | null;
  casts: CombatCastAttempt[];
  castsTruncated: boolean;
}

interface TacticState {
  revision: number;
  updatedAt: string | null;
  tactic: CombatTactic | null;
  reports: CombatReceipt[];
}

const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const reading = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const count = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const counts = (value: unknown): boolean => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.values(value).every(count);
function validScene(s: CombatScene): boolean {
  return s !== null && typeof s === 'object' && (s.dimension === null || typeof s.dimension === 'string')
    && s.position !== null && typeof s.position === 'object'
    && ['x', 'y', 'z'].every(k => Number.isFinite(s.position[k as keyof typeof s.position]))
    && Number.isFinite(s.hostileRadius) && s.hostileRadius >= 0 && counts(s.nearbyHostiles)
    && s.equipment !== null && typeof s.equipment === 'object' && !Array.isArray(s.equipment)
    && Object.values(s.equipment).every(v => v === null || typeof v === 'string');
}
function validReceipt(value: unknown): value is CombatReceipt {
  if (!value || typeof value !== 'object') return false;
  const r = value as CombatReceipt;
  return count(r.id) && r.id > 0 && count(r.tacticRevision)
    && time(r.startedAt) && time(r.endedAt) && Date.parse(r.endedAt) >= Date.parse(r.startedAt)
    && typeof r.reason === 'string' && r.reason.length <= 64
    && reading(r.healthBefore) && reading(r.healthAfter)
    && (r.kills === null || counts(r.kills)) && (r.sceneBefore === undefined || validScene(r.sceneBefore))
    && [r.swings, r.meleeLanded, r.arrows, r.rangedLanded].every(count)
    && (r.tacticAtEnd === null || validCombatTactic(r.tacticAtEnd))
    && typeof r.castsTruncated === 'boolean' && Array.isArray(r.casts) && r.casts.length <= 16
    && r.casts.every(c => c && typeof c.spell === 'string' && c.spell.length <= 64
      && time(c.sentAt) && ['automatic', 'manual', 'support'].includes(c.source)
      && count(c.tacticRevision) && reading(c.manaBefore)
      && (c.ruleId === undefined || (typeof c.ruleId === 'string' && /^[a-z][a-z0-9_:-]{0,63}$/.test(c.ruleId)))
      && (c.reply === undefined || (typeof c.reply === 'string' && c.reply.length <= 240))
      && (c.replyAt === undefined || time(c.replyAt)));
}

export function validCombatTactic(value: unknown): value is CombatTactic {
  if (!value || typeof value !== 'object') return false;
  const v = value as CombatTactic;
  return (v.spells === null || (Array.isArray(v.spells) && v.spells.length > 0 && v.spells.length <= 8
    && v.spells.every((id) => typeof id === 'string' && /^[a-z][a-z0-9_:-]{0,63}$/.test(id))
    && new Set(v.spells).size === v.spells.length))
    && (v.healAtOrBelow === null || (Number.isInteger(v.healAtOrBelow) && v.healAtOrBelow >= 1 && v.healAtOrBelow <= 20))
    && (v.rules === undefined || validCombatRules(v.rules))
    && (v.program === undefined || v.program === null || validCombatProgram(v.program))
    && (v.routines === undefined || validCombatRoutines(v.routines));
}

export class CombatTacticBook {
  private readonly realms = new Map<string, TacticState>();
  private realm = '';

  constructor(private readonly file: string | null = null) {
    if (!file || !existsSync(file)) return;
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; realms?: Record<string, TacticState> };
    if (saved.version !== 1 || !saved.realms || typeof saved.realms !== 'object')
      throw new Error('Invalid combat tactic ledger');
    for (const [key, state] of Object.entries(saved.realms)) {
      if (!state || !Number.isInteger(state.revision) || state.revision < 0
        || (state.tactic !== null && !validCombatTactic(state.tactic))
        || (state.updatedAt !== null && !Number.isFinite(Date.parse(state.updatedAt)))
        || !Array.isArray(state.reports) || !state.reports.every(validReceipt))
        throw new Error('Invalid combat tactic state');
      this.realms.set(key, structuredClone({ ...state, reports: state.reports.slice(-5).map(sanitizeCombatResult) }));
    }
  }

  useRealm(realm: string): void { this.realm = realm; }

  current(): TacticState {
    return structuredClone(this.realms.get(this.realm)
      ?? { revision: 0, updatedAt: null, tactic: null, reports: [] });
  }

  set(tactic: CombatTactic | null, now = Date.now()): void {
    const state = this.current();
    const next = { ...state, revision: state.revision + 1,
      updatedAt: new Date(now).toISOString(), tactic: structuredClone(tactic) };
    this.save(next);
  }

  record(result: CombatResult, casts: CombatCastAttempt[]): CombatReceipt {
    const state = this.current();
    const receipt = { ...sanitizeCombatResult(result), id: (state.reports.at(-1)?.id ?? 0) + 1,
      tacticRevision: state.revision, tacticAtEnd: state.tactic,
      casts: structuredClone(casts.slice(-16)), castsTruncated: casts.length > 16 };
    this.save({ ...state, reports: [...state.reports, receipt].slice(-5) });
    return structuredClone(receipt);
  }

  private save(state: TacticState): void {
    const next = new Map(this.realms).set(this.realm, state);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp-${process.pid}`;
      try {
        writeFileSync(temporary, JSON.stringify({ version: 1, realms: Object.fromEntries(next) }) + '\n', 'utf8');
        renameSync(temporary, this.file);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    }
    this.realms.set(this.realm, state);
  }
}
