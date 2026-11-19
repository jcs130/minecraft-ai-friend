import {isMainThread, parentPort, workerData} from 'node:worker_threads';
import {readSceneArchive} from './viewer/photo-scene-archive.mjs';

const RANGE=32;
const AIR=new Set(['minecraft:air','minecraft:void_air','minecraft:cave_air','minecraft:light','minecraft:barrier','minecraft:structure_void']);
const COLORS=[
  [/sea_lantern/,0xc7e1cf],[/dark_prismarine/,0x42665d],[/prismarine_bricks/,0x68a493],[/prismarine/,0x6caa98],
  [/water|ice/,0x67a9c0],[/lava|magma|fire/,0xe77d38],[/sandstone|sand|birch|end_stone/,0xdbc69c],
  [/leaves|grass_block|moss|azalea|vine|fern|crop|grass|bamboo/,0x749457],[/wood|planks|log|fence|barrel|chest|crafting/,0x9c784e],
  [/dirt|mud|farmland|root/,0x846348],[/snow|quartz|calcite|white/,0xe4e3d8],[/nether|red_|brick/,0x9e5850],
  [/copper|prismarine/,0x679b91],[/deepslate|blackstone|obsidian/,0x555364],[/lantern|torch|glow|gold/,0xe2b45f],
  [/glass/,0xb7cdd0],[/flower|petal|amethyst|purpur/,0xac87ad],[/stone|ore|andesite|gravel|cobble/,0x92928b]
];
function blockColor(name) {
  if(AIR.has(name))return 0;
  return COLORS.find(([filter])=>filter.test(name))?.[1]??0xa39783;
}

// Java 1.21.1 chunk sections pack values into non-crossing slots of big-endian longs.
function sections(column) {
  const data=Buffer.from(column.sections,'base64'); let offset=0;
  function integer() {
    let number=0;
    for(let i=0;i<5;i++){
      const byte=data.readUInt8(offset++);
      number+=(byte&127)*2**(i*7);
      if(byte<128 && number<=0x7fffffff)return number;
    }
    throw Error('invalid scene varint');
  }
  function container(size,limit,min) {
    const bits=data.readUInt8(offset++);
    if(bits===0){
      const value=integer();if(integer()!==0)throw Error('invalid constant palette');
      return ()=>value;
    }
    if(bits<min||bits>24)throw Error('invalid palette size');
    let palette;
    if(bits<=limit){
      const count=integer();if(!count||count>2**bits)throw Error('invalid palette');
      palette=Array.from({length:count},integer);
    }
    const slots=Math.floor(64/bits),count=integer(),start=offset;
    if(count!==Math.ceil(size/slots)||(offset+=count*8)>data.length)throw Error('invalid section length');
    return i=>{
      const word=start+Math.floor(i/slots)*8,shift=(i%slots)*bits;
      const low=data.readUInt32BE(word+4),high=data.readUInt32BE(word);
      const index=(shift>=32?high>>>(shift-32):(low>>>shift)|(shift?high<<(32-shift):0)) & (2**bits-1);
      return palette?palette[index]:index;
    };
  }
  const result=[];
  for(let i=0;i<column.height/16;i++){
    offset+=2;result.push(container(4096,8,4));container(64,3,1);
  }
  if(offset!==data.length)throw Error('trailing chunk bytes');
  return result;
}

export function projectScene(scene) {
  const camera=scene.camera.position,origin=camera.map(Math.floor),palette=new Map();
  for(const block of scene.registry.blocks)palette.set(block.id,blockColor(block.name));
  const columns=new Map();
  for(const c of scene.chunks){
    if(Math.abs(c.x-Math.floor(origin[0]/16))<=2 && Math.abs(c.z-Math.floor(origin[2]/16))<=2)
      columns.set(c.x+','+c.z,{minY:c.minY,sections:sections(c)});
  }
  function voxel(x,y,z) {
    const col=columns.get(Math.floor(x/16)+','+Math.floor(z/16));
    const section=col?.sections[Math.floor((y-col.minY)/16)];
    return section?palette.get(section(((y&15)*16+(z&15))*16+(x&15))):undefined;
  }
  const {yawRadians:yaw,pitchRadians:pitch}=scene.camera;
  const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  const faces=new Map();
  for(let py=0;py<80;py++)for(let px=0;px<128;px++){
    const h=((px+.5)/128*2-1)*.93,v=(1-(py+.5)/80*2)*.59;
    const dir=[-sy*cp+h*cy+v*sy*sp,sp+v*cp,-cy*cp-h*sy+v*cy*sp];
    const length=Math.hypot(...dir);for(let a=0;a<3;a++)dir[a]/=length;
    const cell=[...origin],step=dir.map(Math.sign),delta=dir.map(d=>d?1/Math.abs(d):Infinity);
    const edge=dir.map((d,a)=>d?(cell[a]+(d>0?1:0)-camera[a])/d:Infinity);
    for(let n=0;n<64;n++){
      const a=edge[0]<edge[1]?(edge[0]<edge[2]?0:2):(edge[1]<edge[2]?1:2);
      if(edge[a]>RANGE)break;
      cell[a]+=step[a];edge[a]+=delta[a];
      const color=voxel(...cell);
      if(color===undefined)break; // no line of sight through missing samples
      if(!color)continue;
      const face=[cell[0]-origin[0],cell[1]-origin[1],cell[2]-origin[2],a*2+(step[a]<0?1:0),color];
      faces.set(face.join(','),face);break;
    }
  }
  if(!faces.size)throw Error('empty captured view');
  return {schema:'local-scene-preview/v1',faces:[...faces.values()],yaw:Math.round(yaw*1000)/1000};
}

if(!isMainThread) {
  const {bytes,expectedSha256,photoId,owner,source}=workerData;
  const scene=await readSceneArchive(Buffer.from(bytes),{expectedSha256,photoId,owner});
  if(scene.photo.imageSha256!==source)throw Error('scene photo changed');
  parentPort.postMessage(projectScene(scene));
}
