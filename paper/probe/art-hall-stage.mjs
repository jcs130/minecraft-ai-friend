// Validate the installed Better Villages library as a protected, usable gallery.
// Production construction must use the separately backed-up maintenance plan.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
const stage='E:/MC/staging/exploration-gallery-20261014/paper',root='E:/MC/ops/repairs/exploration-gallery-20261014';
const yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const report={at:new Date().toISOString(),commands:[],checks:[],passed:false};
const rc=async q=>{const r=await command(q,20000,{port:25675,properties:stage+'/server.properties'});report.commands.push({q,result:r});return r;};
function check(label,ok){assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);}
function uuid(raw){const nums=raw.match(/\[I;\s*([^\]]+)/)?.[1].split(',').map(Number);assert.equal(nums?.length,4);const h=nums.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
try{
 check('isolated gallery target',readFileSync(stage+'/server.properties','utf8').includes('server-ip=127.0.0.1')&&(await rc('version AgentFriend')).includes('0.4.37'));
 // Only the new copied-world library footprint and its front apron are touched.
 await rc('minecraft:fill -634 64 -388 -617 65 -370 minecraft:stone_bricks replace minecraft:air');
 await rc('minecraft:fill -619 66 -382 -608 66 -376 minecraft:stone_bricks');
 await rc('minecraft:fill -618 67 -380 -618 67 -378 minecraft:stone_brick_stairs[facing=west]');
 await rc('minecraft:fill -617 67 -382 -608 70 -376 minecraft:air');
 const owner=JSON.parse(readFileSync(stage+'/usercache.json','utf8')).find(r=>r.name==='Goddess').uuid;
 const file=stage+'/plugins/AgentFriend/lands.yml',lands=yaml.load(readFileSync(file,'utf8'));
 lands.lands.art_hall={title:'千灯旅行艺术厅',world:'world',source:'bounds',min:[-634,64,-388],max:[-617,79,-370],'owner-uuid':owner,members:[],'visitor-use':true};
 writeFileSync(file,yaml.dump(lands,{lineWidth:-1}));const loaded=await rc('mycli admin land reload');check('gallery protection catalog accepted',!/(失败|错误|Exception|conflict)/i.test(loaded));
 const frames=[];
 for(const z of [-373,-377,-381,-385])frames.push({slot:'hall_'+Math.abs(z),tag:'ArtHall'+Math.abs(z),x:-631,y:69,z,facing:5,px:-630.96875,py:69.5,pz:z+.5});
 for(const [index,[x,y]] of [[-630,73],[-629,73],[-630,72],[-629,72]].entries())frames.push({slot:'hall_poster',tag:'ArtHallPoster'+index,x,y,z:-385,facing:3,px:x+.5,py:y+.5,pz:-384.96875});
 const groups={};
 for(const f of frames){
  const count=await rc('minecraft:execute if entity @e[type=minecraft:item_frame,tag='+f.tag+']');assert(!count.includes('Test passed'),'Fixture is one-time; inspect existing hall before reuse');
  await rc(`minecraft:setblock ${f.x} ${f.y} ${f.z} minecraft:air`);
  await rc(`minecraft:summon minecraft:item_frame ${f.px} ${f.py} ${f.pz} {Facing:${f.facing}b,Fixed:1b,Invulnerable:1b,ItemDropChance:0.0f,Tags:["${f.tag}"],CustomName:'{"text":"艺术厅空展位 · 旅行纪念"}'}`);
  const id=uuid(await rc('minecraft:data get entity @e[type=minecraft:item_frame,tag='+f.tag+',limit=1] UUID'));(groups[f.slot]??=[]).push(id);f.uuid=id;
 }
 for(const [id,ids] of Object.entries(groups))check('register '+id,(await rc('mycli admin photo gallery-slot '+id+' '+ids.join(','))).includes('已登记'));
 const title=JSON.stringify({text:'千灯旅行艺术厅',color:'dark_blue'}),line2=JSON.stringify({text:'照片 · 作者 · 故事'}),line3=JSON.stringify({text:'罗盘 → 相机 → 展览'}),line4=JSON.stringify({text:'右键展品读故事'});
 await rc('minecraft:setblock -616 67 -382 minecraft:oak_sign[rotation=4]{front_text:{messages:[\''+title+'\',\''+line2+'\',\''+line3+'\',\''+line4+'\']},is_waxed:1b}');
 report.frames=frames;report.bounds=lands.lands.art_hall;report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{writeFileSync(root+'/art-hall-stage-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
