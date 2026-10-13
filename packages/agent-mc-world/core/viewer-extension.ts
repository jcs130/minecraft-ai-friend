import type { ViewerSkills } from './viewer-state.ts';
import type { ViewerCustomEvent } from './viewer-presentation.ts';
import type { Bot } from 'mineflayer';
import type { Socket } from 'socket.io';
export interface ViewerServerBridge {
  subscribeSocket(socket: Socket): () => void;
  dispose(): void;
}
/** Supplied by an explicitly installed server extension. All data is read from this same bot. */
export interface ViewerServerProtocol {
  createAppearance?(bot: Bot): (ViewerServerBridge & { snapshot(): readonly unknown[] }) | null;
  createObserver?(bot: Bot): ViewerServerBridge | null;
  stateChannel: string;
  castCommand(text:unknown): {id:string;name:string} | null;
  castResult(text:unknown,id:string): {phase:'succeeded'|'failed';detail:string} | null;
  parseSkillsPayload(channel: unknown, data: unknown): ViewerSkills | null;
  manaSnapshotFromText(text: unknown): {current:number;max:number} | null;
  spellCatalogueFromText(text: unknown): ViewerSkills['abilities'] | null;
  mergeViewerSkillState(previous: ViewerSkills | null, next: ViewerSkills, channel: string, seen: boolean): ViewerSkills;
  mergeViewerSpellCatalogue(previous: ViewerSkills | null, abilities: NonNullable<ViewerSkills['abilities']>, seen: boolean): ViewerSkills;
  parseViewerCustomEvent(channel: unknown, data: unknown): ViewerCustomEvent | null;
}
