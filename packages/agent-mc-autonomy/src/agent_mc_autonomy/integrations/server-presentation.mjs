/** Optional presentation port. Server-specific detection/code stays in its pack. */
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, sep } from 'node:path';

export async function presentationFactory(config) {
  if(!config?.presentationModule)return null;
  if(!/^[a-f0-9]{64}$/.test(config.presentationSha256??''))throw Error('SERVER_PRESENTATION_HASH_REQUIRED');
  const file=realpathSync(config.presentationModule),bytes=readFileSync(file);
  if(bytes.length>262144||createHash('sha256').update(bytes).digest('hex')!==config.presentationSha256)
    throw Error('SERVER_PRESENTATION_HASH_MISMATCH');
  const module=await import(pathToFileURL(file).href);
  if(typeof module.createPresentationObserver!=='function')throw Error('SERVER_PRESENTATION_PORT_UNAVAILABLE');
  const options=module.presentationOptions;
  if(options && (typeof options!=='object'||Object.keys(options).some(key=>key!=='stateRefreshMs')||!Number.isInteger(options.stateRefreshMs)
    ||options.stateRefreshMs<30_000||options.stateRefreshMs>300_000))throw Error('SERVER_PRESENTATION_OPTIONS_INVALID');
  const factory=bot=>{
    const observer=module.createPresentationObserver(bot,options??{});
    if(!observer||typeof observer.snapshot!=='function'||typeof observer.close!=='function')throw Error('SERVER_PRESENTATION_PORT_INVALID');
    return observer;
  };
  const catalog=module.itemAppearanceCatalog;
  if(catalog){
    const catalogFile=realpathSync(fileURLToPath(catalog.fileUrl));
    if(!catalogFile.startsWith(dirname(file)+sep)||!/^[a-f0-9]{64}$/.test(catalog.sha256??''))throw Error('SERVER_ITEM_CATALOG_INVALID');
    const data=readFileSync(catalogFile);
    if(data.length>65536||createHash('sha256').update(data).digest('hex')!==catalog.sha256)throw Error('SERVER_ITEM_CATALOG_HASH_MISMATCH');
    Object.assign(factory,{itemCatalogFile:catalogFile,itemCatalogSha256:catalog.sha256});
  }
  return factory;
}
export function mergePresentation(base,extension,bot) {
  const uuid=bot._client?.uuid?.toLowerCase();
  if(!base||!uuid||base.playerUuid?.toLowerCase()!==uuid||extension?.schemaVersion!==1||extension.playerUuid!==uuid)return base;
  const self=extension.self?.playerUuid===uuid?Object.fromEntries(
    ['health','maxHealth','food','armor','absorption','oxygen','inWater','experienceLevel','experienceProgress']
      .filter(key=>Object.hasOwn(extension.self,key)).map(key=>[key,extension.self[key]])):{};
  const pack=typeof extension.serverItemPackId==='string'&&/^[a-z0-9_.-]{1,80}$/.test(extension.serverItemPackId)?extension.serverItemPackId:null;
  return {...base,self:{...base.self,...self,playerUuid:uuid},
    ...(extension.skills!=null?{skills:extension.skills}:{}),serverItemPackId:pack};
}
