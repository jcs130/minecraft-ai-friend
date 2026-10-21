'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { CHANNEL, decodeAdvancedContainerData } = require('./advanced-container-data.cjs')
const { encodeNativePacket, decodeNativePacket } = require('./native-viewer-packet.cjs')
test('NeoForge byte/short/varint progress keeps both negative and full-width native values', () => {
  for (const [hex, value] of [['02000164',100],['020001c801',200],['02000180f104',80000],['020001ffffffff0f',-1]]) {
    const bytes = Buffer.from(hex,'hex')
    assert.deepEqual(decodeAdvancedContainerData(bytes), { windowId:2,property:1,value })
    const decoded = decodeNativePacket(encodeNativePacket('custom_payload',{channel:CHANNEL,data:bytes},'a'.repeat(64),1),'a'.repeat(64))
    assert.equal(decoded.name,'craft_progress_bar');assert.equal(decoded.params.value,value);assert.equal(decoded.params.sourceChannel,CHANNEL)
  }
  for (const hex of ['020001','02000180','0200010000','020001ffffffff1f'])assert.throws(()=>decodeAdvancedContainerData(Buffer.from(hex,'hex')),/INVALID_ADVANCED/)
})
