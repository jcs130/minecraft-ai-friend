/** Native spell and progression data contracts. No transport or file access. */
export const NATIVE_SPELL_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
export const SKILL_ACTOR = /^(?:[A-Za-z0-9_]{1,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
export interface NativeSpell { id: string; name: string; nameKey: string; level: number; mana: number; cooldownMs: number; [key: string]: unknown }
export interface NativeReceipt extends Record<string, unknown> { ok: boolean; code: string; summary: string; spells?: NativeSpell[] }
export type Action = 'status' | 'list' | 'cast' | 'cancel' | 'menu'

/** Descriptive alias; Action remains available for existing adapter signatures. */
export type NativeSpellAction = Action

export interface NativeCategoryProgression {
  id: string
  available: boolean
  code: string | null
  level: number | null
  experience: number | null
  points_total: number | null
  points_spent: number | null
  points_left: number | null
}
export interface NativeProgression {
  schema_version: 1
  player: string
  ok: boolean
  code: string | null
  source: 'puffish_skills_api'
  categories: NativeCategoryProgression[]
}
