export * from './client/index.ts';
export * from './contracts/protocol.ts';
export type { WorldIdentityObservation } from './contracts/world-scope.ts';
export { installNavigationBoundaryGuard, navigationBoundaryFailureOf } from '../core/navigation-boundary.ts';
export type { NavigationBoundaryFailure } from '../core/navigation-boundary.ts';
export { combatLoadout, type CombatLoadout } from '../core/combat-loadout.ts';
export { foodRiskReference, type FoodRiskReference } from '../core/nutrition.ts';
export { independentMinecraftSpeechPrefix } from '../core/request-intent.ts';
export { assessScaffoldMaterials, isStableScaffoldMaterial } from '../core/scaffold-material.ts';

export {attachProximityVoice, inspectVoiceWav} from './proximity-voice.ts';
export type {ProximityVoiceClient, ProximityVoiceOptions, ProximityVoiceBot, ProximityVoiceResult, NearbyVoiceHearing} from './proximity-voice.ts';
