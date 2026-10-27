import fs from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));const run=promisify(execFile),report={checks:[],parts:[],errors:[],productionModified:false};
for(const [name,id] of [['npc_director_client.mjs','cold'+label],['player_locales_client.mjs','locale'+label]]){
 try{
  const result=await run(process.execPath,[fileURLToPath(new URL(name,import.meta.url)),id],{cwd:stage,timeout:180000,maxBuffer:4000000,windowsHide:true});await fs.writeFile(stage+'/suite-'+id+'.stdout',result.stdout);
  const part=JSON.parse(await fs.readFile(stage+'/client-'+id+'.json','utf8'));assert(!part.errors.length);report.checks.push(...part.checks.map(s=>id+': '+s));report.parts.push({id,checks:part.checks.length});
 }catch(e){report.errors.push({id,error:String(e),stderr:e.stderr?.slice(-1000),stdout:e.stdout?.slice(-1000)});break;}
}
await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,parts:report.parts,errors:report.errors}));process.exit(report.errors.length?1:0);
