import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** Compiled children run on Node directly; source checkouts resolve their development loader locally. */
export function childExecArgv(): string[] {
  if (new URL(import.meta.url).pathname.split('.').at(-1) !== 'ts') return [];
  return ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href];
}
