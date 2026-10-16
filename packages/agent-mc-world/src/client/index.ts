/// <reference path="../../core/pathfinder-lib.d.ts" />
export { MinecraftAgentClient, type MinecraftClientOptions, type ClientEnvironment } from './runtime.ts';
export { JavaClientWorld, validateJavaClientConfiguration, JAVA_CLIENT_ENVIRONMENT } from './java-client.ts';
export type { JavaClientServices } from './java-memory.ts';
export * from '../contracts/java-client.ts';
export { offlineUuid, buildClientLaunch } from '../../core/client-launch.ts';
export { MINECRAFT_CLIENT_DEFAULTS, assertMinecraftReady, type MinecraftClientConfig } from './config.ts';
export { loadMinecraftClientConfig } from './config-file.ts';
export { AgentJournal } from './journal.ts';
export { GameMemoryBook, GAME_MEMORY_TOOL, type GameMemoryScope, type GameMemorySource, type GameMemoryContext } from '../../core/game-memory.ts';
export { GameMemoryService, GAME_MEMORY_DEFAULTS, type GameMemoryConfig } from '../../core/game-memory-service.ts';
export { KNOWLEDGE_TOOL, readMinecraftKnowledge } from '../../core/knowledge.ts';
export { AgentMetrics, serveAgentMetrics, type HarnessTrace } from './metrics.ts';
export type { ToolDef, ToolOutcome, ToolCallContext, EventEnvelope, WorldRequestFacts, Logger, ModelFacts } from './contracts.ts';
export type { FamiliarAction } from '../contracts/host.ts';
export { familiarStepAction, nativeFamiliarAction } from './familiar-action.ts';
export { nullLogger } from '../../core/support/runtime.mjs';
export { serveClientConsole, type ClientConsolePort } from './console-server.ts';
export type { PublicAccountState, AuthenticationMode } from './authentication.ts';

export { planLegacyConfiguration, copyLegacyData } from './migration.ts';

export { GameMemoryLearning } from '../../core/game-memory-learning.ts';
export { ClientOperationLearning } from './operation-learning.ts';
export { WorldOperationLearning } from './world-learning.ts';
export { OperationExperienceBook, experienceHash, operationObservation, operationScopeKey,
  type OperationExperience, type OperationObservation, type OperationDecision, type OperationAttribution } from '../../core/operation-experience.ts';
export { PhotographyService, PHOTO_TOOL, PHOTO_PLANNER_SYSTEM, preparePhotoContext, type PhotographyOptions } from '../../core/photography.ts';
export { createImageGenerationPort, PHOTOGRAPHY_DEFAULTS } from '../../core/image-generation.ts';
export * from '../contracts/photography.ts';
export { learningHelp, type ArtifactRef, type SourceRef } from '../../core/game-memory-learning-contract.ts';
