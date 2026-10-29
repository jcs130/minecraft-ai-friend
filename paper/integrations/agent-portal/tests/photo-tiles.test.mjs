import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import {photoTiles} from '../src/photo-tiles.mjs';
import {projectRoot} from '../src/config.mjs';

async function fixture(t){
  const base=path.resolve(projectRoot,'.local/tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'photo-tiles-')),folder=path.join(root,'4');await fs.mkdir(folder);
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const colors=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,255,255]];
  for(let i=0;i<4;i++){const png=new PNG({width:1,height:1});png.data.set(colors[i]);await fs.writeFile(path.join(folder,i+'.png'),PNG.sync.write(png));}
  const manifest={width:2,height:2,mapdata:colors.map((_,i)=>({image:i+'.png'}))};await fs.writeFile(path.join(folder,'data.json'),JSON.stringify(manifest));
  return {root,folder,colors,manifest};
}
test('legacy photo tiles reconstruct the complete picture in ImageFrame row-major order and cache unchanged bytes',async t=>{
  const f=await fixture(t),cache=new Map(),out=await photoTiles(f.root,4,cache,8*1024*1024),png=PNG.sync.read(out);
  assert.equal(png.width,2);assert.equal(png.height,2);assert.deepEqual([...png.data],f.colors.flat());assert.equal(await photoTiles(f.root,4,cache,8*1024*1024),out);
});
test('changing any tile invalidates the combined image, including a tile other than zero',async t=>{
  const f=await fixture(t),cache=new Map(),before=await photoTiles(f.root,4,cache,8*1024*1024),png=new PNG({width:1,height:1});png.data.set([0,0,0,255]);
  const file=path.join(f.folder,'3.png');await fs.writeFile(file,PNG.sync.write(png));await fs.utimes(file,new Date(),new Date(Date.now()+2000));
  const after=await photoTiles(f.root,4,cache,8*1024*1024);assert.notDeepEqual(after,before);assert.deepEqual([...PNG.sync.read(after).data.slice(12)],[0,0,0,255]);
});
test('incomplete grids, paths outside ImageFrame and oversized dimensions are rejected instead of showing a partial photo',async t=>{
  const f=await fixture(t),file=path.join(f.folder,'data.json');
  await fs.writeFile(file,JSON.stringify({...f.manifest,mapdata:f.manifest.mapdata.slice(1)}));await assert.rejects(photoTiles(f.root,4,new Map(),8*1024*1024),/Incomplete/);
  const mapdata=[...f.manifest.mapdata];mapdata[1]={image:'../private.png'};await fs.writeFile(file,JSON.stringify({...f.manifest,mapdata}));await assert.rejects(photoTiles(f.root,4,new Map(),8*1024*1024),/Invalid photo tile/);
  await fs.writeFile(file,JSON.stringify({...f.manifest,width:4097}));await assert.rejects(photoTiles(f.root,4,new Map(),8*1024*1024),/Unsupported/);
});
