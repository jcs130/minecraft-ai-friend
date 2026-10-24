import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { checkSkinBytes } from './client-skins.ts';

export interface LocalPlayerSkin { bytes: Uint8Array; model: 'classic' | 'slim' }
const crcTable=Uint32Array.from({length:256},(_,index)=>{let n=index;for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=(bytes:Uint8Array)=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]!^(n>>>8);return(n^0xffffffff)>>>0;};
/** Validate bounded PNG chunks/CRC, zlib payload and scanline layouts without a CJS runtime codec. */
function validatePayload(bytes:Buffer,width:number,height:number):void {
  let cursor=8,header=false,ended=false,palette=0,depth=0,color=0,interlace=0;
  const compressed:Buffer[]=[];
  while(cursor+12<=bytes.length){
    const length=bytes.readUInt32BE(cursor),end=cursor+12+length;
    if(end>bytes.length)throw Error();
    const type=bytes.toString('ascii',cursor+4,cursor+8),data=bytes.subarray(cursor+8,cursor+8+length);
    if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(cursor+4,cursor+8+length))!==bytes.readUInt32BE(cursor+8+length))throw Error();
    if(!header&&type!=='IHDR')throw Error();
    if(type==='IHDR'){
      if(header||length!==13||data.readUInt32BE(0)!==width||data.readUInt32BE(4)!==height||data[10]!==0||data[11]!==0)throw Error();
      header=true;depth=data[8]!;color=data[9]!;interlace=data[12]!;
      const allowed:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!allowed[color]?.includes(depth)||![0,1].includes(interlace))throw Error();
    }else if(type==='PLTE'){if(length<3||length>768||length%3)throw Error();palette=length/3;}
    else if(type==='IDAT')compressed.push(data);
    else if(type==='IEND'){if(length!==0||end!==bytes.length)throw Error();ended=true;break;}
    else if(type[0]===type[0]!.toUpperCase())throw Error();
    cursor=end;
  }
  if(!ended||!compressed.length||(color===3&&(!palette||palette>2**depth)))throw Error();
  const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>({width:Math.max(0,Math.ceil((width-x!)/dx!)),height:Math.max(0,Math.ceil((height-y!)/dy!))}))
    .filter(p=>p.width&&p.height).map(p=>({length:1+Math.ceil(p.width*channels[color]!*depth/8),height:p.height}));
  const expected=rows.reduce((sum,p)=>sum+p.length*p.height,0),raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});
  if(raw.length!==expected)throw Error();
  let offset=0;for(const p of rows)for(let row=0;row<p.height;row++){if(raw[offset]!>4)throw Error();offset+=p.length;}
}
/** Explicit local display override, not a server-side skin change. No remote URL or path is accepted. */
export function configuredPlayerSkin(input: LocalPlayerSkin) {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 256 * 1024) throw new Error('Skin PNG exceeds 256 KiB');
  if (!['classic','slim'].includes(input.model)) throw new Error('Unknown skin arm model');
  const dimensions = checkSkinBytes(input.bytes);
  if ('error' in dimensions) throw new Error(dimensions.error);
  try { validatePayload(Buffer.from(input.bytes),dimensions.width,dimensions.height); }
  catch { throw new Error('Skin PNG cannot be decoded'); }
  const bytes = Buffer.from(input.bytes), sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256, ...dimensions, skinUrl: `/agent-skin/${sha256}.png`, skinModel: input.model,
    skinSource: 'local-viewer-override' as const };
}
