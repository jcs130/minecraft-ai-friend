/** Versioned server-extension surface. Plugins depend on this port; the core never loads a server implicitly. */
export { metaOf } from '../core/animal-state.ts';
export { chatDeliveryMessage } from '../core/chat-delivery.ts';
export type { ChatDeliveryReceipt, ChatDeliveryRejection, ChatAudienceEvidence } from './contracts/chat-delivery.ts';
export { publishViewerCastCommand, observeViewerCastCommands } from '../core/command-events.ts';
export { BREAK_ACL_CHANNEL } from '../core/break-permissions.ts';
export { Bridge, type BridgeOptions } from '../core/bridge.ts';
export { normalizeAgentActivity, type AgentActivityRecord } from '../core/viewer-activity.mjs';
export { type CombatResult, type CombatScene } from '../core/combat-observation.ts';
export type { AttackEvidence } from './contracts/attack-evidence.ts';
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
export type { JavaClientServices } from './client/java-memory.ts';
export * from './contracts/java-client.ts';
export { itemCustomName } from '../core/item-display.ts';
export { observeSpatial, parseSpatialObservation, SPATIAL_QUERY_SCHEMA, SPATIAL_QUERY_EXAMPLE } from '../core/spatial-observation.ts';
export type { SpatialObserveInput } from '../core/spatial-observation.ts';
export type { VoxelCursor } from '../core/voxel-query-contract.ts';
export type { StepDecision } from '../core/step-decision.ts';
export { minecraftStepRequestKind, minecraftRequestKinds, omitRejectedMinecraftSpeech } from '../core/request-intent.ts';
export type { MinecraftRequestKind } from '../core/request-intent.ts';
export { zhName } from '../core/names.ts';
export { invCount, itemPredOf, invItemNamed, wornItemNamed } from '../core/inventory.ts';
export { takeWornItem, type WornItemAccessResult } from '../core/equipment-access.ts';
export { matchItemName, CONTAINER_FIND } from '../core/chests.ts';
export { resolveAt } from '../core/cell-facts.ts';
export { installWorldIdentity, readWorldIdentity, worldScopedRealm } from '../core/world-scope.ts';
export type { WorldIdentityObservation } from './contracts/world-scope.ts';
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
  renderMinecraftOptionIndex, readMinecraftOptions } from '../core/options.ts';
export * from './contracts/options.ts';
export { createMinecraftChoiceTool } from './client/choice.ts';
export { minecraftLifeTool } from './client/life.ts';
export { PhotographyService, PHOTO_TOOL, PHOTO_PLANNER_SYSTEM, preparePhotoContext } from '../core/photography.ts';
export { renderVoxelPhoto } from '../core/voxel-photo.ts';
export * from './contracts/photography.ts';
export * from '../core/voxel-scene.ts';

export { bindNativeGuiPresentation, nativeGuiPresented, type NativeGuiPresentation } from '../core/show.ts';
export { planInventoryOrganization, planInventoryShortcutExchange, inventoryOrganizationKey, inventoryOrganizationLimit, inventoryOrganizationTotals,
  type InventoryOrganization, type InventoryDisposition, type OrganizationStack, type OrganizationMove,
  type InventoryOrganizationPlan, type InventoryShortcutExchange } from '../core/inventory-organization.ts';

export { PHOTOGRAPHY_DEFAULTS } from '../core/photo-image.ts';
export { ObservedCommandCatalog, type ObservedCommandUsage, type CommandRouteMismatch } from '../core/observed-command-catalog.ts';
export { ServerQueryLane, SERVER_QUERY_TOOL, serverQueryTool, type ServerQueryDefinition, type ServerQueryContext,
  type ServerQueryReceipt } from '../core/server-query.ts';

export {attachProximityVoice, inspectVoiceWav} from './proximity-voice.ts';
export {ProximityVoiceLane, PROXIMITY_VOICE_TOOL} from '../core/proximity-voice-lane.ts';
export type {ProximityVoiceConfig,ProximityVoiceContext,GameVoiceReceipt} from '../core/proximity-voice-lane.ts';
export type {ProximityVoiceClient, ProximityVoiceOptions, ProximityVoiceBot, ProximityVoiceResult, NearbyVoiceHearing} from './proximity-voice.ts';
