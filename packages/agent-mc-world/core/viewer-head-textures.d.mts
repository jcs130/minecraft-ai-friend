import type { IncomingMessage, ServerResponse } from 'node:http';
export function createViewerHeadTextures(options?: { fetcher?: typeof fetch; now?: () => number; limit?: number }): {
  observeBot(bot: unknown): void;
  serve(req: IncomingMessage, res: ServerResponse, pathname: string, bot: unknown): Promise<boolean>;
};
