'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), mc = require('minecraft-protocol')
const { createBedrockFrontendProtocol } = require('./component-protocol.cjs')
test('real Bedrock/Via protocol 767 omits the later potion customName byte without altering Mineflayer', () => {
  const registry = require('minecraft-data')('1.21.1')
  const potion = { itemCount:1,itemId:registry.itemsByName.potion.id,addedComponentCount:1,removedComponentCount:0,
    components:[{type:'potion_contents',data:{potionId:22,customColor:undefined,customEffects:[]}}],removeComponents:[] }
  const params = { entityId:137,metadata:[{key:8,type:'item_stack',value:potion},{key:9,type:'string',value:'minecraft:potion'}] }
  const bedrock = createBedrockFrontendProtocol(), nativeBytes=bedrock.createPacketBuffer('packet',{name:'entity_metadata',params})
  const vanilla = mc.createSerializer({state:mc.states.PLAY,isServer:true,version:'1.21.1'})
  const compatibilityBytes = vanilla.createPacketBuffer({name:'entity_metadata',params})
  assert.equal(compatibilityBytes.length,nativeBytes.length+1)
  const decoded = bedrock.parsePacketBuffer('packet',nativeBytes)
  assert.equal(decoded.metadata.size,nativeBytes.length);assert.equal(decoded.data.params.metadata[1].value,'minecraft:potion')
  assert.throws(()=>bedrock.parsePacketBuffer('packet',compatibilityBytes))
  // The real vanilla dependency is intentionally unchanged for its own peer.
  const own = mc.createDeserializer({state:mc.states.PLAY,isServer:false,version:'1.21.1'}).parsePacketBuffer(compatibilityBytes)
  assert.equal(own.data.params.metadata[1].value,'minecraft:potion')
})
