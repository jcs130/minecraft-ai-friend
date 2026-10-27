// Real Geyser packets, no phone or Xbox rendering claim.
import fs from'node:fs/promises';import{createRequire}from'node:module';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';import{command}from'../../ops/rcon-client.mjs';
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));assert.match(await fs.readFile(stage+'/server.properties','utf8'),/^motd=QD_AINCRAD_CONQUEST_QA_ONLY\r?$/m);
const bp=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
const result={checks:[],errors:[],texts:[],receipts:[],clientMods:[]},sleep=ms=>new Promise(r=>setTimeout(r,ms));let client,closing=false,spawned=false;
const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name)};
const rc=async q=>{const t=await command(q,15000,{properties:stage+'/server.properties',port:25925});result.receipts.push({q,t});return t;};
async function until(fn,name,ms=20000){for(let end=Date.now()+ms;Date.now()<end;){const value=fn();if(value)return value;await sleep(80)}throw Error('timeout '+name)}
async function query(q,predicate){await sleep(1200);const start=result.texts.length;client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});return until(()=>result.texts.slice(start).find(predicate),q);}
try{
 client=bp.createClient({host:'127.0.0.1',port:19187,version:'1.26.51',offline:true,username:'ReleaseBR27',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:20000});
 client.on('session',p=>{p.xuid='9000000000272'});client.on('spawn',()=>{spawned=true});client.on('text',p=>result.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));client.on('error',e=>{if(!closing)result.errors.push(e.message)});
 await until(()=>spawned,'Bedrock world join',45000);check('standard Bedrock reaches Paper without client mods',spawned);
 const raw=await query('/mycli dungeon list --json',s=>s.startsWith('MC_SITE_DUNGEON_LIST '));const list=JSON.parse(raw.slice('MC_SITE_DUNGEON_LIST '.length));
 check('Bedrock sees current dungeon catalogue',list.items?.some(x=>x.id==='aincrad_01'));
 check('Bedrock receives explicit difficulty and preparation',list.items.every(x=>x.recommendedLevel>=1&&x.normalStars>=1));
 await query('/mycli guide magic',s=>s.includes('学习')||s.includes('准备'));check('Chinese profession and skill entry is available',true);
 const roster=await rc('minecraft:list uuids');const name=roster.match(/(\S*ReleaseBR27) \(/)?.[1];assert(name,'actual Floodgate player identity required');
 await rc('mv tp '+name+' e:aincrad:-582.5,69,934.5');await sleep(1200);
 check('native multiworld city transfer works for Bedrock',(await rc('minecraft:data get entity '+name+' Dimension')).includes('aincrad'));
 await rc('mv tp '+name+' w:world');await sleep(1200);
 check('Bedrock can return to the original world',(await rc('minecraft:data get entity '+name+' Dimension')).includes('overworld'));
}catch(e){result.errors.push(e.stack||String(e));}
finally{closing=true;try{client?.close()}catch{}await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks.length,errors:result.errors}));process.exit(result.errors.length?1:0);}
