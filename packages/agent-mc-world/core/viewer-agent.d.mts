/** Generated host bundle of mc-visual-console's Agent visualization bridge. */
export interface ViewerAgentBridge {
  publish(update: unknown): { ok: boolean; code: string };
  flush(force?: boolean): void;
  subscribeSocket(socket: unknown): () => void;
  dispose(): void;
}
export function createViewerAgentBridge(bot: unknown, options?: {
  getViewerSession?: () => unknown;
}): ViewerAgentBridge;
