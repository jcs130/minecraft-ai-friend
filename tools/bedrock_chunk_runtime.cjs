'use strict'
// Read an exact network runtime at an absolute coordinate, including custom
// palettes absent from minecraft-data. Only un-cached v8/v9 network chunks.
const assert=require('node:assert/strict')
function runtimeAt(packet,pos){
 if(packet.x!==Math.floor(pos.x/16)||packet.z!==Math.floor(pos.z/16)||packet.cache_enabled)return undefined
 const data=packet.payload;let at=0;const need=n=>assert(at+n<=data.length,'truncated Bedrock chunk')
 const byte=()=>{need(1);return data[at++]},vi=()=>{let n=0;for(let i=0;i<5;i++){const v=byte();n+=(v&127)*2**(7*i);if(!(v&128))return n>>>0}throw Error('Bedrock varint')},zig=()=>{const n=vi();return (n>>>1)^-(n&1)}
 for(let s=0;s<packet.sub_chunk_count;s++){
  const version=byte();assert(version===8||version===9,'Bedrock subchunk version');const layers=byte(),y=version===9?(byte()<<24>>24):s-4
  for(let l=0;l<layers;l++){
   const h=byte(),bits=h>>1;assert(h&1,'network palette');assert(bits<=16,'palette bits');let index=0
   if(bits){const per=Math.floor(32/bits),words=Math.ceil(4096/per);need(words*4);if(y===Math.floor(pos.y/16)&&l===0){const cell=((pos.x&15)<<8)|((pos.z&15)<<4)|(pos.y&15);index=(data.readUInt32LE(at+Math.floor(cell/per)*4)>>>((cell%per)*bits))&((1<<bits)-1)}at+=words*4}
   const count=bits?zig():1;assert(count>=1&&count<=65536);let value
   for(let i=0;i<count;i++){const id=zig()>>>0;if(i===index)value=id}
   if(y===Math.floor(pos.y/16)&&l===0)return value
  }
 }
}
module.exports={runtimeAt}
