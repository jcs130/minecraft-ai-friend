import type { IncomingMessage, ServerResponse } from 'node:http';
export interface PerformanceRelay {
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
  close(): void;
}
/** Creation is local; only an incoming allowlisted request contacts the explicit origin. */
export function createRelay(options: {endpoint: string; sourceId: string}): PerformanceRelay;
