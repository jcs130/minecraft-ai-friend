import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

// ImageFrame's saved tiles are row-major, as in URLStaticImageMap.update/save:
// https://github.com/LOOHP/ImageFrame/blob/main/common/src/main/java/com/loohp/imageframe/objectholders/URLStaticImageMap.java
// Reassemble old multi-map photos losslessly rather than uploading only tile 0.
export async function photoTiles(root,index,cache,maxBytes){
  const folder=path.join(root,String(index)),manifest=path.join(folder,'data.json');
  let stat;try{stat=await fs.stat(manifest);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(stat.size>1024*1024)throw Error('Photo manifest is too large');
  const resolved=await fs.realpath(manifest),relative=path.relative(root,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Photo manifest escaped ImageFrame');
  const data=JSON.parse(await fs.readFile(resolved,'utf8')),{width,height}=data;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>64)throw Error('Unsupported photo grid');
  if(width*height===1)return null;
  if(!Array.isArray(data.mapdata)||data.mapdata.length!==width*height)throw Error('Incomplete photo grid');
  const files=[];let total=0;
  for(let i=0;i<data.mapdata.length;i++){
    if(data.mapdata[i].image!==i+'.png')throw Error('Invalid photo tile');
    const file=await fs.realpath(path.join(folder,i+'.png')),rel=path.relative(root,file),info=await fs.stat(file);
    if(rel.startsWith('..')||path.isAbsolute(rel)||!info.isFile()||info.size>maxBytes)throw Error('Invalid photo tile');
    total+=info.size;if(total>maxBytes*4)throw Error('Photo input budget exceeded');
    files.push({file,info});
  }
  const key=width+':'+height+':'+stat.mtimeMs+':'+files.map(row=>row.file+':'+row.info.mtimeMs+':'+row.info.size).join('|');
  const old=cache.get(index);if(old?.key===key){cache.delete(index);cache.set(index,old);return old.bytes;}
  let combined,tileWidth,tileHeight;
  for(let i=0;i<files.length;i++){
    const bytes=await fs.readFile(files[i].file);
    if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('Invalid PNG tile');
    const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
    if(!w||!h||w*width>4096||h*height>4096)throw Error('Photo dimensions exceeded');
    if(i===0){tileWidth=w;tileHeight=h;combined=new PNG({width:w*width,height:h*height});}
    if(w!==tileWidth||h!==tileHeight)throw Error('Inconsistent photo tiles');
    const tile=PNG.sync.read(bytes);PNG.bitblt(tile,combined,0,0,w,h,(i%width)*w,Math.floor(i/width)*h);
  }
  const bytes=PNG.sync.write(combined);if(bytes.length>maxBytes)throw Error('Photo output budget exceeded');
  cache.delete(index);cache.set(index,{key,bytes});
  while([...cache.values()].reduce((n,row)=>n+row.bytes.length,0)>32*1024*1024)cache.delete(cache.keys().next().value);
  return bytes;
}
