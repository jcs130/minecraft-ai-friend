/** Stable waypoint and travel receipt data contracts. No storage or game access. */
export interface Waypoint { id: number; name: string; x: number; y: number; z: number; dim: string; createdAt: number }
export type WaypointRef = `shared:${number}` | `personal:${number}`
export interface WaypointEntry { ref: WaypointRef; index: number; scope: 'shared' | 'personal'; waypoint: Waypoint }
export interface WaypointStoreStatus {
  available: boolean
  source: 'existing' | 'new' | 'invalid' | 'unreadable'
  lastWriteOk: boolean | null
  error: string | null
  mirror: { path: string | null; ok: boolean | null; error: string | null }
}
export type WaypointResolution =
  | { status: 'found'; entry: WaypointEntry }
  | { status: 'ambiguous'; matches: WaypointEntry[] }
  | { status: 'not_found' | 'invalid_query' | 'unavailable' }
export interface TravelReceipt extends Record<string, unknown> {
  ok: boolean; code: string; summary: string; actor?: string; actorUuid?: string
  dimension?: string; x?: number; y?: number; z?: number
}
