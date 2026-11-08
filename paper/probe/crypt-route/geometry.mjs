// Build an isolated, sanitized block-geometry region; never copy player/entity/inventory data.
import fs from 'node:fs/promises';import path from'node:path';import assert from'node:assert/strict';
import{inflateSync,gunzipSync,deflateSync}from'node:zlib';import{createHash}from'node:crypto';import{createRequire}from'node:module';
const [source,stage,out,anchor]=process.argv.slice(2);assert(source&&stage&&out&&anchor);
assert.equal(await fs.readFile(path.join(stage,'.shop-qa'),'utf8'),'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');
assert.equal(path.basename(source),'r.2.0.mca');const nbt=createRequire(anchor)('prismarine-nbt'),raw=await fs.readFile(source),hash=createHash('sha256').update(raw).digest('hex');
const worldName=process.env.CRYPT_QA_WORLD_NAME??'world';assert(['world','crypt_route_qa'].includes(worldName));
const dir=path.join(stage,worldName);await fs.mkdir(path.join(dir,'region'),{recursive:true});
const target=path.join(dir,'region/r.2.0.mca');assert(!await fs.stat(target).catch(()=>null),'Preserve an existing geometry fixture instead of overwriting it');
const headers=Buffer.alloc(8192),parts=[];let offset=2,removedBlockEntities=0,chunks=0;
for(let cx=66;cx<=76;cx++)for(let cz=10;cz<=19;cz++){
 const slot=(cx&31)+(cz&31)*32,at=raw.readUIntBE(slot*4,3)*4096;assert(at,'All bounded source chunks must exist');
 const length=raw.readUInt32BE(at),mode=raw[at+4];assert([1,2,3].includes(mode));const bytes=raw.subarray(at+5,at+4+length),root=(await nbt.parse(mode===2?inflateSync(bytes):mode===1?gunzipSync(bytes):bytes)).parsed,c=root.value;
 assert(c.xPos.value===cx&&c.zPos.value===cz&&c.sections?.value?.value);removedBlockEntities+=c.block_entities?.value?.value?.length??0;
 const v={};for(const key of['DataVersion','xPos','yPos','zPos','Heightmaps','isLightOn'])if(c[key])v[key]=c[key];
 v.Status={type:'string',value:'minecraft:full'};v.LastUpdate={type:'long',value:[0,0]};v.InhabitedTime={type:'long',value:[0,0]};
 v.sections={type:'list',value:{type:'compound',value:c.sections.value.value.map(s=>{
  const a={Y:s.Y};for(const k of['block_states','SkyLight','BlockLight'])if(s[k])a[k]=s[k];
  a.biomes={type:'compound',value:{palette:{type:'list',value:{type:'string',value:['minecraft:plains']}}}};return a;
 })}};
 for(const k of['block_entities','block_ticks','fluid_ticks'])v[k]={type:'list',value:{type:'compound',value:[]}};
 v.structures={type:'compound',value:{starts:{type:'compound',value:{}},References:{type:'compound',value:{}}}};
 const encoded=deflateSync(nbt.writeUncompressed({type:'compound',name:'',value:v})),sectors=Math.ceil((5+encoded.length)/4096),part=Buffer.alloc(sectors*4096);part.writeUInt32BE(encoded.length+1);part[4]=2;encoded.copy(part,5);headers.writeUIntBE(offset,slot*4,3);headers[slot*4+3]=sectors;headers.writeUInt32BE(0,4096+slot*4);offset+=sectors;parts.push(part);chunks++;
}
await fs.writeFile(target,Buffer.concat([headers,...parts]),{flag:'wx'});await fs.writeFile(path.join(dir,'.geometry-only'),'CRYPT_GEOMETRY_NO_ENTITIES_NO_INVENTORIES');
const report={sourceSha256:hash,sourceBytes:raw.length,geometrySha256:createHash('sha256').update(await fs.readFile(target)).digest('hex'),chunks,removedBlockEntities,rootKeysRetained:['DataVersion','xPos','yPos','zPos','Heightmaps','isLightOn','Status','sections'],entitiesCopied:0,playerFilesCopied:0,inventoryContentsCopied:0,productionModified:false,collisionBlockStatesPreserved:true};await fs.writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
