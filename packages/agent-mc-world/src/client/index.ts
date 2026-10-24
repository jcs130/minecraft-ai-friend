/// <reference path="../../core/pathfinder-lib.d.ts" />
export { MinecraftAgentClient, type MinecraftClientOptions, type ClientEnvironment } from './runtime.ts';
export { JavaClientWorld, validateJavaClientConfiguration, JAVA_CLIENT_ENVIRONMENT } from './java-client.ts';
export type { JavaClientServices } from './java-memory.ts';
export * from '../contracts/java-client.ts';
export { offlineUuid, buildClientLaunch } from '../../core/client-launch.ts';
export { MINECRAFT_CLIENT_DEFAULTS, assertMinecraftReady, parseMinecraftServerAddress, type MinecraftClientConfig } from './config.ts';
export { loadMinecraftClientConfig } from './config-file.ts';
export { prepareMinecraftViewerAssets, type ViewerAssetProgress, type ViewerAssetOptions } from './viewer-assets.ts';
export { AgentJournal, EventCursorError } from './journal.ts';
export * from './context-reading.ts';
export * from './execution-reading.ts';
export * from './schema-reading.ts';
export { TOOL_HELP_TOOL, readToolHelp, createToolHelpTool, withToolHelp, mapToolRecovery } from './tool-help.ts';
export type { ToolHelpOptions } from './tool-help.ts';
export { classifyWake, WAKE_DEFAULT, WAKE_ACTIVE_GOAL, compactEvents, clockTime, capModelText, condenseText, compactToolSchema, compactFacts, observationDigest, terseField, type CompactFacts,
  type WakeCategory, type WakeOptions, type WakeDecision, type CompactEvent, type CompactCatalogOptions,
  MovementProgress, type MovementProgressOptions, type MovementVerdict } from './context-budget.ts';
export { EventCondenser, DEFAULT_CONDENSE_RULES, type CondenseRule, type CondenseAction, type EventCondenserOptions, type CondenserStats } from './event-condenser.ts';
export { GameMemoryBook, GAME_MEMORY_TOOL, type GameMemoryScope, type GameMemorySource, type GameMemoryContext } from '../../core/game-memory.ts';
export { GameMemoryService, GAME_MEMORY_DEFAULTS, type GameMemoryConfig } from '../../core/game-memory-service.ts';
export { KNOWLEDGE_TOOL, readMinecraftKnowledge } from '../../core/knowledge.ts';
export { AgentMetrics, serveAgentMetrics, type HarnessTrace } from './metrics.ts';
export type { ToolDef, ToolOutcome, ToolCallContext, EventEnvelope, WorldRequestFacts, Logger, ModelFacts } from './contracts.ts';
export type { FamiliarAction } from '../contracts/host.ts';
export { familiarStepAction, nativeFamiliarAction } from './familiar-action.ts';
export { nullLogger } from '../../core/support/runtime.mjs';
export { preferExistingRoute, type TravelRoutePreference } from '../../core/travel.ts';
export { classifyBossBarTitle, readBossBarHud, renderBossBarHud, type BossBarReading } from '../../core/boss-bar.ts';
export type { RouteProbe } from '../../core/skill-context.ts';
export { MessageInbox, MESSAGE_TOOL, MESSAGE_PARAMETERS, MESSAGE_LIMIT, MESSAGE_CHANNELS, messageChannel,
  messageInboxHost, messageInboxFacts, type MessageInboxOptions, type ReceivedMessage, type MessageChannel } from './message-inbox.ts';
export { serveClientConsole, type ClientConsolePort, type ClientConsolePresentation } from './console-server.ts';
export type { PublicAccountState, AuthenticationMode } from './authentication.ts';

export { planLegacyConfiguration, copyLegacyData } from './migration.ts';
export * from './world-storage.ts';
export * from './world-namespace.ts';

export { GameMemoryLearning } from '../../core/game-memory-learning.ts';
export { ClientOperationLearning } from './operation-learning.ts';
export { WorldOperationLearning } from './world-learning.ts';
export { MethodLibrary, METHOD_LIBRARY_SCHEMA, type MethodReview } from '../../core/method-library.ts';
export { OperationExperienceBook, experienceHash, operationObservation, operationScopeKey,
  type OperationExperience, type OperationObservation, type OperationDecision, type OperationAttribution } from '../../core/operation-experience.ts';
export { PhotographyService, PHOTO_TOOL, PHOTO_PLANNER_SYSTEM, preparePhotoContext, type PhotographyOptions } from '../../core/photography.ts';
export { renderVoxelPhoto } from '../../core/voxel-photo.ts';
export * from '../contracts/photography.ts';
export * from '../../core/voxel-scene.ts';
export { learningHelp, type ArtifactRef, type SourceRef } from '../../core/game-memory-learning-contract.ts';
export { planInventoryOrganization, inventoryOrganizationKey, inventoryOrganizationLimit, inventoryOrganizationTotals,
  type InventoryOrganization, type InventoryDisposition, type OrganizationStack, type OrganizationMove,
  type InventoryOrganizationPlan } from '../../core/inventory-organization.ts';

export { PHOTOGRAPHY_DEFAULTS } from '../../core/photo-image.ts';
