import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {deflateSync,inflateSync} from 'node:zlib';
import {patchCryptRegion} from './crypt-connector-region.mjs';
// Run from a locked MC-core installation; prismarine-nbt is Mineflayer's own dependency.
const req=createRequire(resolve('package.json')),nbt=createRequire(req.resolve('mineflayer'))('prismarine-nbt');
const cells=JSON.parse(readFileSync(new URL('../probe/crypt-route/connector.json',import.meta.url),'utf8')).cells;
const tag=v=>({Name:{type:'string',value:v.Name},...(v.Properties?{Properties:{type:'compound',value:Object.fromEntries(Object.entries(v.Properties).map(([k,v])=>[k,{type:'string',value:v}]))}}:{})});
const key=v=>JSON.stringify(v);
function fixture(){
    const header=Buffer.alloc(8192),parts=[];let offset=2;
    for(const cx of [71,72,73]){
        const cs=cells.filter(c=>c.pos[0]>>4===cx),palette=[{Name:'minecraft:air'}];
        for(const c of cs)if(!palette.some(p=>key(p)===key(c.before)))palette.push(c.before);
        const values=Array(4096).fill(0);
        for(const c of cs){const [x,y,z]=c.pos;values[(y&15)*256+(z&15)*16+(x&15)]=palette.findIndex(p=>key(p)===key(c.before));}
        const bits=Math.max(4,Math.ceil(Math.log2(palette.length))),per=Math.floor(64/bits),packed=Array(Math.ceil(4096/per)).fill(0n);
        values.forEach((v,i)=>packed[Math.floor(i/per)]|=BigInt(v)<<BigInt(i%per*bits));
        const data=packed.map(v=>[Number(BigInt.asIntN(32,v>>32n)),Number(BigInt.asIntN(32,v))]);
        const root={type:'compound',name:'',value:{DataVersion:{type:'int',value:3955},xPos:{type:'int',value:cx},zPos:{type:'int',value:14},
            InhabitedTime:{type:'long',value:[0,12345]},custom_test_provenance:{type:'string',value:'synthetic-only'},
            Heightmaps:{type:'compound',value:{}},isLightOn:{type:'byte',value:1},
            block_entities:{type:'list',value:{type:'compound',value:[]}},
            sections:{type:'list',value:{type:'compound',value:[{Y:{type:'byte',value:5},block_states:{type:'compound',value:{palette:{type:'list',value:{type:'compound',value:palette.map(tag)}},data:{type:'longArray',value:data}}}}]}}}};
        const compressed=deflateSync(nbt.writeUncompressed(root)),count=Math.ceil((5+compressed.length)/4096),bytes=Buffer.alloc(count*4096);bytes.writeUInt32BE(compressed.length+1);bytes[4]=2;compressed.copy(bytes,5);parts.push(bytes);
        const slot=(cx&31)+14*32;header.writeUIntBE(offset,slot*4,3);header[slot*4+3]=count;header.writeUInt32BE(123,4096+slot*4);offset+=count;
    }
    return Buffer.concat([header,...parts]);
}
async function read(raw,cx){const slot=(cx&31)+14*32,at=raw.readUIntBE(slot*4,3)*4096;return(await nbt.parse(inflateSync(raw.subarray(at+5,at+4+raw.readUInt32BE(at))))).parsed.value;}
test('forward and reverse preserve unrelated bytes and native chunk identities',async()=>{
    const before=fixture(),copy=Buffer.from(before),out=await patchCryptRegion(before,cells,nbt,{timestamp:999});
    assert.deepEqual(before,copy);assert.equal(out.changedCells,34);assert.equal(out.changedChunks,2);
    assert.deepEqual(out.buffer.subarray(8192,before.length),before.subarray(8192));
    assert.deepEqual(await read(out.buffer,71),await read(before,71));
    for(const cx of [72,73]){const c=await read(out.buffer,cx);assert.equal(c.xPos.value,cx);assert.equal(c.zPos.value,14);assert.equal(c.custom_test_provenance.value,'synthetic-only');assert.deepEqual(c.InhabitedTime.value,(await read(before,cx)).InhabitedTime.value);}
    const back=await patchCryptRegion(out.buffer,cells,nbt,{reverse:true,timestamp:1000});
    assert.equal(back.changedCells,34);assert.equal(back.changedChunks,2);
    await patchCryptRegion(back.buffer,cells,nbt,{timestamp:1001});
});
test('mismatched original cell blocks the whole transformation',async()=>{
    const wrong=structuredClone(cells);wrong[0].before={Name:'minecraft:diamond_block'};
    await assert.rejects(patchCryptRegion(fixture(),wrong,nbt),/preimage changed/);
});
test('rollback stops if any current cell is no longer the installed postimage',async()=>{
    const out=await patchCryptRegion(fixture(),cells,nbt),wrong=structuredClone(cells);wrong[1].after={Name:'minecraft:gold_block'};
    await assert.rejects(patchCryptRegion(out.buffer,wrong,nbt,{reverse:true}),/preimage changed/);
});
test('duplicate, expanded, missing and out-of-range edits are rejected',async()=>{
    for(const values of [cells.slice(1),[...cells,cells[0]]])await assert.rejects(patchCryptRegion(fixture(),values,nbt),/34-cell/);
    const duplicate=structuredClone(cells);duplicate[1]=duplicate[0];await assert.rejects(patchCryptRegion(fixture(),duplicate,nbt),/Repeated/);
    const outside=structuredClone(cells);outside[0].pos[0]=1171;await assert.rejects(patchCryptRegion(fixture(),outside,nbt),/Outside/);
});
test('invalid Anvil headers and missing chunks preserve the source',async()=>{
    const raw=fixture(),copy=Buffer.from(raw);raw.writeUIntBE(0,((72&31)+14*32)*4,3);await assert.rejects(patchCryptRegion(raw,cells,nbt),/Missing/);
    assert.deepEqual(raw.subarray(8192),copy.subarray(8192));
});
