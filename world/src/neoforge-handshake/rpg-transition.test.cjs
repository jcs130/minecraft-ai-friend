'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const t=require('./rpg-transition.cjs')
test('only declared native arena transfers accept a live same-body destination receipt',()=>{
  const uuid='11111111-2222-3333-8444-555555555555'
  const r={ok:true,playerUuid:uuid,actorDimension:'maw:trials',actorAlive:true}
  assert.equal(t.confirmed('arena.lobby',r,uuid),true)
  for(const bad of [{...r,actorAlive:false},{...r,actorDimension:'minecraft:overworld'},{...r,playerUuid:'other'},{...r,ok:false},{...r,outcomeKnown:false}])assert.equal(t.confirmed('arena.lobby',bad,uuid),false)
  assert.equal(t.confirmed('body.command',r,uuid),false)
  assert.equal(t.expectedKind('rpg_skill_cast'),false)
})
