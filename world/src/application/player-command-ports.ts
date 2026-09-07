import type { CliCommand } from '../gameplay/commands/player-cli.ts'
import type { MagicService } from '../gameplay/magic/contracts.ts'
import type { NativeReceipt, NativeSpellAction, NativeProgression } from '../gameplay/native/contracts.ts'
import type { Waypoint, WaypointEntry, WaypointStoreStatus, WaypointResolution, TravelReceipt } from '../gameplay/travel/contracts.ts'

export type PlayerReceipt = Record<string, unknown>
export type CaptureReceipt = (result: PlayerReceipt) => void
export type PlayerCommandHandler = (subject: string, replyTarget: string, cmd: CliCommand,
  isGuardian?: boolean, capture?: CaptureReceipt) => Promise<void>

/** Trusted in-process ports. Identity and guardian authorization belong to the
 * authenticated ingress; this is not an HTTP or multi-user authorization API. */
export interface PlayerCommandPorts {
  magic: Pick<MagicService, 'listAtoms' | 'getAtomById' | 'getInnate' | 'setInnate' | 'getState' |
    'getSkillbar' | 'setSkillbar' | 'castExact' | 'castAsOwner' | 'learnViaAdvancement' | 'unlockPassive'>
  rcon: { send(command: string): Promise<string> }
  irons: {
    request(action: NativeSpellAction, actor: string, id?: string): Promise<NativeReceipt>
    cast(actor: string, skill: string): Promise<NativeReceipt>
  }
  worlddb: {
    chronicleRecord(type: string, actor: string, detail: Record<string, unknown>): unknown
    discoveryList(): Array<{ id: number; name: string; x: number; z: number; found_by: string | null }>
    discoveryRename(id: number, name: string): boolean
  }
  waypoints: {
    listWithRefs(owner: string): WaypointEntry[]
    getStatus(): WaypointStoreStatus
    resolve(owner: string, query: string): WaypointResolution
    allFor(owner: string): Waypoint[]
    add(owner: string, name: string, x: number, y: number, z: number, dimension: string): Waypoint | null
    removeRef(owner: string, ref: string): Waypoint | null
    remove(owner: string, index: number): Waypoint | null
  }
  waypointTravel: { location(actor: string): Promise<TravelReceipt> }
  tpWaypoint(actor: string, waypoint: Waypoint): Promise<TravelReceipt>
  resolveLogin(name: string): string
  skillBookItem(name: string): string
  parseNbtPosition(text: string): [number, number, number] | null
  queryNativeProgression(rcon: { send(command: string): Promise<string> }, actor: string): Promise<NativeProgression>
  nativeProgressionLines(progression: NativeProgression): string[]
  cliWhisper(target: string, text: string): void
  bubble?: { show(actor: string, text: string): void }
  now(): number
  getCultivationCooldowns(): Map<string, number>
  claimStaff?(actor: string, recordedAt: number, recordingEndedAt: number, slot: number): Promise<PlayerReceipt>
  syncStaffBar?(actor: string, slots: Array<{ slot: number; id: string; name: string; icon: string; chant: string }>): Promise<PlayerReceipt>
  /** Original chat/prayer/offering/guard integrations. Ordinary commands never
   * call this optional port, and missing integration is explicitly unavailable. */
  extendedCommand?: PlayerCommandHandler
}

export interface PlayerCommandRequest { actor: string; command: string }
