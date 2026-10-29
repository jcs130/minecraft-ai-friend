'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { properties,validateProduct,applyNativeRegistry } = require('../native_registry.cjs')
test('native property product preserves boolean and integer values in actual state order', () => {
  const rows=[];for(const facing of ['north','south'])for(const waterlogged of ['true','false'])rows.push({id:100+rows.length,name:'mod:stairs',properties:{waterlogged,facing}})
  const props=properties(rows);validateProduct(rows,props)
  assert.deepEqual(props.map(p=>p.name),['facing','waterlogged']);assert.deepEqual(props[1].values,[true,false])
  assert.throws(()=>validateProduct([rows[0],rows[2]],properties([rows[0],rows[2]])),/contiguous/)
  assert.throws(()=>validateProduct(rows.slice(0,3),props),/cartesian/)
})
function fixture (fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sao-registry-test-'))
  const epoch='11111111-1111-1111-1111-111111111111', base=path.join(root,'server/maw-sao/registry'), dir=path.join(base,epoch)
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'lab-process.json'),JSON.stringify({phase:'ready',pid:42}))
  fs.writeFileSync(path.join(base,'current.json'),JSON.stringify({minecraft:'1.20.1',processId:42,serverEpoch:epoch,states:2,items:1,entities:1}))
  const rows=[{id:0,blockId:0,name:'minecraft:air',properties:{},hardness:0,canOcclude:false,defaultStateId:0,shapeAvailable:true,collisionShapes:[]},
    {id:900,blockId:123,name:'mod:glass',properties:{},hardness:1,canOcclude:false,defaultStateId:900,shapeAvailable:true,collisionShapes:[[0,0,0,1,1,1]]}]
  const write=(file,data)=>fs.writeFileSync(path.join(dir,file),data.map(x=>JSON.stringify(x)).join('\n'))
  write('states.jsonl',rows);write('items.jsonl',[{id:31337,name:'mod:knife',stackSize:1,descriptionId:'item.mod.knife'}]);write('entities.jsonl',[{id:777,name:'mod:maid',category:'creature'}])
  try {fn({root,base,dir,rows,write})} finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'sao-registry-test-'))
    fs.rmSync(root,{recursive:true,force:true})
  }
}
const blank=()=>({blocksByName:{},itemsByName:{},entitiesByName:{}})
test('real native IDs remain intact and glass is visible through but physically solid', () => fixture(({root})=>{
  const r=blank(), meta=applyNativeRegistry(r,root)
  assert.equal(r.items[31337].name,'mod:knife');assert.equal(r.entities[777].name,'mod:maid')
  assert.equal(r.blocks[123].transparent,true);assert.equal(r.blocks[123].boundingBox,'block')
  assert.equal(r.blocksByStateId[900].nativeId,'mod:glass');assert.equal(meta.nativeIdsPreserved,true)
}))
test('unknown collision stays explicitly unknown and cannot become traversable air', () => fixture(({root,rows,write})=>{
  rows[1].shapeAvailable=false;rows[1].collisionShapes=null;write('states.jsonl',rows)
  const r=blank(),meta=applyNativeRegistry(r,root)
  assert.equal(meta.unknownShapes,1);assert.equal(r.blocks[123].shapeStatus,'unknown_requires_live_context');assert.equal(r.blocks[123].boundingBox,'block')
}))
test('stale boot and changed registry counts refuse a body', () => fixture(({root,base})=>{
  const file=path.join(base,'current.json'), meta=JSON.parse(fs.readFileSync(file));meta.processId=43;fs.writeFileSync(file,JSON.stringify(meta))
  assert.throws(()=>applyNativeRegistry(blank(),root),/stale_or_unready/)
  meta.processId=42;meta.items=2;fs.writeFileSync(file,JSON.stringify(meta));assert.throws(()=>applyNativeRegistry(blank(),root),/count_mismatch/)
}))
