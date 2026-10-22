import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyBundle,SKILL_ROOT,loadProfile} from './setup.mjs';
try {
  verifyBundle();
  if(process.argv.length!==3)throw Error('usage_mcp_absolute_client_config');
  const requested=resolve(process.argv[2]);
  if(basename(requested)!=='client.json')throw Error('expected_private_client_json');
  const {file}=loadProfile(dirname(requested));
  const entry=resolve(SKILL_ROOT,'assets/runtime/portal-entry.mjs');
  process.argv=[process.execPath,entry,file];
  await import(pathToFileURL(entry));
}catch(error){console.error(JSON.stringify({error:error instanceof Error?error.message:'mcp_start_failed'}));process.exitCode=1;}
