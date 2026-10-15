/** Versioned client registry facts for protocol sounds addressed by numeric ID. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ViewerSoundRegistry { sounds?: Record<number, { name?: string }> }
export interface ViewerSoundRegistryResult {
  registry: ViewerSoundRegistry;
  source: 'exact-assets' | 'minecraft-data' | 'unavailable';
  diagnostic: string | null;
}

const EXACT_SOUND_LAYOUTS: Record<string, { count: number; clientJarSha256: string }> = {
  '1.20.6': { count: 1607, clientJarSha256: '02dfd345ac1ad55692d5dbc8486ac7e4fea72cd54ac494a79cd48963048e56b2' },
  '1.21.1': { count: 1611, clientJarSha256: '499f6897d1837516680f3114072d8106e11c9adcd933fe5cf051b551089b0c99' },
};

export function validateViewerSoundRegistry(value: unknown, expectedVersion: string): ViewerSoundRegistry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const layout = EXACT_SOUND_LAYOUTS[expectedVersion];
  if (!layout || row.schemaVersion !== 1 || row.minecraftVersion !== expectedVersion
      || row.clientJarSha256 !== layout.clientJarSha256 || !row.events || typeof row.events !== 'object'
      || Array.isArray(row.events)) return null;
  const events = row.events as Record<string, unknown>;
  if (Object.keys(events).length !== layout.count) return null;
  const sounds: NonNullable<ViewerSoundRegistry['sounds']> = {};
  const names = new Set<string>();
  for (let id = 0; id < layout.count; id++) {
    if (!Object.hasOwn(events, String(id))) return null;
    const event = events[String(id)];
    const name = event && typeof event === 'object' ? (event as Record<string, unknown>).name : undefined;
    if (typeof name !== 'string' || !/^minecraft:[a-z0-9_][a-z0-9_.-]{0,159}$/.test(name) || names.has(name)) return null;
    names.add(name); sounds[id] = { name };
  }
  return { sounds };
}

export async function loadViewerSoundRegistry(assetsDir: string, minecraftVersion: string,
  fallbackRegistry: ViewerSoundRegistry): Promise<ViewerSoundRegistryResult> {
  if (!EXACT_SOUND_LAYOUTS[minecraftVersion]) return { registry: fallbackRegistry, source: 'minecraft-data', diagnostic: null };
  try {
    const source = await readFile(path.join(assetsDir, 'public', 'sounds', 'registry.json'), 'utf8');
    if (source.length > 1024 * 1024) throw new Error('Sound registry metadata too large');
    const value: unknown = JSON.parse(source);
    const registry = validateViewerSoundRegistry(value, minecraftVersion);
    if (registry) return { registry, source: 'exact-assets', diagnostic: null };
  } catch { /* A missing or invalid catalogue cannot supply trustworthy numeric IDs. */ }
  return { registry: { sounds: {} }, source: 'unavailable',
    diagnostic: `${minecraftVersion} 声音编号表缺失或不匹配：编号音效已停用，请从匹配的原版客户端导出声音注册表。` };
}
