// The directly downloadable helper is a distribution of the canonical core, not a second implementation.
import {readFile,writeFile} from 'node:fs/promises';
const canonical=new URL('../../../packages/agent-mc-world/core/proximity-voice.mjs',import.meta.url);
const target=new URL('client.mjs',import.meta.url),bytes=await readFile(canonical);
if(process.argv.includes('--check')){
  if(!(await readFile(target)).equals(bytes))throw Error('Proximity voice helper differs from the canonical core; run sync-client.mjs');
}else await writeFile(target,bytes);
