export * from './client/index.ts';
export * from './contracts/protocol.ts';
export { getResourceActionContract } from './collect-contract.ts';
export type { WorldIdentityObservation } from './contracts/world-scope.ts';
export { installNavigationBoundaryGuard, navigationBoundaryFailureOf } from '../core/navigation-boundary.ts';
export type { NavigationBoundaryFailure } from '../core/navigation-boundary.ts';
export { combatLoadout, type CombatLoadout } from '../core/combat-loadout.ts';
export { foodRiskReference, type FoodRiskReference } from '../core/nutrition.ts';
export { independentMinecraftSpeechPrefix } from '../core/request-intent.ts';
export { assessScaffoldMaterials, isStableScaffoldMaterial } from '../core/scaffold-material.ts';
export { navigationFallBudget, estimateFallDamage, installNavigationFallCosts, setNavigationFallMode } from '../core/navigation-fall.ts';
export type { FallMode, NavigationFallBudget } from '../core/navigation-fall.ts';

export {attachProximityVoice, inspectVoiceWav, readNearbySpeaker} from './proximity-voice.ts';
export type {ProximityVoiceClient, ProximityVoiceOptions, ProximityVoiceBot, ProximityVoiceResult, NearbyVoiceHearing, NearbySpeakerOrigin} from './proximity-voice.ts';
