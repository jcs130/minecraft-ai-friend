// Pure Anvil transformation. The maintenance caller owns cold-stop, hash, fsync and atomic-install gates.
import assert from 'node:assert/strict';
import {inflateSync,gunzipSync,deflateSync} from 'node:zlib';

const blockKey = value => JSON.stringify([value.Name,Object.entries(value.Properties??{}).sort(([a],[b])=>a.localeCompare(b))]);
const state = value => ({Name:value.Name.value,...(value.Properties?{Properties:Object.fromEntries(Object.entries(value.Properties.value).map(([k,v])=>[k,v.value]))}:{})});
const tag = value => ({Name:{type:'string',value:value.Name},...(value.Properties?{Properties:{type:'compound',value:Object.fromEntries(Object.entries(value.Properties).map(([k,v])=>[k,{type:'string',value:v}]))}}:{})});
const unsigned = value => typeof value==='bigint'?BigInt.asUintN(64,value):BigInt(value[0]>>>0)<<32n|BigInt(value[1]>>>0);
const pair = value => [Number(BigInt.asIntN(32,value>>32n)),Number(BigInt.asIntN(32,value&0xffffffffn))];
const bitsFor = size => Math.max(4,Math.ceil(Math.log2(size)));
function indexes(section){
    const palette=section.block_states.value.palette.value.value,data=section.block_states.value.data?.value;
    if(palette.length===1)return Array(4096).fill(0);
    const bits=bitsFor(palette.length),per=Math.floor(64/bits),mask=(1n<<BigInt(bits))-1n;
    assert(data&&data.length===Math.ceil(4096/per),'Invalid block-state array');
    return Array.from({length:4096},(_,i)=>{const n=Number(unsigned(data[Math.floor(i/per)])>>BigInt(i%per*bits)&mask);assert(n<palette.length,'Invalid palette index');return n;});
}
function store(section,values){
    const bits=bitsFor(section.block_states.value.palette.value.value.length),per=Math.floor(64/bits),data=Array(Math.ceil(4096/per)).fill(0n);
    values.forEach((v,i)=>data[Math.floor(i/per)]|=BigInt(v)<<BigInt(i%per*bits));
    section.block_states.value.data={type:'longArray',value:data.map(pair)};
}
async function chunk(raw,slot,nbt){
    const start=raw.readUIntBE(slot*4,3)*4096,count=raw[slot*4+3];assert(start>=8192&&count>0,'Missing connector chunk');
    const size=raw.readUInt32BE(start),mode=raw[start+4];assert(size>1&&size+4<=count*4096&&start+4+size<=raw.length&&[1,2,3].includes(mode),'Invalid Anvil chunk envelope');
    const compressed=raw.subarray(start+5,start+4+size),bytes=mode===1?gunzipSync(compressed):mode===2?inflateSync(compressed):compressed;
    return (await nbt.parse(bytes)).parsed;
}

/** Compare every expected cell before any mutation; preserve unrelated chunk bytes verbatim. */
export async function patchCryptRegion(raw,cells,nbt,{reverse=false,timestamp=Math.floor(Date.now()/1000)}={}){
    assert(Buffer.isBuffer(raw)&&raw.length>=8192&&raw.length%4096===0,'Invalid region');
    assert(Array.isArray(cells)&&cells.length===34,'Only the reviewed 34-cell connector');
    const grouped=new Map(),seen=new Set();
    for(const cell of cells){
        const [x,y,z]=cell.pos;assert(cell.pos.length===3&&cell.pos.every(Number.isInteger)&&x>=1166&&x<=1170&&y>=86&&y<=93&&z>=229&&z<=230,'Outside connector bounds');
        const key=cell.pos.join(',');assert(!seen.has(key),'Repeated connector cell');seen.add(key);
        for(const s of [cell.before,cell.after])assert(s&&/^minecraft:[a-z0-9_]+$/.test(s.Name)&&!/(chest|barrel|furnace|shulker|sign|spawner|command_block)/.test(s.Name),'Unexpected container or executable block');
        const slot=(x>>4&31)+(z>>4&31)*32;if(!grouped.has(slot))grouped.set(slot,[]);grouped.get(slot).push(cell);
    }
    const roots=new Map();
    // Preflight all cells in all chunks, including absence of block entities at those cells.
    for(const [slot,changes]of grouped){
        const root=await chunk(raw,slot,nbt),c=root.value;assert(c.DataVersion?.value===3955,'Only reviewed Minecraft 1.21.1 chunks');assert(c.xPos.value>=72&&c.xPos.value<=73&&c.zPos.value===14,'Chunk coordinate mismatch');
        const sections=c.sections.value.value,cache=new Map();
        for(const cell of changes){
            const [x,y,z]=cell.pos,section=sections.find(s=>s.Y.value===Math.floor(y/16));assert(section?.block_states,'Missing connector section');
            if(!cache.has(section))cache.set(section,indexes(section));
            const index=(y&15)*256+(z&15)*16+(x&15),current=state(section.block_states.value.palette.value.value[cache.get(section)[index]]),expected=reverse?cell.after:cell.before;
            assert(blockKey(current)===blockKey(expected),'Connector preimage changed at '+cell.pos.join(','));
            assert(!(c.block_entities?.value?.value??[]).some(e=>e.x?.value===x&&e.y?.value===y&&e.z?.value===z),'Block entity at connector');
        }
        roots.set(slot,{root,cache,changes});
    }
    const header=Buffer.from(raw.subarray(0,8192)),parts=[Buffer.from(raw)];let offset=raw.length/4096;
    for(const [slot,{root,cache,changes}]of roots){
        for(const cell of changes){
            const [x,y,z]=cell.pos,section=root.value.sections.value.value.find(s=>s.Y.value===Math.floor(y/16)),palette=section.block_states.value.palette.value.value,wanted=reverse?cell.before:cell.after;
            let index=palette.findIndex(s=>blockKey(state(s))===blockKey(wanted));if(index<0){index=palette.length;palette.push(tag(wanted));}
            cache.get(section)[(y&15)*256+(z&15)*16+(x&15)]=index;
        }
        for(const [section,values]of cache)store(section,values);
        // Let the native chunk loader recompute derived height and lighting from the changed geometry.
        root.value.Heightmaps={type:'compound',value:{}};root.value.isLightOn={type:'byte',value:0};
        const compressed=deflateSync(nbt.writeUncompressed(root)),count=Math.ceil((compressed.length+5)/4096);assert(count<256&&offset<0x1000000,'Anvil allocation limit');
        const bytes=Buffer.alloc(count*4096);bytes.writeUInt32BE(compressed.length+1);bytes[4]=2;compressed.copy(bytes,5);parts.push(bytes);
        header.writeUIntBE(offset,slot*4,3);header[slot*4+3]=count;header.writeUInt32BE(timestamp>>>0,4096+slot*4);offset+=count;
    }
    const output=Buffer.concat(parts);header.copy(output,0);
    for(let slot=0;slot<1024;slot++)if(!grouped.has(slot)){
        assert(raw.subarray(slot*4,slot*4+4).equals(output.subarray(slot*4,slot*4+4)),'Unrelated chunk moved');
        assert(raw.subarray(4096+slot*4,4100+slot*4).equals(output.subarray(4096+slot*4,4100+slot*4)),'Unrelated timestamp changed');
    }
    return {buffer:output,changedCells:34,changedChunks:grouped.size,unrelatedChunkRecordsPreserved:true,reverse};
}
