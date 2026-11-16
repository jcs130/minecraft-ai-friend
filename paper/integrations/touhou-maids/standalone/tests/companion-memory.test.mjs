import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runOnce} from '../companion-memory.mjs';

const npc='10000000-0000-0000-0000-000000000011',other='10000000-0000-0000-0000-000000000012';
const a='20000000-0000-0000-0000-000000000021',b='20000000-0000-0000-0000-000000000022';
const coreRoot=fileURLToPath(new URL('../../../../../packages/agent-mc-world',import.meta.url));

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'companion-memory-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const cfg={schema:1,coreRoot,source:true,journalRoot:join(root,'journal'),dataDir:join(root,'memory'),
    realm:'synthetic-companion-tests',npcs:[{maidId:npc},{maidId:other}]};
  async function evidence(maid,speaker,id,reply) {
    const dir=join(cfg.journalRoot,maid);await mkdir(dir,{recursive:true});
    const row={schemaVersion:1,id,maidId:maid,speakerId:speaker,message:'一起去冒险吗？',at:1000};
    await writeFile(join(dir,id+'-request.json'),JSON.stringify(row));
    await writeFile(join(dir,id+'-result.json'),JSON.stringify({...row,status:'answered',decision:'talk',reply}));
  }
  return {root,cfg,evidence};
}

test('core notebook retains Unicode evidence, deduplicates after importer crash, and isolates each speaker/NPC',async t=>{
  const {cfg,evidence}=await fixture(t);
  await evidence(npc,a,'30000000-0000-0000-0000-000000000031','阿岚，我们一起找种子');
  await evidence(npc,b,'30000000-0000-0000-0000-000000000032','仅与乙共享的经历');
  await evidence(other,a,'30000000-0000-0000-0000-000000000033','另一角色的经历');
  assert.equal((await runOnce(cfg))[0].imported,2);
  const read=p=>readFile(p,'utf8').then(JSON.parse);
  const receipt=join(cfg.dataDir,npc,'companion-import.json');
  const before=await read(receipt);
  await rm(receipt); // Simulates crash after core stored notes, before importer saved its bookkeeping.
  await runOnce(cfg);
  assert.deepEqual(Object.fromEntries(Object.entries(await read(receipt)).map(([k,v])=>[k,v.id])),
    Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.id])));
  const recall=await read(join(cfg.journalRoot,npc,`recall-${a}.json`));
  assert.equal(recall.historical,true);assert.equal(recall.items.length,1);
  assert.match(recall.items[0].evidence.reply,/阿岚/);
  assert.doesNotMatch(JSON.stringify(recall),/仅与乙共享|另一角色/);
  assert.equal((await runOnce(cfg))[0].imported,0);
});

test('shared external scope, duplicate identity and simultaneous writers are rejected',async t=>{
  const {cfg}=await fixture(t);
  await assert.rejects(runOnce({...cfg,npcs:[{maidId:npc},{maidId:npc}]}),/duplicate/);
  const memory={mode:'remote',provider:'powercontext',endpoint:'http://localhost:1',scopeId:'shared'};
  await assert.rejects(runOnce({...cfg,npcs:[{maidId:npc,memory},{maidId:other,memory}]}),/shared_memory_scope/);
  await mkdir(join(cfg.dataDir,'companion-sync.lock'),{recursive:true});
  await assert.rejects(runOnce(cfg),{code:'EEXIST'});
});

test('unavailable PowerContext keeps durable local evidence and performs no unconfirmed write replay',async t=>{
  const {cfg,evidence}=await fixture(t);
  await evidence(npc,a,'30000000-0000-0000-0000-000000000031','网络断开时也要记住');
  cfg.npcs=[{maidId:npc,memory:{mode:'remote',provider:'powercontext',scopeId:'dedicated-synthetic',
    endpoint:'http://127.0.0.1:1',timeoutMs:100}}];
  await runOnce(cfg);
  const first=JSON.parse(await readFile(join(cfg.dataDir,npc,'companion-import.json'),'utf8'));
  assert.equal(Object.keys(first).length,1);
  assert.notEqual(Object.values(first)[0].index.status,'stored');
  const recall=JSON.parse(await readFile(join(cfg.journalRoot,npc,`recall-${a}.json`),'utf8'));
  assert.match(recall.items[0].evidence.reply,/网络断开/);
  assert.equal(recall.retrieval.degraded,true);
  assert.equal((await runOnce(cfg))[0].imported,0);
});
