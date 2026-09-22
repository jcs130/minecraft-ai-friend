import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { publicNpcs, publicTarget, enqueuePublicNpc } from '../src/application/public-npc-chat.ts'
import { decideIntent, intentQuestions, createJevIntent } from '../src/application/jev-intent.ts'
const profiles = [{ key:'hesu', tag:'npc_hesu', display:'老农·禾叔', calls:['禾叔'], profession:'farmer' },
  { key:'zhujiu', tag:'npc_zhujiu', display:'守夜人·烛九', calls:['烛九'], profession:'toolsmith' }]
const npcs = publicNpcs({villagers:profiles})
const uncertain = {route:'uncertain'}
test('candidate identities are bounded and malformed profiles are excluded', () => {
  assert.equal(npcs.length, 2)
  assert.match(npcs[0].revision, /^[0-9a-f]{64}$/)
  assert.equal(publicNpcs([...profiles, profiles[0], {...profiles[1], key:'bad key'}, {...profiles[0], key:'dead', alive:false}]).length,2)
  assert.equal(publicNpcs([{...profiles[0], topics:{bad:true}}]).length,1)
  assert.notEqual(publicNpcs([{...profiles[0], calls:['农夫']}])[0].revision,npcs[0].revision)
})
test('one public classification includes NPCs but never spells or arbitrary recipients', () => {
  const input={actor:'Tester',text:'烛九，禾叔说最近有故事？',channel:'public',npcs}
  const q=intentQuestions('public', [], npcs)
  assert.deepEqual(Object.keys(q),['route'])
  assert.equal(q.route.criteria.cast,undefined)
  const a={type:'choice',choice:'npc:zhujiu',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.route.criteria).map(k=>[k,k==='npc:zhujiu'?1:0]))}
  const d=decideIntent(input,[],{route:a})
  assert.deepEqual(d,{route:'npc',npcKey:'zhujiu'})
  assert.equal(publicTarget(input.text,d,npcs,[],true),'zhujiu')
  assert.equal(decideIntent({...input,channel:'private'},[],{route:a}).route,'uncertain')
  assert.equal(decideIntent(input,[],{route:{...a,choice:'npc:invented'}}).route,'uncertain')
  assert.equal(decideIntent(input,[],{route:{...a,confidence:.7}}).route,'uncertain')
})
test('fallback only addresses one known NPC; mentioning somebody does not redirect speech', () => {
  assert.equal(publicTarget('烛九，禾叔怎么样？',uncertain,npcs,[],true),'zhujiu')
  assert.equal(publicTarget('女神，烛九怎么样？',uncertain,npcs,[],true),'goddess')
  assert.equal(publicTarget('桐人，你认识烛九吗？',uncertain,npcs,['桐人'],true),null)
  assert.equal(publicTarget('大家最近如何', {route:'observe'}, npcs, [],true),null)
  assert.equal(publicTarget('烛九你好',{route:'npc',npcKey:'missing'},npcs,[],true),null)
  assert.equal(publicTarget('禾叔，你好',uncertain,[...npcs,{...npcs[1],calls:['禾叔']}],[],true),null)
})
test('transport preserves public scope, identity, unique event and freshness', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'npc-chat-'))
  try {
    const file=path.join(tmp,'inbox.jsonl')
    assert.equal(enqueuePublicNpc(file,npcs[0],'Tester','禾叔 给6小麦',1000,1001),true)
    assert.equal(enqueuePublicNpc(file,npcs[0],'Tester','禾叔 你好',1000,1001),true)
    const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(rows[0].via,'public-routed');assert.equal(rows[0].profileRevision,npcs[0].revision)
    assert.notEqual(rows[0].eventId, rows[1].eventId)
    for(const [speaker,text,at] of [['bad"name','hi',1000],['Tester','hi\ncmd',1000],['Tester','hi',-5000]])
      assert.equal(enqueuePublicNpc(file,npcs[0],speaker,text,at,1001),false)
    assert.equal(fs.readFileSync(file,'utf8').trim().split('\n').length,2)
  } finally { fs.rmSync(tmp,{recursive:true,force:true}) }
})
test('public route performs a single provider call and preserves selected key', async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'npc-classifier-'));let count=0
  try{
    const keyFile=path.join(tmp,'key');fs.writeFileSync(keyFile,'synthetic-key-only')
    const client=createJevIntent({keyFile,fetcher:async(_,options)=>{
      count++;const q=JSON.parse(options.body).questions;assert.deepEqual(Object.keys(q),['route'])
      return Response.json({answers:{route:{type:'choice',choice:'npc:hesu',confidence:.99,
        probabilities:Object.fromEntries(Object.keys(q.route.criteria).map(k=>[k,k==='npc:hesu'?1:0]))}}})
    }})
    assert.deepEqual(await client.classify({actor:'Tester',text:'禾叔，最近有什么事？',channel:'public',npcs},[]),{route:'npc',npcKey:'hesu'})
    assert.equal(count,1)
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
})
