import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const PRIMARY_VIEWER_VERSION = '1.21.1';

/** A resource directory identifier, never a protocol compatibility claim. */
export function assertViewerVersion(version) {
  if (typeof version !== 'string' || !/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(version)) throw Error('VIEWER_VERSION_UNSUPPORTED');
  return version;
}

/** Select the explicitly packaged version, without substituting an approximate registry or picture. */
export async function viewerVersionAssets(root, version) {
  assertViewerVersion(version);
  const readVersion = async directory => {
    try { return JSON.parse(await readFile(path.join(directory, 'viewer-assets.json'), 'utf8')).minecraftVersion; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  if (await readVersion(root) === version) return root;
  const matched = path.join(root, 'versions', version);
  const selected = await readVersion(matched);
  if (selected === null) throw Error('VIEWER_ASSETS_MISSING');
  if (selected !== version) throw Error('VIEWER_ASSET_VERSION_MISMATCH');
  return matched;
}

/** Reuse render materials, never another version's numeric registry. Native/exact callers keep the strict API above. */
export async function selectViewerAssets(root,version) {
  assertViewerVersion(version);
  try {return {directory:await viewerVersionAssets(root,version),requestedVersion:version,assetVersion:version,mode:'exact'};}
  catch(error){if(error.message!=='VIEWER_ASSETS_MISSING')throw error;}
  const names=await readdir(path.join(root,'versions'),{withFileTypes:true}).catch(error=>{
    if(error.code==='ENOENT')return [];throw error;
  });
  const candidates=[];
  for(const directory of [root,...names.filter(entry=>entry.isDirectory()&&/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(entry.name)).map(entry=>path.join(root,'versions',entry.name))]){
    let manifest,client;
    try{
      manifest=JSON.parse(await readFile(path.join(directory,'viewer-assets.json'),'utf8'));
      client=JSON.parse(await readFile(path.join(directory,'viewer-client.json'),'utf8'));
    }catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(client.runtimeRegistryVersion!==1||client.preset||manifest.minecraftVersion!==client.minecraftVersion)continue;
    assertViewerVersion(manifest.minecraftVersion);
    const target=version.split('.').map(Number),asset=manifest.minecraftVersion.split('.').map(Number);
    const distance=Math.abs((target[0]??0)-(asset[0]??0))*1e6+Math.abs((target[1]??0)-(asset[1]??0))*1e3+Math.abs((target[2]??0)-(asset[2]??0));
    candidates.push({directory,assetVersion:manifest.minecraftVersion,distance});
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.assetVersion.localeCompare(b.assetVersion));
  if(!candidates.length)throw Error('VIEWER_ASSETS_MISSING');
  const {directory,assetVersion}=candidates[0];
  return {directory,requestedVersion:version,assetVersion,mode:'compatible'};
}

/** Keep Mineflayer preview registries and legacy asset URLs on the action connection's exact version. */
export function viewerVersionRegistry(version, loadData, loadItem) {
  assertViewerVersion(version);
  const data = loadData(version);
  if (data?.version?.minecraftVersion !== version || !Array.isArray(data.biomesArray))
    throw Error('VIEWER_REGISTRY_VERSION_MISMATCH');
  const plainsBiomeId = data.biomesArray.find(biome => biome.name === 'plains')?.id;
  if (!Number.isSafeInteger(plainsBiomeId)) throw Error('VIEWER_PLAINS_BIOME_MISSING');
  return { biomes: data.biomesArray, plainsBiomeId, TradeItem: loadItem(version) };
}

export function viewerVersionCss(css, version) {
  assertViewerVersion(version);
  return css.replaceAll('/textures/1.20.6/', `/textures/${version}/`);
}

/** Resolve renderer legacy entity names to the exact selected Java texture layout. */
export function viewerVersionTexture(relative, version) {
  assertViewerVersion(version);
  if (relative.startsWith('minecraft-assets/painting/'))
    return `textures/${version}/painting/${relative.slice('minecraft-assets/painting/'.length)}`;
  if (!relative.startsWith('textures/')) return null;
  let texture = relative.slice('textures/'.length);
  // Renderer entity tables still contain old version directories. Keep the
  // relative original resource name and resolve it only in the selected pack.
  texture = texture.replace(/^\d+\.\d+(?:\.\d+)?\//, '');
  const [major, minor] = version.split('.').map(Number);
  if ((major > 1 || minor >= 21) && ['entity/squid.png', 'entity/glow_squid.png'].includes(texture))
    texture = `entity/squid/${texture.slice('entity/'.length)}`;
  // Java 1.21.2 moved the same equipment UV layers into equipment/.
  // Select only original files in this version; the builder checks they exist.
  const patch = Number(version.split('.')[2] ?? 0);
  if (major > 1 || minor > 21 || minor === 21 && patch >= 2) {
    const armor = /^models\/armor\/([a-z_]+)_layer_([12])(_overlay)?\.png$/.exec(texture);
    if (armor) texture = `entity/equipment/${armor[2] === '2' ? 'humanoid_leggings' : 'humanoid'}/${armor[1] === 'turtle' ? 'turtle_scute' : armor[1]}${armor[3] ?? ''}.png`;
    if (texture === 'entity/elytra.png') texture = 'entity/equipment/wings/elytra.png';
  }
  return `textures/${version}/${texture}`;
}
