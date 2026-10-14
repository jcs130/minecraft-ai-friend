/** Generic, same-connection presentation supplied by an authoritative adapter.
 * Health, elapsed time and movement failure never imply incapacitation. */
export type ViewerBodyState = Readonly<{ pose: 'standing' | 'downed'; canAct: boolean; source: 'server' }>;
const states = new WeakMap<object, ViewerBodyState>();
const recovered: ViewerBodyState = Object.freeze({ pose: 'standing', canAct: true, source: 'server' });
export function setViewerBodyState(bot: object, inhibited: boolean, pose: 'downed' | null = null): void {
  states.set(bot, inhibited ? Object.freeze({ pose: pose ?? 'standing', canAct: false, source: 'server' }) : recovered);
}
export function viewerBodyState(bot: object): ViewerBodyState | undefined { return states.get(bot); }
