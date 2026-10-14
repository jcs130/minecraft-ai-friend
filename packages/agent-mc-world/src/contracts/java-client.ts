export const JAVA_CLIENT_PROTOCOL = 'agent-mc-java/v1' as const;
export interface JavaClientConfiguration {
  expectedUuid: string; expectedServer: string; controllerId: string;
  credentialsFile: string; ledgerDir: string; leaseMs: number;
  /** Explicit mc-visual-console HTML path. With viewerPort > 0 serves only loopback GETs. */
  viewerPageFile?: string;
  /** auto (default) detects native capabilities; explicit modes remain strict. */
  viewerMode?: 'auto' | 'data' | 'framebuffer';
  /** Expose the optional trusted local Python executor only after explicitly installing/enabling Minescript. */
  minescriptEnabled?: boolean;
}
export interface JavaClientAction {
  id: string; operation: string; phase: 'accepted' | 'running' | 'completed' | 'partial' | 'blocked' | 'cancelled' | 'unknown';
  reason?: string; acceptedAt: number; updatedAt: number; evidence?: Record<string, unknown>;
}
export interface JavaClientState extends Record<string, unknown> {
  protocol: typeof JAVA_CLIENT_PROTOCOL; connected: boolean; server: string; uuid?: string;
  username?: string; sampledAt: string; generation: number; position?: number[];
  actions: Array<Pick<JavaClientAction, 'id' | 'phase' | 'updatedAt'>>;
  messages: Array<{ seq: number; text: string; at: string; overlay: boolean; kind?: 'system' | 'player'; sender?: string }>;
}
