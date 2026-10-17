import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/**
 * Preserve authored per-face surfaces while separating head caps into planes.
 * Older Web renderers inverted up/down on volumetric per-face cubes. A
 * zero-height plane stays on its authored surface even with that legacy Y
 * conversion. This is a resource compatibility fix, not a texture repaint;
 * native Java/Bedrock and the corrected Web engine retain the original UVs.
 * Returns a new definition. Refuses unsupported/already converted sources.
 */
export function splitYsmHeadPlanes(definition, names=['Head','Hat']) {
  const result=structuredClone(definition),geometry=result?.['minecraft:geometry'];
  if(!Array.isArray(geometry)||geometry.length!==1||!Array.isArray(geometry[0].bones))throw Error('YSM_HEAD_GEOMETRY_UNSUPPORTED');
  if(!Array.isArray(names)||!names.length||new Set(names).size!==names.length)throw Error('YSM_HEAD_BONES_INVALID');
  for(const name of names){
    const bone=geometry[0].bones.find(b=>b.name===name),cube=bone?.cubes?.[0];
    const vector=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
    if(!cube||!vector(cube.origin)||!vector(cube.size)||cube.size.some(n=>n<=0)||cube.rotation||cube.mirror||bone.mirror||!cube.uv?.up||!cube.uv?.down||!Number.isFinite(cube.inflate??0))throw Error('YSM_HEAD_CUBE_UNSUPPORTED: '+name);
    const delta=cube.inflate??0,[x,y,z]=cube.origin,[w,h,d]=cube.size;
    if(w+2*delta<=0||h+2*delta<=0||d+2*delta<=0)throw Error('YSM_HEAD_INFLATE_UNSUPPORTED: '+name);
    const cap=(face,height)=>({origin:[x-delta,height,z-delta],size:[w+2*delta,0,d+2*delta],uv:{[face]:structuredClone(cube.uv[face])}});
    const top=cap('up',y+h+delta),bottom=cap('down',y-delta);
    delete cube.uv.up;delete cube.uv.down;bone.cubes.push(top,bottom);
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help')console.log('用法：node ysm-head-planes.mjs --input <原模型JSON> --output <新模型JSON>。只读原文件；输出必须是新文件。');
  else{
    if(args.length!==4||args[0]!=='--input'||args[2]!=='--output')throw Error('使用 --help 查看用法');
    const input=path.resolve(args[1]),output=path.resolve(args[3]);if(input===output)throw Error('禁止覆盖原模型');
    const updated=splitYsmHeadPlanes(JSON.parse(await fs.readFile(input,'utf8')));
    await fs.writeFile(output,JSON.stringify(updated,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({status:'written',output,bones:['Head','Hat'],sourceModified:false}));
  }
}
