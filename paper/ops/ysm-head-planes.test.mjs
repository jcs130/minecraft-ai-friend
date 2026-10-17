import test from 'node:test';
import assert from 'node:assert/strict';
import {splitYsmHeadPlanes} from './ysm-head-planes.mjs';

const cube=inflate=>({origin:[-4,24,-4],size:[8,8,8],...(inflate?{inflate}:{}),uv:{
  north:{uv:[8,8],uv_size:[8,8]},south:{uv:[24,8],uv_size:[8,8]},
  east:{uv:[0,8],uv_size:[8,8]},west:{uv:[16,8],uv_size:[8,8]},
  up:{uv:[8,0],uv_size:[8,8]},down:{uv:[16,8],uv_size:[8,-8]}
}});
const source=()=>({format_version:'1.12.0','minecraft:geometry':[{description:{identifier:'geometry.neko_yui',texture_width:64,texture_height:64},bones:[
  {name:'Head',pivot:[0,24,0],cubes:[cube(0),{origin:[0,33,0],size:[1,1,1],uv:[0,0]}]},
  {name:'Hat',parent:'Head',pivot:[0,24,0],cubes:[cube(.13)]},
  {name:'Ear',parent:'Head',pivot:[0,32,0],cubes:[{origin:[0,32,0],size:[1,3,1],uv:[8,0]}]}
]}]});

test('head/hat caps preserve original UVs, six surfaces, other cubes and source object',()=>{
  const original=source(),before=structuredClone(original),after=splitYsmHeadPlanes(original);
  assert.deepEqual(original,before);
  assert.deepEqual(after['minecraft:geometry'][0].description,before['minecraft:geometry'][0].description);
  for(let i=0;i<2;i++){
    const old=before['minecraft:geometry'][0].bones[i],bone=after['minecraft:geometry'][0].bones[i];
    assert.equal(bone.cubes.length,old.cubes.length+2);
    assert.deepEqual(bone.cubes.slice(1,-2),old.cubes.slice(1));
    assert.deepEqual(Object.keys(bone.cubes[0].uv),['north','south','east','west']);
    const [top,bottom]=bone.cubes.slice(-2);
    assert.deepEqual(top.uv,{up:old.cubes[0].uv.up});assert.deepEqual(bottom.uv,{down:old.cubes[0].uv.down});
    assert.equal(top.size[1],0);assert.equal(bottom.size[1],0);
    assert.equal(Object.keys(bone.cubes[0].uv).length+Object.keys(top.uv).length+Object.keys(bottom.uv).length,6);
  }
  assert.deepEqual(after['minecraft:geometry'][0].bones[2],before['minecraft:geometry'][0].bones[2]);
});

test('inflated hat planes occupy the original outer surfaces without enlarging the model',()=>{
  const hat=splitYsmHeadPlanes(source())['minecraft:geometry'][0].bones[1];
  const [top,bottom]=hat.cubes.slice(-2);
  assert.deepEqual(top.origin,[-4.13,32.13,-4.13]);assert.deepEqual(bottom.origin,[-4.13,23.87,-4.13]);
  assert.deepEqual(top.size,[8.26,0,8.26]);assert.deepEqual(bottom.size,top.size);
  assert.equal(top.inflate,undefined);assert.equal(bottom.inflate,undefined);
  assert.equal(hat.cubes[0].inflate,.13);
});

test('refuses duplicate conversion and unsupported cubes instead of corrupting original resources',()=>{
  assert.throws(()=>splitYsmHeadPlanes(splitYsmHeadPlanes(source())),/CUBE_UNSUPPORTED/);
  assert.throws(()=>splitYsmHeadPlanes(source(),['Missing']),/CUBE_UNSUPPORTED/);
  for(const change of[c=>c.rotation=[0,30,0],c=>c.mirror=true,c=>c.size[1]=0,c=>c.uv=[0,0],c=>c.inflate=NaN]){
    const d=source();change(d['minecraft:geometry'][0].bones[0].cubes[0]);assert.throws(()=>splitYsmHeadPlanes(d),/CUBE_UNSUPPORTED/);
  }
});
