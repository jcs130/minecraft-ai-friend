/** Optional presentation port. Server-specific detection/code stays in its pack. */
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function presentationFactory(config) {
  if(!config?.presentationModule)return null;
  if(!/^[a-f0-9]{64}$/.test(config.presentationSha256??''))throw Error('SERVER_PRESENTATION_HASH_REQUIRED');
  const file=realpathSync(config.presentationModule),bytes=readFileSync(file);
  if(bytes.length>262144||createHash('sha256').update(bytes).digest('hex')!==config.presentationSha256)
    throw Error('SERVER_PRESENTATION_HASH_MISMATCH');
  const module=await import(pathToFileURL(file).href);
  if(typeof module.createPresentationObserver!=='function')throw Error('SERVER_PRESENTATION_PORT_UNAVAILABLE');
  return bot=>{
    const observer=module.createPresentationObserver(bot);
    if(!observer||typeof observer.snapshot!=='function'||typeof observer.close!=='function')throw Error('SERVER_PRESENTATION_PORT_INVALID');
    return observer;
  };
}
export function mergePresentation(base,extension,bot) {
  const uuid=bot._client?.uuid?.toLowerCase();
  if(!base||!uuid||base.playerUuid?.toLowerCase()!==uuid||extension?.schemaVersion!==1||extension.playerUuid!==uuid)return base;
  const self=extension.self?.playerUuid===uuid?Object.fromEntries(
    ['health','maxHealth','food','armor','absorption','oxygen','inWater','experienceLevel','experienceProgress']
      .filter(key=>Object.hasOwn(extension.self,key)).map(key=>[key,extension.self[key]])):{};
  return {...base,self:{...base.self,...self,playerUuid:uuid},skills:extension.skills??base.skills,
    profile:typeof extension.profile==='string'?extension.profile:base.profile};
}
