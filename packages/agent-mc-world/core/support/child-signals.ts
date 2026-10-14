import type { EventEmitter } from 'node:events';

/** Terminal signals can reach the whole process group. The parent owns stop:
 * its shutdown RPC drains World, while IPC disconnect covers a dead parent.
 * SIGKILL remains the bounded fallback for an unresponsive child. */
export function installChildSignalOwnership(child: Pick<EventEmitter, 'on' | 'off'>): () => void {
  const ignore = () => {};
  child.on('SIGINT', ignore); child.on('SIGTERM', ignore);
  return () => { child.off('SIGINT', ignore); child.off('SIGTERM', ignore); };
}
