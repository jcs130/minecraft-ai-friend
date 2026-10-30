'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Reader, uint, wrapped, extraHandshake, withoutNumen } = require('../forge_client.cjs')
const string = text => Buffer.concat([uint(Buffer.byteLength(text)),Buffer.from(text)])
test('TACZ mapping uses its own empty discriminator 1 ACK', () => {
  const count=Buffer.alloc(4);count.writeInt32BE(1)
  const out=extraHandshake('tacz:handshake',Buffer.concat([uint(2),count,string('minecraft:player'),string('tacz:aiming'),uint(21)]))
  assert.deepEqual(out.ack,Buffer.from([1]))
  assert.deepEqual(out.state.mappings,[{entity:'minecraft:player',key:'tacz:aiming',id:21}])
})
test('season config is retained as data and ACK 99 stays on its mod channel', () => {
  const text='enabled=true\n', data=Buffer.from(text)
  const out=extraHandshake('eclipticseasons:main',Buffer.concat([uint(12),string('../server.toml'),uint(data.length),data]))
  assert.equal(out.state.name,'../server.toml');assert.equal(out.state.text,text);assert.equal(out.state.bytes,data.length)
  const r=new Reader(wrapped('eclipticseasons:main',out.ack))
  assert.equal(r.string(),'eclipticseasons:main');assert.deepEqual(r.bytes(r.uint()),Buffer.from([99]));r.done()
})
test('unimplemented channels and changed discriminators fail closed', () => {
  assert.throws(()=>extraHandshake('newmod:login',uint(1)),/unsupported_mod_login/)
  assert.throws(()=>extraHandshake('eclipticseasons:main',uint(98)),/unsupported_mod_login/)
})
test('malformed varints, utf8, lengths and trailing bytes are diagnosed', () => {
  assert.throws(()=>new Reader(Buffer.from([128])).uint(),/truncated_varint/)
  assert.throws(()=>new Reader(Buffer.from([1,255])).string(),/encoded data/)
  assert.throws(()=>new Reader(Buffer.from([2,0])).string(),/truncated_or_overlimit/)
  assert.throws(()=>new Reader(Buffer.from([0])).done(),/trailing/)
  assert.throws(()=>extraHandshake('tacz:handshake',Buffer.from([2,255,255,255,255])),/mapping_budget/)
})
test('a client without Numen still advertises the other required mod channels unchanged', () => {
  const list=(rows,encode)=>Buffer.concat([uint(rows.length),...rows.map(encode)])
  const mods=['forge','numen','numen_api','numen_tlm','othermod']
  const channels=[['numen:main','1'],['numen_api:main','1'],['numen_tlm:outfit','1'],['othermod:main','2'],['maw_agent:world_query','1'],['numen_tools:main','3']]
  const input=Buffer.concat([uint(1),list(mods,string),list(channels,c=>Buffer.concat(c.map(string))),list(['minecraft:item'],string),uint(0)])
  const r=new Reader(withoutNumen(input));assert.equal(r.uint(),2)
  const readList=read=>Array.from({length:r.uint()},read)
  assert.deepEqual(readList(()=>r.string()),['forge','othermod'])
  assert.deepEqual(readList(()=>[r.string(),r.string()]),[['othermod:main','2'],['maw_agent:world_query','1'],['numen_tools:main','3']])
  assert.deepEqual(readList(()=>[r.string(),r.string()]),[['minecraft:item','1.0']]);r.done()
})
