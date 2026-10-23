import type { IncomingMessage, ServerResponse } from 'node:http';
export interface ViewerRelay { handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>; close(): void }
export interface RelayConfiguration { module: string; endpoint: string }
/** Import only an operator-selected local bridge. Import/construction must not discover endpoints. */
export async function loadViewerRelay(config: RelayConfiguration | undefined, sourceId: string): Promise<ViewerRelay | undefined> {
  if (!config?.module && !config?.endpoint) return undefined;
  if (!config.module.startsWith('file:') || !config.endpoint) throw new Error('Configure both a local relay module and an endpoint');
  const { createRelay } = await import(config.module);
  if (typeof createRelay !== 'function') throw new Error('Relay factory missing');
  return createRelay({ endpoint: config.endpoint, sourceId });
}
