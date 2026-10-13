import type { EventEmitter } from 'node:events';

interface Position { x: number; y: number; z: number }

interface ContentBot extends EventEmitter {
  version: string;
  _client: EventEmitter;
  registry?: unknown;
  entity?: { position: Position };
  entities?: Record<string, unknown>;
}

interface ContentSocket extends Pick<EventEmitter, 'on' | 'off'> {
  connected: boolean;
  emit(name: string, value: Record<string, unknown>): unknown;
  conn?: unknown;
}

export interface ViewerContentBridge {
  subscribe(publish: (name: string, value: Record<string, unknown>) => void): () => void;
  subscribeSocket(socket: ContentSocket, options?: { writable?: () => boolean }): () => void;
  flush(): void;
  stats(): {
    particles: number; droppedParticles: number; mapPatches: number; rejected: number;
    subscriberErrors: number; cachedFrames: number; cachedTextDisplays: number;
    rejectedTextDisplays: number; epoch: number; maps: number; frames: number;
    textDisplays: number; viewers: number; pendingParticles: number;
  };
  dispose(): void;
}

export function createViewerContentBridge(bot: ContentBot, options?: {
  now?: () => number;
  schedule?: typeof setInterval;
  unschedule?: typeof clearInterval;
}): ViewerContentBridge;

export const VIEWER_CONTENT_LIMITS: Readonly<{
  maps: number; frames: number; textDisplays: number; particleBatch: number; flushMs: number; range: number;
}>;

export function transitionFieldOrder(protocol: unknown): string | null;
export function viewerParticlePacket(packet: unknown, options?: {
  version?: string; protocol?: unknown;
}): {
  kind: 'particle'; name: string; position: Position; spread: Position;
  count: number; speed: number; exact: boolean; color?: number[]; colorEnd?: number[]; size?: number;
} | null;
export function viewerMapPacket(packet: unknown): {
  schemaVersion: 1; mapId: number; scale: number; locked: boolean; columns: number;
  icons?: { type: number; x: number; z: number; direction: number }[];
  x?: number; y?: number; rows?: number; data?: Uint8Array;
} | null;
export function frameMapId(slot: unknown, registry: unknown): number | null;
export function frameTileCenter(tile: Position, normal: readonly [number, number, number]): Position | null;
export function cachedMapFrame(entity: unknown, registry: unknown): {
  id: number; uuid?: string; name: string; position: Position; normal: number[];
  rotation: number; mapId: number | null; invisible: boolean;
} | null;
