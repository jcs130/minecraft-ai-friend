/** Host-neutral image generation port. Calling it is always an explicit host action. */
export const PHOTOGRAPHY_PROTOCOL = 'agent-mc-photo/v1' as const;
export interface PhotoImage { bytes: Uint8Array; mime: string }
export interface PhotoCapture extends PhotoImage {
  capturedAt: string; sampledAt: string; captureId: string;
  /** Historical game readings, never promoted to current facts by this service. */
  facts: unknown;
}
export interface ImageGenerationRequest {
  prompt: string;
  /** Ordered inputs: scene first for enhancement, then character references. */
  images: readonly PhotoImage[];
  size?: string;
}
export interface ImageGenerationResult extends PhotoImage {
  providerRequestId?: string; model: string; usage?: Record<string, unknown>;
}
export interface ImageGenerationPort {
  capabilities: { generate: boolean; edit: boolean; maxReferences: number };
  generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageGenerationResult>;
}
export interface PhotographyConfig {
  provider: 'none' | 'bailian' | 'volcengine';
  /** Full API URL, not a guessed/discovered service address. */
  endpoint: string; model: string; apiKeyEnv: string;
  generate: boolean; edit: boolean; maxReferences: number; timeoutMs: number;
  /** Comma-separated exact output download hosts; required for URL-only responses. */
  resultHosts: string;
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
}
