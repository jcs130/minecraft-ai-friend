import type { Bot } from 'mineflayer';
export interface NativeConnection {
  query(input: Record<string, unknown>): unknown;
  listen(): Promise<unknown>;
  readonly url: string | null;
  close(): Promise<void>;
}
export interface PreparedNativeConnection { attach(bot: Bot): NativeConnection }
export function nativeInventoryReadout(value: unknown, item?: string): { stamp: string; text: string } {
  const text = JSON.stringify(value);
  if (!item) return { stamp: text, text };
  const state = value as { inventory?: { slots?: Array<{ slot: number; item?: { name?: string } }> }; menu?: { slots?: Array<{ slot: number; item?: { name?: string } }> } } | null;
  const wanted = item.includes(':') ? item : 'minecraft:' + item;
  const matches = (['inventory', 'menu'] as const).flatMap(location =>
    (state?.[location]?.slots ?? []).filter(row => row.item?.name === wanted).map(row => ({ location, ...row })));
  const focused = JSON.stringify({ focus: item, focusMode: 'exact_native_resource_id', matches,
    note: 'Localized/custom-name and historical proxy chest search are unavailable in native mode.', state: value });
  return { stamp: focused, text: focused };
}
/** Explicit local, read-only presentation adapter. No endpoint discovery or second body. */
export async function prepareNativeConnection(config: { module: string; assetsDir: string } | undefined,
  viewerPort: number): Promise<PreparedNativeConnection | undefined> {
  if (!config?.module && !config?.assetsDir) return undefined;
  if (!config.module.startsWith('file:') || !config.assetsDir.trim()) throw new Error('Native view requires an explicit local file module and matched asset directory.');
  const factory = (await import(config.module)).prepareNativeConnection;
  if (typeof factory !== 'function') throw new Error('Native view module must export prepareNativeConnection.');
  const prepared = await factory({ assetDirectory: config.assetsDir, viewerPort });
  if (!prepared || typeof prepared.attach !== 'function') throw new Error('Invalid native view adapter.');
  return prepared;
}
