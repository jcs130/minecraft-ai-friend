import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {collectPlayerObservation,buildGoddessChatPrompt,parseGoddessChatAnswer,cacheObservedPhoto} from './goddess-perception.mjs';
test('current player context uses fixed read-only query, rejects wrong subject and unavailable backend',async()=>{
 let command;const seen=await collectPlayerObservation('.Guest',async q=>{command=q;return 'MC_OBSERVATION '+JSON.stringify({schemaVersion:1,player:'.Guest',status:'ok',position:{world:'minecraft:overworld',x:3,y:65,z:8}})});
 assert.equal(seen.position.x,3);const request=JSON.parse(Buffer.from(command.slice('mycli admin observe '.length),'base64url'));assert.deepEqual(request,{op:'player',player:'.Guest'});
 assert.equal((await collectPlayerObservation('Guest',async()=>{throw Error('down')})).status,'unknown');
 assert.equal((await collectPlayerObservation('Guest',async()=>'MC_OBSERVATION {"schemaVersion":1,"player":"Other"}')).status,'unknown');
 await assert.rejects(collectPlayerObservation('Guest\nsay hacked',async()=>''));
 const prompt=buildGoddessChatPrompt({player:'.Guest',wish:'附近哪里有梯子？'},seen);assert.ok(prompt.includes('find_world_blocks')&&prompt.includes('不许代传送')&&prompt.includes('只读工具已接通')&&prompt.includes('140字符'));
});
test('chat forwards only bounded final messages with coordinates attested by actual server tool replies',()=>{
 const snapshot={status:'ok',position:{world:'minecraft:overworld',x:-423.5,y:115,z:-479.5}};
 const places={schemaVersion:1,status:'ok',places:[{kind:'public_container',world:'minecraft:overworld',x:-473,y:69,z:-489}]};
 const outputs=[{role:'tool',content:[{type:'data',data:{name:'afu-goddess-server__find_public_places',output:JSON.stringify(places)+'\n'+JSON.stringify({result:JSON.stringify(places)})}}]}];
 assert.equal(parseGoddessChatAnswer(JSON.stringify({message:'公共箱在minecraft:overworld(-473,69,-489)，本次未查询箱内物品。'}),outputs,snapshot),'公共箱在minecraft:overworld(-473,69,-489)，本次未查询箱内物品。');
 const wrapped=[{role:'tool',content:[{type:'data',data:{name:'afu-goddess-server__find_public_places',output:JSON.stringify([{type:'text',text:JSON.stringify(JSON.stringify(places))}])}}]}];
 assert.equal(parseGoddessChatAnswer(JSON.stringify({message:'公共箱在(-473,69,-489)。'}),wrapped,snapshot),'公共箱在(-473,69,-489)。');
 const persisted=[{role:'assistant',content:[{type:'data',data:{call_id:'call_example',name:'afu-goddess-server__find_public_places',arguments:'{}'}}]},{role:'assistant',content:[{type:'data',data:{call_id:'call_example',name:'afu-goddess-server__find_public_places',state:'success',output:JSON.stringify([{type:'text',text:JSON.stringify(places)+'{\n"result":'+JSON.stringify(JSON.stringify(places))+'\n}'}])}}]}];
 assert.equal(parseGoddessChatAnswer(JSON.stringify({message:'公共箱在(-473,69,-489)。'}),persisted,snapshot),'公共箱在(-473,69,-489)。');
 assert.throws(()=>parseGoddessChatAnswer(JSON.stringify({message:'公共箱在(-473,69,-489)。'}),[persisted[1]],snapshot));
 for(const message of ['箱子在(-472~473，69~71，-489~-495)。','箱子在(473,69,-489)。','箱子在minecraft:the_nether(-473,69,-489)。','甲'.repeat(141),'核实完成\n正文'])assert.throws(()=>parseGoddessChatAnswer(JSON.stringify({message}),outputs,snapshot));
 assert.throws(()=>parseGoddessChatAnswer('核实完成：'+ '甲'.repeat(254),outputs,snapshot));
 assert.throws(()=>parseGoddessChatAnswer(JSON.stringify({message:'箱子在(-473,69,-489)。'}),[{role:'user',content:outputs[0].content}],snapshot));
 assert.throws(()=>parseGoddessChatAnswer(JSON.stringify({message:'箱子在(-473,69,-489)。'}),[{role:'tool',content:[{type:'data',data:{name:'read_file',output:JSON.stringify(places)}}]}],snapshot));
});
test('completed photo cache is owner-bound, signed, bounded and refuses path injection',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'goddess-observation-'));
 try{
 const png=Buffer.alloc(1200);Buffer.from('89504e470d0a1a0a','hex').copy(png);const world='64726c6d-6e51-4bed-b11c-ec6210292081';
 for(let i=0;i<14;i++){const owner='00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');await cacheObservedPhoto({owner,world,job:'00000000-0000-4000-8000-000000000000',mode:'top',anchor:{x:1,y:70,z:3},png},root);}
 const files=await readdir(root);assert.equal(files.length,24);for(const file of files.filter(f=>f.endsWith('.json'))){const v=JSON.parse(await readFile(path.join(root,file),'utf8'));assert.equal(v.hasGameUi,false);assert.equal(v.source,'completed_goddess_camera');assert.match(v.sha256,/^[a-f0-9]{64}$/);}
 await assert.rejects(cacheObservedPhoto({owner:'../../oops',world,job:world,mode:'top',anchor:{x:1,y:2,z:3},png},root));
 }finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^goddess-observation-/);await rm(root,{recursive:true,force:true});}
});
