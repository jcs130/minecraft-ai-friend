import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync,mkdirSync} from 'node:fs';
const [sdk,runId,port='39783',expectedFloor='sea_lantern']=process.argv.slice(2);
if(!sdk||!/^[a-zA-Z0-9_.-]{1,64}$/.test(runId??''))throw Error('Expected SDK directory and new run ID');
const req=createRequire(resolve(sdk,'package.json'));
const load=name=>import(pathToFileURL(req.resolve(name)).href);
const {Client}=await load('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=await load('@modelcontextprotocol/sdk/client/stdio.js');
const dir=resolve(sdk,'qa',runId);mkdirSync(dir,{recursive:true});
const config=resolve(dir,'client.local.json');
writeFileSync(config,JSON.stringify({world:{enabled:true,host:'127.0.0.1',port:Number(port),username:'MFSDKProbe',version:'26.3',auth:'offline',
  viewerPort:0,idle:{enabled:false}},dataDir:resolve(dir,'state'),metricsPort:0,consolePort:0,
  adapter:{runtimeDirectory:resolve(sdk,'..')}},null,2),{flag:'wx'});
const output=[];
const transport=new StdioClientTransport({command:process.execPath,args:[resolve(sdk,'mcp.mjs'),config],stderr:'pipe'});
transport.stderr?.on('data',bytes=>{process.stderr.write(bytes)});
const client=new Client({name:'native263-packed-acceptance',version:'1.0.0'});
const record=(kind,data)=>{output.push({kind,observedAt:new Date().toISOString(),data});writeFileSync(resolve(dir,'receipts.json'),JSON.stringify(output,null,2)+'\n')};
const textOf=result=>result.structuredContent?.text??result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')??'';
const checkResult=result=>{if(result.isError||result.structuredContent?.failed)throw Error('MCP tool returned failure: '+textOf(result));return result};
try{
  await client.connect(transport);
  const tools=await client.listTools();record('tools',tools.tools.map(t=>({name:t.name,inputSchema:t.inputSchema})));
  const connection=tools.tools.find(t=>t.name==='mc_connection');if(!connection)throw Error('Missing core connection tool');
  record('connect',await client.callTool({name:'mc_connection',arguments:{action:'connect'}}));
  let ready=false;
  for(let i=0;i<60;i++){
    const result=await client.callTool({name:'mc_connection',arguments:{action:'status'}});record('status',result);
    const text=JSON.stringify(result);
    if(/"ready"\s*:\s*true/.test(text)||/\\"ready\\"\s*:\s*true/.test(text)){ready=true;break}
    await new Promise(r=>setTimeout(r,500));
  }
  if(!ready)throw Error('Packed core never reported a ready body; inspect receipts');
  const capsResult=checkResult(await client.callTool({name:'mc_native',arguments:{section:'capabilities'}}));record('native_capabilities',capsResult);
  const caps=JSON.parse(textOf(capsResult));if(caps.protocol!==777||caps.status!=='ok'||!caps.bodyId||caps.counts.items<1)throw Error('Native capability result is not a live body');
  const riceResult=checkResult(await client.callTool({name:'mc_native',arguments:{section:'items',search:'farmersdelight:rice',limit:4}}));record('native_rice',riceResult);
  const rice=JSON.parse(textOf(riceResult));if(rice.bodyId!==caps.bodyId||rice.serverEpoch!==caps.serverEpoch||!rice.rows.some(i=>i.name==='farmersdelight:rice'&&i.id>=0))throw Error('Actual native rice registry entry missing');
  if(!tools.tools.some(t=>t.name==='mc_observe'))throw Error('Core observation tool not advertised');
  await new Promise(r=>setTimeout(r,500));
  const observation=checkResult(await client.callTool({name:'mc_observe',arguments:{mode:'voxels',bounds:[0,-1,0,0,-1,0],format:'dense'}}));record('own_floor',observation);
  const floor=JSON.parse(textOf(observation));
  const material=floor.palette?.[floor.cells?.[0]];
  if(floor.returned_count!==1||floor.observed_count!==1||!material||floor.coordinate_system!=='absolute_block'||
    (expectedFloor!=='any'&&material.name!==expectedFloor))throw Error('Actual loaded floor was not observed');
  const nativeName=material.name.includes(':')?material.name:'minecraft:'+material.name;
  const blockResult=checkResult(await client.callTool({name:'mc_native',arguments:{section:'blocks',search:nativeName,limit:24}}));record('floor_native_registry',blockResult);
  const block=JSON.parse(textOf(blockResult)).rows.find(b=>b.name===nativeName);
  if(!block||material.stateId<block.minStateId||material.stateId>block.maxStateId)throw Error('Observed floor state does not match the actual native registry');
  process.stdout.write(JSON.stringify({status:'completed',goalVerified:true,nativeTool:true,tools:tools.tools.length,bodyId:caps.bodyId,receipts:resolve(dir,'receipts.json')})+'\n');
}finally{
  try{record('disconnect',await client.callTool({name:'mc_connection',arguments:{action:'disconnect'}}))}catch{}
  await client.close();
}
