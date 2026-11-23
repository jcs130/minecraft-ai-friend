/**
 * Read-only facts from plugin messaging advertisements and received channel names.
 * Discovering a channel is not permission to send, and is not proof of a working voice client.
 */

const CHANNEL = /^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,96}$/i;
const REGISTER = new Set(['minecraft:register', 'minecraft:unregister']);
/** Short-name aliases used by Simple Voice Chat; do not treat every `vc:` name as SVC. */
const SVC_VC_SUFFIX = new Set([
  'secret', 'request_secret', 'state', 'states', 'update_state', 'player_state',
  'add_group', 'remove_group', 'create_group', 'join_group', 'leave_group', 'joined_group',
  'set_group', 'add_category', 'remove_category',
]);

export type PluginChannelKinds = {
  svc: string[];
  plasmo: string[];
  mcagentVoice: string[];
  other: string[];
};

export function normalizePluginChannel(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.replace(/\0/g, '').trim();
  if (!trimmed || trimmed.length > 160) return null;
  return CHANNEL.test(trimmed) ? trimmed : null;
}

/** Null-separated channel list from a minecraft:register / unregister payload. */
export function parseRegisterChannelList(data: unknown, limit = 96): string[] {
  const buf = channelDataBuffer(data);
  if (!buf || buf.length === 0 || buf.length > 16_384) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of buf.toString('utf8').split('\0')) {
    const name = normalizePluginChannel(part);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

export function advertisedPluginChannels(channel: unknown, data?: unknown): string[] {
  const name = typeof channel === 'string' ? channel : '';
  if (REGISTER.has(name)) return parseRegisterChannelList(data);
  const single = normalizePluginChannel(name);
  return single && !REGISTER.has(single) ? [single] : [];
}

export function classifyPluginChannels(channels: readonly string[]): PluginChannelKinds {
  const kinds: PluginChannelKinds = { svc: [], plasmo: [], mcagentVoice: [], other: [] };
  const seen = new Set<string>();
  for (const raw of channels) {
    const name = normalizePluginChannel(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const lower = name.toLowerCase();
    const [ns, path] = splitChannel(lower);
    if (ns === 'voicechat' || (ns === 'vc' && SVC_VC_SUFFIX.has(path))) kinds.svc.push(name);
    else if (ns === 'plasmo' || ns === 'plasmovoice' || ns === 'pv') kinds.plasmo.push(name);
    else if (lower === 'mcagent:voice') kinds.mcagentVoice.push(name);
    else kinds.other.push(name);
  }
  return kinds;
}

/**
 * If a received voicechat:secret / vc:secret body matches the common layout
 * (16-byte key, BE int32 port, 16-byte uuid), report the UDP port only.
 * Never returns or logs the key. A missing or short body is not "no SVC".
 */
export function readVoicechatSecretUdpPort(data: unknown): { port: number; byteLength: number } | null {
  const buf = channelDataBuffer(data);
  if (!buf || buf.length < 36) return null;
  const port = buf.readInt32BE(16);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, byteLength: buf.length };
}

/** request_secret body is commonly a BE int32 protocol version. Does not send the packet. */
export function readVoicechatRequestSecretVersion(data: unknown): number | null {
  const buf = channelDataBuffer(data);
  if (!buf || buf.length < 4) return null;
  const version = buf.readInt32BE(0);
  return Number.isInteger(version) && version >= 0 && version <= 4096 ? version : null;
}

function splitChannel(name: string): [string, string] {
  const at = name.indexOf(':');
  return at < 0 ? [name, ''] : [name.slice(0, at), name.slice(at + 1)];
}

function channelDataBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data && typeof data === 'object' && Buffer.isBuffer((data as { data?: unknown }).data)) {
    return (data as { data: Buffer }).data;
  }
  return null;
}
