'use strict'
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline')
const {createSAOBot}=require('./sao_bot.cjs'),{attachProtection}=require('./protection-client.cjs'),{Vec3}=require('vec3')
const root=path.resolve(process.argv[2]),bot=createSAOBot({root,username:'SAOProtectProbe'}),port=attachProtection(bot)
const evidenceFile=path.join(root,'acceptance/protection-live.json')
const rows=fs.existsSync(evidenceFile)?JSON.parse(fs.readFileSync(evidenceFile,'utf8')):[]
function record(kind,result){rows.push({kind,observedAt:new Date().toISOString(),result});fs.writeFileSync(path.join(root,'acceptance/protection-live.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify({kind,result}))}
bot.on('error',e=>record('error',{message:e.message}));bot.on('end',reason=>record('end',{reason}));
bot.nativeReady.then(()=>record('ready',{uuid:bot._client.uuid,position:bot.entity.position})).catch(e=>record('not_ready',{message:e.message}))
let serial=Promise.resolve()
readline.createInterface({input:process.stdin,terminal:false}).on('line',line=>{serial=serial.then(async()=>{
 const q=JSON.parse(line);await bot.nativeReady
 if(q.op==='quit'){bot.quit('protection acceptance complete');setTimeout(()=>process.exit(0),1000).unref();return}
 if(q.op==='query'){return record('query',await port.check(q.action,String(bot.game.dimension),q,true))}
 if(q.op==='nearby'){
  const here=bot.entity.position.floored(),checks=[];
  for(const [dx,dz]of[[0,0],[2,0],[-2,0],[0,2],[0,-2],[4,0],[-4,0],[0,4],[0,-4],[6,0],[-6,0],[0,6]]){
   const p=here.offset(dx,-1,dz),verdict=await port.check('break',String(bot.game.dimension),p,true);checks.push({...verdict,clientBlock:bot.blockAt(p)?.name});
  }return record('generated_structure_checks',checks)
 }
 if(q.op==='snapshot'){const s=await bot.native.snapshot();return record('snapshot',{ok:s.ok,self:s.self})}
 if(q.op==='open'){
  await bot.activateBlock(bot.blockAt(new Vec3(q.x,q.y,q.z)));await bot.waitForTicks(5);const s=await bot.native.snapshot();
  record('open',{ok:s.ok,menuType:s.menu?.menuType,windowId:s.menu?.windowId,slots:s.menu?.slots?.length});
  if(s.menu?.windowId)record('close',await bot.native.call('menu.close',{windowId:s.menu.windowId,expectedStateId:s.menu.stateId,expectedServerEpoch:s.menu.serverEpoch},{requestId:'protection-pot-close-20261029'}));return
 }
 if(q.op==='dig'){
  const position=new Vec3(q.x,q.y,q.z),block=bot.blockAt(position);if(!block)return record('dig',{status:'unknown_unloaded'})
  const before={name:block.name,count:bot.inventory.items().reduce((n,i)=>n+(i.name==='dirt'?i.count:0),0)}
  let result='returned';const task=bot.dig(block,true).catch(e=>{result=e.message})
  const timer=setTimeout(()=>bot.stopDigging(),6000);await task;clearTimeout(timer);await bot.waitForTicks(5)
  return record('dig',{position,before,callResult:result,after:{name:bot.blockAt(position)?.name,count:(await bot.native.snapshot()).inventory?.filter(i=>i?.id==='minecraft:dirt').reduce((n,i)=>n+i.count,0)},verdict:await port.check('break',String(bot.game.dimension),q,true)})
 }
 if(q.op==='place'){
  const before=await bot.native.snapshot(),item=bot.inventory.items().find(i=>i.name==='dirt');if(!item)return record('place',{status:'missing_fixture_item'})
  await bot.equip(item,'hand');let result='returned';try{await bot.placeBlock(bot.blockAt(new Vec3(q.x,q.y,q.z)),new Vec3(0,1,0))}catch(e){result=e.message}
  await bot.waitForTicks(5);return record('place',{before:before.inventory,after:(await bot.native.snapshot()).inventory,callResult:result,placedBlock:bot.blockAt(new Vec3(q.x,q.y+1,q.z))?.name})
 }
}).catch(e=>record('probe_error',{message:e.message}))})
