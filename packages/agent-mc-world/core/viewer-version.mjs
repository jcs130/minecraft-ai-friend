import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Select the explicitly packaged version, without substituting an approximate registry or picture. */
export async function viewerVersionAssets(root, version) {
  if (!['1.20.6', '1.21.1'].includes(version)) throw Error('VIEWER_VERSION_UNSUPPORTED');
  const readVersion = async directory => JSON.parse(await readFile(path.join(directory, 'viewer-assets.json'), 'utf8')).minecraftVersion;
  if (await readVersion(root) === version) return root;
  const matched = path.join(root, 'versions', version);
  if (await readVersion(matched) !== version) throw Error('VIEWER_ASSET_VERSION_MISMATCH');
  return matched;
}

/** Keep Mineflayer preview registries and legacy asset URLs on the action connection's exact version. */
export function viewerVersionRegistry(version, loadData, loadItem) {
  if (!['1.20.6', '1.21.1'].includes(version)) throw Error('VIEWER_VERSION_UNSUPPORTED');
  const data = loadData(version);
  if (data?.version?.minecraftVersion !== version || !Array.isArray(data.biomesArray))
    throw Error('VIEWER_REGISTRY_VERSION_MISMATCH');
  const plainsBiomeId = data.biomesArray.find(biome => biome.name === 'plains')?.id;
  if (!Number.isSafeInteger(plainsBiomeId)) throw Error('VIEWER_PLAINS_BIOME_MISSING');
  return { biomes: data.biomesArray, plainsBiomeId, TradeItem: loadItem(version) };
}

export function viewerVersionCss(css, version) {
  if (!['1.20.6', '1.21.1'].includes(version)) throw Error('VIEWER_VERSION_UNSUPPORTED');
  return css.replaceAll('/textures/1.20.6/', `/textures/${version}/`);
}

/** Resolve renderer legacy entity names to the exact selected Java texture layout. */
export function viewerVersionTexture(relative, version) {
  if (!['1.20.6', '1.21.1'].includes(version)) throw Error('VIEWER_VERSION_UNSUPPORTED');
  if (!relative.startsWith('textures/')) return null;
  let texture = relative.slice('textures/'.length);
  if (version === '1.21.1' && ['entity/squid.png', 'entity/glow_squid.png'].includes(texture))
    texture = `entity/squid/${texture.slice('entity/'.length)}`;
  return `textures/${version}/${texture}`;
}
