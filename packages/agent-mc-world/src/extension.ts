/** Versioned server-extension surface. Plugins depend on this port; the core never loads a server implicitly. */
export { metaOf, entityCustomName, entityIdentityNote } from '../core/animal-state.ts';
export { bindEntityIdentityResolver, observedEntityIdentity, observedEntityLabel,
  type EntityIdentity, type EntityIdentityResolver } from '../core/entity-identity.ts';
export { chatDeliveryMessage } from '../core/chat-delivery.ts';
export type { InventoryArrivalMatcher } from '../core/command-inventory-arrival.ts';
export type { ChatDeliveryReceipt, ChatDeliveryRejection, ChatAudienceEvidence } from './contracts/chat-delivery.ts';
export { publishViewerCastCommand, observeViewerCastCommands } from '../core/command-events.ts';
export { BREAK_ACL_CHANNEL } from '../core/break-permissions.ts';
export { Bridge, type BridgeOptions } from '../core/bridge.ts';
export { normalizeAgentActivity, type AgentActivityRecord } from '../core/viewer-activity.mjs';
export { type CombatResult, type CombatScene } from '../core/combat-observation.ts';
export type { AttackEvidence } from './contracts/attack-evidence.ts';
export type { DeathEntityRef, MobDeathReceipt } from './contracts/mob-death.ts';
export { MINECRAFT_CLIENT_CONFIG_GROUP, MINECRAFT_CONFIG_GROUP, MINECRAFT_DEFAULTS, MINECRAFT_PLAYER_CONFIG_GROUP, MINECRAFT_RHYTHM_CONFIG_GROUP, type MinecraftConfigSection } from '../core/config.ts';
export { setFlightExpiry } from '../core/flight.ts';
export type { QueueStatus } from '../core/executor.ts';
export { corridorSafe, loadedSight } from '../core/idle-actions.ts';
export { preferExistingRoute, type TravelRoutePreference } from '../core/travel.ts';
export type { RouteProbe } from '../core/skill-context.ts';
export { HOSTILE } from '../core/melee.ts';
export { piglinIsHostile } from '../core/piglin.ts';
export { type ProtectReply } from '../core/protection-port.ts';
export { MinecraftWorldProxy } from '../core/proxy.ts';
export { applyServerProfile, describeServerProfiles, selectedServerId, validateServerProfile,
  type MinecraftServerProfile, type ServerSafetyRules } from '../core/server-profiles.ts';
export type { MinecraftServerGuide } from '../core/server-guide.ts';
export { chatInputError, parseSteps, parseScoutSteps, parseNoteText, describeSkillInputCorrection,
  type ParseNote } from '../core/skills.ts';
export { renderTemplate } from '../core/support/runtime.mjs';
export { canSeeEntity } from '../core/terrain.ts';
export { type ViewerServerProtocol } from '../core/viewer-extension.ts';
export { type ViewerCustomEvent } from '../core/viewer-presentation.ts';
export { type ViewerSkills } from '../core/viewer-state.ts';
export { MINECRAFT_PANEL_DECLS, MINECRAFT_TOOL_DECLS, MinecraftWorld, type MinecraftWorldOptions } from '../core/world.ts';
export { loadPrivateClientConfig } from './client/config-file.ts';
export { observeVisual, acceptsImages, visualArgumentError, structuredVisual } from './client/visual.ts';
export { MINECRAFT_CLIENT_DEFAULTS, assertMinecraftReady, parseMinecraftServerAddress } from './client/config.ts';
export { prepareMinecraftViewerAssets, type ViewerAssetBase, type ViewerAssetProgress, type ViewerAssetOptions } from './client/viewer-assets.ts';
export { MinecraftClientWorld } from './client/world.ts';
export { WorldOperationLearning } from './client/world-learning.ts';
export * from './client/world-storage.ts';
export { GoalCheckpointBook, createGoalCheckpoint, restoreGoalCheckpoint,
  type GoalCheckpoint, type GoalCheckpointScope } from '../core/goal-checkpoint.ts';
export * from './client/world-namespace.ts';
export { MethodLibrary, METHOD_LIBRARY_SCHEMA, type MethodReview } from '../core/method-library.ts';
export { TOOL_HELP_TOOL, readToolHelp, createToolHelpTool, withToolHelp, mapToolRecovery } from './client/tool-help.ts';
export type { ToolHelpOptions } from './client/tool-help.ts';
export { createServerToolRouter, SERVER_TOOL_PORT_TOOL } from './client/server-tools.ts';
export { MessageInbox, MESSAGE_TOOL, MESSAGE_PARAMETERS, MESSAGE_LIMIT, MESSAGE_CHANNELS, messageChannel,
  messageInboxHost, messageInboxFacts, type MessageInboxOptions } from './client/message-inbox.ts';
export { JavaClientWorld, validateJavaClientConfiguration } from './client/java-client.ts';
export { NumenClientWorld, type NumenBodyFacts, type NumenBodyPort } from './client/numen-client.ts';
export type { JavaClientServices } from './client/java-memory.ts';
export * from './contracts/java-client.ts';
export { itemCustomName } from '../core/item-display.ts';
export { observeSpatial, parseSpatialObservation, SPATIAL_QUERY_SCHEMA, SPATIAL_QUERY_EXAMPLE } from '../core/spatial-observation.ts';
export type { SpatialObserveInput } from '../core/spatial-observation.ts';
export type { VoxelCursor } from '../core/voxel-query-contract.ts';
export type { StepDecision } from '../core/step-decision.ts';
export { minecraftStepRequestKind, minecraftRequestKinds, omitRejectedMinecraftSpeech, independentMinecraftSpeechPrefix } from '../core/request-intent.ts';
export type { MinecraftRequestKind } from '../core/request-intent.ts';
export { zhName } from '../core/names.ts';
export { invCount, itemPredOf, invItemNamed, wornItemNamed } from '../core/inventory.ts';
export { takeWornItem, type WornItemAccessResult } from '../core/equipment-access.ts';
export { matchItemName, CONTAINER_FIND } from '../core/chests.ts';
export { resolveAt } from '../core/cell-facts.ts';
export { installWorldIdentity, readWorldIdentity, worldScopedRealm } from '../core/world-scope.ts';
export type { WorldIdentityObservation } from './contracts/world-scope.ts';
export { identityObservations, type IdentityObservation } from '../core/identity-observation.ts';
export {fireRoutes,type FireRoute,type FireCrossing} from '../core/fire-route.ts';
export type { SkillCall } from '../core/skills.ts';
export { listWorkRoutines, readWorkRoutine, prepareWorkRoutine } from '../core/work-routines.ts';
export { parseTypedChoice } from '../core/support/typed-decision.ts';
export type { PlayerObservation } from '../core/player-observation.ts';
/** Use this declaration identity when implementing extension ports. */
export type { Bot as MinecraftBot } from 'mineflayer';
export type { DetectionEvidence } from '../core/perception-tools.ts';
export { observedEntity } from '../core/perception-sight.ts';
export { signTextSnapshot, observedSignText, type SignTextSnapshot } from '../core/sign-read.ts';
export { OPTIONS_TOOL, minecraftOptionsFromSnapshot, extendMinecraftOptions, relevantMinecraftOptionIntents,
  renderMinecraftOptionIndex, renderMinecraftTravelOptions, readMinecraftOptions } from '../core/options.ts';
export * from './contracts/options.ts';
export { createMinecraftChoiceTool } from './client/choice.ts';
export { explorationActions } from './client/exploration.ts';
export { minecraftLifeTool } from './client/life.ts';
export { PhotographyService, PHOTO_TOOL, PHOTO_PLANNER_SYSTEM, preparePhotoContext } from '../core/photography.ts';
export { renderVoxelPhoto } from '../core/voxel-photo.ts';
export * from './contracts/photography.ts';
export * from '../core/voxel-scene.ts';

export { bindNativeGuiPresentation, nativeGuiPresented, type NativeGuiPresentation } from '../core/show.ts';
export { planInventoryOrganization, inventoryOrganizationPlanView, planInventoryShortcutExchange, inventoryOrganizationKey, inventoryOrganizationLimit, inventoryOrganizationTotals,
  type InventoryOrganization, type InventoryDisposition, type OrganizationStack, type OrganizationMove,
  type InventoryOrganizationPlan, type InventoryOrganizationPlanView, type InventoryShortcutExchange } from '../core/inventory-organization.ts';

export { PHOTOGRAPHY_DEFAULTS } from '../core/photo-image.ts';
export { ObservedCommandCatalog, type ObservedCommandUsage, type CommandRouteMismatch } from '../core/observed-command-catalog.ts';
export { foodRiskReference, type FoodRiskReference } from '../core/nutrition.ts';
export { ServerQueryLane, SERVER_QUERY_TOOL, SERVER_QUERY_RECEIPT_TOOL, serverQueryTool, serverQueryContextNotice, type ServerQueryDefinition, type ServerQueryContext,
  type ServerQueryReceipt } from '../core/server-query.ts';

export {attachProximityVoice, inspectVoiceWav} from './proximity-voice.ts';
export {attachSimpleVoiceChat, parseVoicechatSecret, createOfficialOpusCodec, inspectVoiceWav as inspectSvcWav, SVC_COMPATIBILITY_VERSION} from './simple-voice-chat.ts';

export {ProximityVoiceLane, PROXIMITY_VOICE_TOOL} from '../core/proximity-voice-lane.ts';
export {SimpleVoiceChatLane, SIMPLE_VOICE_CHAT_TOOL} from '../core/simple-voice-chat-lane.ts';
export type {SimpleVoiceChatConfig, SimpleVoiceChatContext} from '../core/simple-voice-chat-lane.ts';
export type {ProximityVoiceConfig,ProximityVoiceContext,GameVoiceReceipt} from '../core/proximity-voice-lane.ts';
export type {ProximityVoiceClient, ProximityVoiceOptions, ProximityVoiceBot, ProximityVoiceResult, NearbyVoiceHearing} from './proximity-voice.ts';

export { mountServerProfile } from '../core/server-profiles.ts';
export { validateServerGuide } from '../core/server-guide.ts';
