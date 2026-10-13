import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** Resolve the packaged TypeScript loader independently of the calling Agent's working directory. */
export function childExecArgv(): string[] {
  return ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href];
}
