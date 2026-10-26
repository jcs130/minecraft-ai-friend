/** Portable presentation data from the body's exact installed Java registry. No world or account data. */
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {assertViewerVersion} from './viewer-version.mjs';

export const VIEWER_REGISTRY_FIELDS=Object.freeze(['attributes','blocks','blockCollisionShapes','biomes','effects','items',
  'enchantments','instruments','materials','language','entities','version','foods','particles','tints']);

export async function viewerRuntimeRegistry(version,require=createRequire(import.meta.url)) {
  assertViewerVersion(version);
  const paths=require('minecraft-data/minecraft-data/data/dataPaths.json').pc[version];
  if(!paths)throw Error('VIEWER_REGISTRY_VERSION_MISMATCH');
  const data={};
  for(const field of VIEWER_REGISTRY_FIELDS){
    const file=require.resolve(`minecraft-data/minecraft-data/data/${paths[field]}/${field}.json`);
    data[field]=JSON.parse(await readFile(file,'utf8'));
  }
  if(data.version.minecraftVersion!==version||!Array.isArray(data.blocks)||!Array.isArray(data.items)||!Array.isArray(data.biomes))
    throw Error('VIEWER_REGISTRY_VERSION_MISMATCH');
  const payload={schemaVersion:1,minecraftVersion:version,data,
    protocolVersions:require('minecraft-data/minecraft-data/data/pc/common/protocolVersions.json')};
  if(Buffer.byteLength(JSON.stringify(payload))>8*1024*1024)throw Error('VIEWER_REGISTRY_TOO_LARGE');
  return payload;
}

/** A same-origin bootstrap shared by the browser and its classic mesh workers. */
export function viewerRuntimeScript(registry,resources) {
  if(registry?.schemaVersion!==1||registry.minecraftVersion!==resources?.requestedVersion)
    throw Error('VIEWER_REGISTRY_VERSION_MISMATCH');
  const safe=value=>JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
  const info={mode:resources.mode,requestedVersion:resources.requestedVersion,assetVersion:resources.assetVersion};
  return `globalThis.__MC_VIEWER_REGISTRY__=${safe(registry)};\nglobalThis.__MC_VIEWER_RESOURCE_INFO__=${safe(info)};\n`;
}
