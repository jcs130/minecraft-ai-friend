import type { VoxelScene } from './voxel-scene.ts';
/** Host-neutral image generation port. Calling it is always an explicit host action. */
export const PHOTOGRAPHY_PROTOCOL = 'agent-mc-photo/v1' as const;
export interface PhotoImage { bytes: Uint8Array; mime: string }
export interface PhotoCapture extends PhotoImage {
  capturedAt: string; sampledAt: string; captureId: string;
  /** Historical game readings, never promoted to current facts by this service. */
  facts: unknown;
  /** Optional, explicitly requested scene export and its paired artistic input. */
  scene?: VoxelScene;
  proxy?: PhotoImage;
  sceneRender?: Record<string, unknown>;
}
export interface ImageGenerationRequest {
  prompt: string;
  /** Ordered inputs: scene first for enhancement, then character references. */
  images: readonly PhotoImage[];
  size?: string;
  /** Caller-owned identity for reconciliation; never a decision-turn boundary. */
  requestId?: string;
}
export interface ImageGenerationResult extends PhotoImage {
  providerRequestId?: string; model: string; usage?: Record<string, unknown>;
}
export interface ImageGenerationPort {
  capabilities: { generate: boolean; edit: boolean; maxReferences: number };
  generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageGenerationResult>;
}
export interface PhotographyConfig {
  provider: 'none' | 'bailian' | 'volcengine' | 'comfyui-flux3';
  /** Full API URL, not a guessed/discovered service address. */
  endpoint: string; model: string; apiKeyEnv: string;
  generate: boolean; edit: boolean; maxReferences: number; timeoutMs: number;
  /** Comma-separated exact output download hosts; required for URL-only responses. */
  resultHosts: string;
  /** Explicit installed models. No download, checkpoint guessing or prompt upsampler. */
  flux3?: Flux3Configuration;
  /** Enables availability only. Ordinary capture/enhance still defaults to screenshots. */
  voxel?: VoxelPhotoConfiguration;
}
export interface VoxelPhotoConfiguration {
  rendererSource: string; assetPack: string; threeModule: string;
  browserExecutable?: string;
  radius: number; below: number; above: number;
  /** Explicit virtual third-person composition, not a camera movement in the game. */
  cameraOffset?: [number, number, number];
  surfaceStyle?: 'original' | 'material-hints';
  geometryStyle?: 'original' | 'organic-hints';
  allowDocumentedApproximations?: boolean;
}
export interface Flux3Configuration {
  unet: string; clip: string; vae: string;
  width: number; height: number;
  /** The distilled FLUX 3 Klein schedule, not a FLUX.2 four-step profile. */
  steps: 16;
  seed?: number;
  pollMs?: number;
}
export interface PhotoRecord {
  schema: typeof PHOTOGRAPHY_PROTOCOL; id: string;
  action: 'capture' | 'enhance' | 'create';
  phase: 'running' | 'completed' | 'cancelled' | 'blocked';
  createdAt: string; updatedAt: string;
  sourceId?: string; prompt?: string; referenceHandles?: string[]; size?: string;
  capturedAt?: string; sampledAt?: string; captureId?: string; facts?: unknown;
  mime?: string; model?: string; providerRequestId?: string; usage?: Record<string, unknown>;
  reason?: string; requestKey?: string; signature?: string;
  enhanced?: boolean; fallback?: 'original';
  sceneInput?: 'screenshot' | 'voxel';
  scene?: { schema: 'agent-mc-voxel-scene/v1'; sha256: string; sampledAt: string; coverage: VoxelScene['coverage']; source: VoxelScene['source'] };
  sceneRender?: Record<string, unknown>;
}
