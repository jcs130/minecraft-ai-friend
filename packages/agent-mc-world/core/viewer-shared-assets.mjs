/** Content-addressed storage; version registries and logical resource names stay distinct. */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir,lstat,rename,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
const schema='agent-mc-viewer-shared-assets/v1',MAX=32*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=(root,file)=>path.relative(root,file).split(path.sep).join('/');
const eligible=name=>/^(?:versions\/\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\/)?public\/(?:icons\/|textures\/\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\/)[a-zA-Z0-9_./-]+\.png$/.test(name)&&!name.split('/').includes('..');
/** Build-time only: factor exact duplicate PNGs in an explicitly generated tree. */
export async function shareViewerAssets(directory,{generated=false}={}){
  if(!generated)throw Error('VIEWER_SHARED_REQUIRES_GENERATED_TREE');
  const root=path.resolve(directory),groups=new Map(),files={};
  if(await stat(path.join(root,'shared-assets.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))throw Error('VIEWER_SHARED_ALREADY_PREPARED');
  const walk=async(dir)=>{for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.name==='.objects')continue;
    const file=path.join(dir,entry.name),name=key(root,file);
    if(entry.isDirectory())await walk(file);
    else if(entry.isFile()&&eligible(name)){
      const bytes=await readFile(file);if(bytes.length>MAX)continue;
      const sha256=hash(bytes),group=groups.get(sha256)??[];group.push({file,name,bytes:bytes.length});groups.set(sha256,group);
    }
  }};
  await walk(root);
  let removedBytes=0,objectBytes=0,aliases=0;
  await mkdir(path.join(root,'.objects'),{recursive:true});
  const removals=[];
  for(const [sha256,group] of groups){
    if(group.length<2)continue;
    const bytes=await readFile(group[0].file);if(hash(bytes)!==sha256)throw Error('VIEWER_SHARED_SOURCE_CHANGED');
    await writeFile(path.join(root,'.objects',sha256),bytes,{flag:'wx'});
    objectBytes+=bytes.length;
    for(const item of group){files[item.name]={sha256,bytes:item.bytes};removals.push(item);removedBytes+=item.bytes;aliases++;}
  }
  const report={schema,files,statistics:{aliases,objects:Object.keys(Object.fromEntries([...groups].filter(([,g])=>g.length>1))).length,removedBytes,objectBytes,savedBytes:removedBytes-objectBytes}};
  const temporary=path.join(root,'shared-assets.'+randomUUID()+'.json');await writeFile(temporary,JSON.stringify(report)+'\n',{flag:'wx'});
  await rename(temporary,path.join(root,'shared-assets.json'));
  for(const item of removals){if(!item.file.startsWith(root+path.sep)||(await lstat(item.file)).isSymbolicLink())throw Error('VIEWER_SHARED_PATH_INVALID');await unlink(item.file);}
  return report.statistics;
}
/** Optional resolver. Missing catalogs preserve existing unpacked deployments. */
export function createSharedViewerAssets(directory){
  const root=path.resolve(directory),index=path.join(root,'shared-assets.json');let catalog,loaded=false;
  const checked=new Map();
  return {async resolve(file){
    if(!loaded){
      const info=await stat(index).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(info){if(info.size>12*1024*1024)throw Error('VIEWER_SHARED_INDEX_TOO_LARGE');catalog=JSON.parse(await readFile(index,'utf8'));
        if(catalog.schema!==schema||!catalog.files||typeof catalog.files!=='object'||Array.isArray(catalog.files))throw Error('VIEWER_SHARED_INDEX_INVALID');}
      loaded=true;
    }
    const name=key(root,path.resolve(file));if(!eligible(name))return null;
    const entry=catalog?.files[name];if(!entry)return null;
    if(!/^[a-f0-9]{64}$/.test(entry.sha256??'')||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>MAX)throw Error('VIEWER_SHARED_ENTRY_INVALID');
    const object=path.join(root,'.objects',entry.sha256),info=await lstat(object);
    if(!info.isFile()||info.isSymbolicLink()||info.size!==entry.bytes)throw Error('VIEWER_SHARED_OBJECT_INVALID');
    const stamp=info.mtimeMs+':'+info.size;
    if(checked.get(entry.sha256)!==stamp){if(hash(await readFile(object))!==entry.sha256)throw Error('VIEWER_SHARED_HASH_MISMATCH');checked.set(entry.sha256,stamp);if(checked.size>2048)checked.delete(checked.keys().next().value);}
    return {file:object,bytes:entry.bytes,sha256:entry.sha256};
  }};
}
