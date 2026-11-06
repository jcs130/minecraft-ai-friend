import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {startHostingService} from './service.mjs';

if(process.argv.length!==4||process.argv[2]!=='--adapter')throw new Error('Usage: node src/main.mjs --adapter <trusted-local-assembly.mjs>');
// Explicit operator code assembles existing authenticated MCP and Hub services.
// This path is not a web parameter. Secrets do not appear in command arguments.
const adapter=await import(pathToFileURL(resolve(process.argv[3])));
const service=await startHostingService(await adapter.createConfig());
process.stdout.write(JSON.stringify({ready:true,host:service.address.address,port:service.address.port,automaticResume:false})+'\n');
let stopping;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  stopping??=service.close().then(()=>process.exit(0),()=>process.exit(1));
});
