import test from 'node:test';
import assert from 'node:assert/strict';
import {photoImageQuality} from './photo-image-quality.mjs';
const pixels=(fn)=>({width:96,height:96,data:Uint8Array.from({length:96*96*4},(_,i)=>i%4===3?255:fn(Math.floor(i/4)%96,Math.floor(i/384)))});
test('dark, white and uniform images cannot be mistaken for detailed scenes',()=>{
  assert.equal(photoImageQuality(pixels(()=>0)).darkFraction,1);
  assert.equal(photoImageQuality(pixels(()=>255)).brightFraction,1);
  assert.equal(photoImageQuality(pixels(()=>127)).contrast,0);
});
test('structured scenery yields contrast while darker pixels are counted separately',()=>{
  const result=photoImageQuality(pixels(x=>x<48?40:180));assert.ok(result.contrast>60);assert.equal(result.darkFraction,0);assert.equal(result.brightFraction,0);
});
test('malformed or unbounded buffers are rejected',()=>{
  for(const bad of [{width:0,height:1,data:[]},{width:8192,height:8192,data:[]},{width:1,height:1,data:[0,0]}])assert.throws(()=>photoImageQuality(bad));
});
