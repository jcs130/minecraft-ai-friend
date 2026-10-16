import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {collectPlayerObservation,loadExplorationLandmarks,buildGoddessChatPrompt,parseGoddessChatAnswer} from './goddess-perception.mjs';

test('verified public structures remain distinct from player dimension and from approximate ruin names',async()=>{
  const catalog=await loadExplorationLandmarks();
  const temple=catalog.places.find(p=>p.id==='desert_pyramid'),ruin=catalog.places.find(p=>p.id==='desert_ruins');
  assert.deepEqual([temple.world,temple.structureKey,temple.x,temple.z],['minecraft:overworld','minecraft:desert_pyramid',-1926,-966]);
  assert.equal(ruin.structureKey,'nova_structures:desert_ruins');assert.equal(temple.entranceVerified,false);assert.equal(temple.y,undefined);
  for(const name of ['ag_ExamQA16','.Guest','OtherAgent']){
    const snapshot=await collectPlayerObservation(name,async()=> 'MC_OBSERVATION '+JSON.stringify({schemaVersion:1,status:'ok',player:name,position:{world:'minecraft:the_nether',x:-58,y:100,z:-78}}));
    assert.equal(snapshot.player,name);assert.equal(snapshot.position.world,'minecraft:the_nether');assert.deepEqual(snapshot.knownStructures,catalog);
    const prompt=buildGoddessChatPrompt({player:name,wish:'沙漠神殿怎么在下界？'},snapshot);
    assert.ok(prompt.includes('冻结维度和结构注册键')&&prompt.includes('不得混用')&&prompt.includes('不补未知Y')&&prompt.includes('保留玩家原任务和进度'));
    const answer='神殿在主世界 X=-1926、Z=-966。你先回主世界，原委托保留；旧模组遗迹不是本单目标。';
    assert.equal(parseGoddessChatAnswer(JSON.stringify({message:answer}),[],snapshot),answer);
    for(const message of ['继续挖到下界(-412,-262)。','神殿在主世界 X=1926、Z=-966。','神殿在(-1926,70,-966)。','神殿在下界 X=-1926、Z=-966。','神殿在minecraft:the_nether(-1926,-966)。'])
      assert.throws(()=>parseGoddessChatAnswer(JSON.stringify({message}),[],snapshot));
  }
});

test('catalog reload sees a correction while malformed or oversized files cannot corrupt the live player snapshot',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'exploration-guidance-')),file=path.join(root,'landmarks.json');
  const snapshot={schemaVersion:1,status:'ok',player:'Guest',position:{world:'minecraft:overworld',x:2,y:65,z:3}};
  const execute=async()=> 'MC_OBSERVATION '+JSON.stringify(snapshot);
  try{
    await writeFile(file,'invalid');let seen=await collectPlayerObservation('Guest',execute,file);
    assert.equal(seen.status,'ok');assert.equal(seen.knownStructuresStatus,'unavailable');assert.equal(seen.knownStructures,undefined);
    const good=await loadExplorationLandmarks();await writeFile(file,JSON.stringify({schemaVersion:1,...good}));
    seen=await collectPlayerObservation('Guest',execute,file);assert.equal(seen.knownStructures.places.length,2);
    good.places=good.places.slice(0,1);await writeFile(file,JSON.stringify({schemaVersion:1,...good}));
    assert.equal((await collectPlayerObservation('Guest',execute,file)).knownStructures.places.length,1);
    good.places[0].y=70;good.places[0].entranceVerified=true;await writeFile(file,JSON.stringify({schemaVersion:1,...good}));
    await assert.rejects(loadExplorationLandmarks(file));
    await writeFile(file,' '.repeat(16385));await assert.rejects(loadExplorationLandmarks(file));
    assert.equal((await collectPlayerObservation('Guest',async()=> 'MC_OBSERVATION {"schemaVersion":1,"status":"error"}',file)).knownStructures,undefined);
  }finally{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^exploration-guidance-/);
    await rm(root,{recursive:true,force:true});
  }
});
