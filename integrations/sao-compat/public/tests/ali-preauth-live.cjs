'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
// Explicit opt-in real-server regression. No password or game action is sent.
const ROOT=process.env.SAO_ROOT
assert(ROOT,'SAO_ROOT is required for the bounded real-server test')
assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'pack-source.json'),'utf8')).minecraft,'1.20.1')
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'server/mods/AdvancedLootInfo-forge-1.20.1-2.2.0.jar'))).digest('hex'),'6f74e1b1463d1df3d6b2509ec8a02a905a5c71ab8301ffa0441eefe22e5df622','Reinspect ALI packet IDs before running against a changed JAR')
const {createSAOBot}=require(path.join(ROOT,'ops/gateway/integrations/sao-compat/sao_bot.cjs'))
const mode=process.argv[2],reportFile=process.argv[3]
assert(['held','released'].includes(mode));assert(reportFile&&!fs.existsSync(reportFile))
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const report={schemaVersion:1,mode,username:'SaoAliProbe',observedAt:new Date().toISOString(),passwordProvided:false,loginCommandSent:false,gameActionsSent:false,channel:'ali:network',requestDiscriminator:4}
let bot,started,done=false,total=null,chunks=new Map(),error=null,receivedBytes=0
async function main(){
 bot=createSAOBot({root:ROOT,username:report.username,authenticate:()=>new Promise(()=>{})})
 bot.on('error',e=>{error=e.code||e.name})
 bot.on('kicked',()=>{error='UNEXPECTED_KICK'})
 bot._client.on('custom_payload',p=>{
  if(p.channel!=='ali:network')return
  try{
   const b=p.data;if(!Buffer.isBuffer(b)||!b.length)throw Error('EMPTY_ALI_PAYLOAD')
   const id=b[0]
   if(id===2){assert.equal(b.length,5);assert.equal(total,null);total=b.readInt32BE(1);assert(total>0&&total<4096)}
   else if(id===1){
    const index=b.readInt32BE(1);let n=0,offset=5
    for(let shift=0;;shift+=7){assert(shift<35&&offset<b.length);const part=b[offset++];n|=(part&127)<<shift;if(part<128)break}
    assert(n>=0&&n<=2*1024*1024&&b.length===offset+n);assert(!chunks.has(index));receivedBytes+=n;assert(receivedBytes<=32*1024*1024);chunks.set(index,b.subarray(offset))
   }else if(id===3){assert.equal(b.length,1);done=true}
   else throw Error('UNKNOWN_ALI_RESPONSE')
  }catch(e){error=e.code||e.message}
 })
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('SPAWN_TIMEOUT')),25000);bot.once('spawn',()=>{clearTimeout(t);resolve()});bot.once('end',()=>{clearTimeout(t);reject(Error('ENDED_BEFORE_SPAWN'))})})
 await sleep(500)
 const before=await bot.native.operations({refresh:true});assert.equal(before.authentication.authenticated,false);report.authenticationBefore=before.authentication
 started=Date.now();bot._client.write('custom_payload',{channel:'ali:network',data:Buffer.from([4])})
 const limit=mode==='held'?8000:20000
 while(Date.now()-started<limit&&!done&&!error)await sleep(50)
 assert.equal(error,null);report.elapsedMs=Date.now()-started;report.startReceived=total!==null;report.doneReceived=done;report.expectedChunks=total;report.returnedChunks=chunks.size;report.compressedBytes=receivedBytes
 if(mode==='held'){assert.equal(total,null);assert.equal(done,false);assert.equal(chunks.size,0)}
 else{assert(done);assert.equal(chunks.size,total);const bytes=Buffer.concat(Array.from({length:total},(_,i)=>{assert(chunks.has(i));return chunks.get(i)}));report.compressedSha256=crypto.createHash('sha256').update(bytes).digest('hex')}
 const after=await bot.native.operations({refresh:true});assert.equal(after.authentication.authenticated,false);report.authenticationAfter=after.authentication;report.passed=true
}
main().catch(e=>{report.passed=false;report.reason=e.message}).finally(async()=>{
 if(bot){const end=new Promise(r=>{bot.once('end',r);setTimeout(r,2000)});bot.quit('bounded ALI metadata compatibility probe complete');await end}
 fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));process.exitCode=report.passed?0:1
})
