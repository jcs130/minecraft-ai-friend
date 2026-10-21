'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib')
const {BedrockBlocks,CHANNEL}=require('./bedrock-blocks.cjs')
const {visitChunk}=require('./native-chunk-remap.cjs')
const vi=n=>{const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b)}while(n);return Buffer.from(a)}
const section=id=>Buffer.concat([Buffer.from([0,1,0]),vi(id),Buffer.from([0,0,1,0])])
const catalog=()=>({schemaVersion:1,states:[{nativeId:99999,javaId:165535},{nativeId:100000,javaId:165536}]})
function observer(){const o=new BedrockBlocks(catalog());o.project('registry_data',{id:'minecraft:dimension_type',entries:[{value:{value:{min_y:{value:-64}}}}]});o.project('login',{worldState:{dimension:0}});return o}
function frame(packet){assert.equal(packet.params.channel,CHANNEL);const b=packet.params.data;assert.equal(b.toString('ascii',0,4),'MWB1');const raw=zlib.inflateRawSync(b.subarray(13));assert.equal(raw.length,b.readUInt32BE(9));return {kind:b[4],sequence:b.readUInt32BE(5),raw}}
test('read-only native chunk visitor preserves source bytes and resolves large direct and single palettes',()=>{
  const input=Buffer.concat([section(99999),section(0)]),before=Buffer.from(input),rows=[]
  assert.equal(visitChunk(input,(index,values)=>rows.push([index,values[0],values.length])),2)
  assert.deepEqual(rows,[[0,99999,4096],[1,0,4096]]);assert.deepEqual(input,before)
})
test('observer readiness buffers complete immutable wire packets; only block packets replay once',()=>{
  const o=observer(),p={x:-2,z:3,chunkData:section(99999),blockEntities:[{nbtData:{value:Buffer.from([1,2])}}],skyLight:[Buffer.from([3,4])],long:15n}
  assert.deepEqual(o.project('map_chunk',p),[]);p.chunkData[0]=9;p.blockEntities[0].nbtData.value[0]=8
  const replay=o.activate();assert.equal(replay.length,1);assert.ok(Buffer.isBuffer(replay[0].params.skyLight[0]));assert.ok(Buffer.isBuffer(replay[0].params.blockEntities[0].nbtData.value));assert.equal(replay[0].params.chunkData[0],0);assert.equal(replay[0].params.blockEntities[0].nbtData.value[0],1);assert.equal(replay[0].params.long,15n);assert.deepEqual(o.activate(),[])
  const f=frame(o.project(replay[0].name,replay[0].params)[0]);assert.equal(f.kind,1);assert.equal(f.raw.readInt16BE(8),-4);assert.equal(f.raw.readUInt16BE(10),1);assert.equal(f.raw.readUInt16BE(14),4096);assert.equal(f.raw.readUInt32BE(18),165535)
})
test('single/multi updates use distinct native encoding and absolute signed positions',()=>{
  const o=observer();o.activate();const f=frame(o.project('block_change',{location:{x:-31,y:-29,z:48},type:99999})[0]);assert.equal(f.kind,2);assert.equal(f.raw.readInt32BE(4),-31);assert.equal(f.raw.readInt32BE(8),-29);assert.equal(f.raw.readUInt32BE(16),165535)
  const m=frame(o.project('multi_block_change',{chunkCoordinates:{x:-2,y:-2,z:3},records:[100000*4096+(1<<8)+(5<<4)+3,0]})[0]);assert.equal(m.raw.readUInt32BE(0),1);assert.deepEqual([4,8,12,16].map(at=>m.raw.readInt32BE(at)),[-31,-29,53,165536]);assert.equal(m.sequence,2)
  assert.deepEqual(o.project('block_change',{location:{x:0,y:0,z:0},type:0}),[])
})
test('dimension changes discard obsolete replay; missing registry and duplicate IDs fail explicitly',()=>{
  const o=observer();o.project('map_chunk',{x:0,z:0,chunkData:section(99999)});o.project('respawn',{worldState:{dimension:1}});assert.deepEqual(o.activate(),[])
  assert.throws(()=>o.project('map_chunk',{x:0,z:0,chunkData:section(99999)}),/DIMENSION_UNAVAILABLE/)
  assert.throws(()=>new BedrockBlocks({schemaVersion:1,states:[...catalog().states,catalog().states[0]]}),/INVALID_NATIVE_BLOCK_ID/)
  assert.equal(BedrockBlocks.load(undefined),null)
})
test('native item observer replays inventory once after attachment without leaking state into frames',()=>{
 const o=new BedrockBlocks({...catalog(),blockItems:[{nativeId:44}]});const p={windowId:0,items:[{itemCount:2,itemId:44,components:[]}]}
 assert.deepEqual(o.project('window_items',p),[]);p.items[0].itemCount=0
 const replay=o.activate();assert.equal(replay.length,1);assert.equal(replay[0].params.items[0].itemCount,2);assert.deepEqual(o.project(replay[0].name,replay[0].params),[])
 const plain=new BedrockBlocks(catalog());plain.project('window_items',p);assert.deepEqual(plain.activate(),[])
})
