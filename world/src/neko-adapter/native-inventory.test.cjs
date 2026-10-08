'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { nativeInventoryText } = require('./native-inventory.cjs')
const UUID='11111111-1111-4111-8111-111111111111'
function player () {
  const book={id:'patchouli:guide_book',count:1,snbt:'{id:"patchouli:guide_book",count:1}',displayName:'原生指南'}
  const state={playerUuid:UUID,windowId:2,stateId:5,menuType:'curios:curios_container',selectedHotbarSlot:0,
    slots:Array(52).fill(null),playerInventory:Array(46).fill(null),carried:null}
  state.slots[9]=book; state.playerInventory[9]=book
  const agent={bot:{_client:{uuid:UUID},inventory:{slots:Array(46).fill({name:'paper',count:99})},mawNative:{sdk:{menu:{current:()=>state}}}}}
  return {agent,state,book}
}
test('native prompt inventory shows true mod item location after a GUI transfer, never stale proxy paper', () => {
  const {agent,state,book}=player()
  const data=JSON.parse(nativeInventoryText(agent).split('\n')[1])
  assert.equal(data.slots.length,1); assert.equal(data.slots[0].slot,9); assert.equal(data.slots[0].id,'patchouli:guide_book')
  assert.equal(data.slots[0].count,1); assert.equal(data.slots[0].name,'原生指南')
  assert.equal(data.carried,null); assert.equal(nativeInventoryText(agent).includes('paper'),false)
  state.playerInventory[9]=null; state.carried=book
  const picking=JSON.parse(nativeInventoryText(agent).split('\n')[1])
  assert.equal(picking.slots.length,0); assert.equal(picking.carried.id,'patchouli:guide_book')
})
test('missing/foreign/malformed native state is unavailable without a proxy fallback; vanilla opt-out is unchanged', () => {
  const {agent,state}=player()
  state.playerUuid='22222222-2222-4222-8222-222222222222'
  assert.match(nativeInventoryText(agent),/UNAVAILABLE/)
  state.playerUuid=UUID; state.playerInventory[4]={id:'minecraft:paper',count:0,snbt:'{}'}
  assert.match(nativeInventoryText(agent),/snapshot_invalid/)
  delete agent.bot.mawNative
  assert.equal(nativeInventoryText(agent),null)
})
