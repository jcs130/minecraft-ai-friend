import fs from'node:fs/promises';import{execFile}from'node:child_process';import{promisify}from'node:util';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
const run=promisify(execFile),stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));
const result={checks:[],errors:[],parts:[],productionModified:false};
const tests=label.startsWith('tail')?[['../../integrations/multiverse-core/probe/client.mjs','multiverse20seed2'],['adventure_bedrock.mjs','bed20final2']]:label.startsWith('cold')?[['release_notice_client.mjs','coldnotice20final'],['../../integrations/multiverse-core/probe/client.mjs','coldmv20final2']]:[['release_notice_client.mjs','notice20final'],['identity_client.mjs','identity20final'],['guidance_client.mjs','guide20final'],['../../integrations/agent-anticheat/probe/client.mjs','legalac20final'],['../../integrations/multiverse-core/probe/client.mjs','coldmv20final'],['adventure_bedrock.mjs','bed20final']];
for(const [path,id]of tests){
 try{
  const output=await run(process.execPath,[fileURLToPath(new URL(path,import.meta.url)),id],{cwd:stage,timeout:110000,maxBuffer:8000000,windowsHide:true});
  await fs.writeFile(stage+'/suite-'+id+'.stdout',output.stdout);await fs.writeFile(stage+'/suite-'+id+'.stderr',output.stderr);
  const data=JSON.parse(await fs.readFile(stage+'/client-'+id+'.json','utf8'));assert(!data.errors?.length);
  result.parts.push({id,checks:data.checks.length});result.checks.push(...data.checks.map(s=>id+': '+s));
 }catch(e){result.errors.push({id,message:String(e),stderr:e.stderr?.slice(-1000),stdout:e.stdout?.slice(-1000)});break;}
}
await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks.length,parts:result.parts,errors:result.errors}));process.exit(result.errors.length?1:0);
