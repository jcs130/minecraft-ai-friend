// Shared by the wire adapter and browser. A player_head is a transport type,
// not an instruction to replace a server supplied profile with Steve's face.
const HASH = /^[0-9a-f]{40,64}$/;
export function minecraftTextureHash(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value), hash = /^\/texture\/([0-9a-f]{40,64})$/i.exec(url.pathname)?.[1]?.toLowerCase();
    return hash && url.hostname === 'textures.minecraft.net' && ['http:', 'https:'].includes(url.protocol)
      && !url.port && !url.username && !url.password && !url.search && !url.hash ? hash : null;
  } catch { return null; }
}
function plain(value, depth = 0, budget = { nodes: 1024 }) {
  if (depth > 14 || --budget.nodes < 0) return null;
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 16384) : value;
  if (Array.isArray(value)) return value.slice(0, 64).map(v => plain(v, depth + 1, budget));
  if (typeof value.type === 'string' && Object.hasOwn(value, 'value')) return plain(value.value, depth + 1, budget);
  return Object.fromEntries(Object.entries(value).slice(0, 64).map(([k, v]) => [k, plain(v, depth + 1, budget)]));
}
export function itemComponent(item, name) {
  const values = item?.components;
  const entry = Array.isArray(values) ? values.find(c => String(c?.type ?? c?.name).replace(/^minecraft:/, '') === name) : null;
  return plain(entry ? entry.data : values?.['minecraft:' + name] ?? values?.[name]);
}
export function itemDisplayName(item) {
  const text = (value, depth = 0) => {
    if (depth > 10 || value == null) return '';
    if (typeof value === 'string') {
      if (value.length > 16384) return '';
      try { if (/^[\[{"]/.test(value.trim())) return text(JSON.parse(value), depth + 1); } catch { /* Literal name. */ }
      return value;
    }
    if (Array.isArray(value)) return value.slice(0, 64).map(v => text(v, depth + 1)).join('');
    return text(value.text, depth + 1) + text(value.extra, depth + 1);
  };
  return (text(plain(item?.customName)) || text(itemComponent(item, 'custom_name'))
    || text(plain(item?.nbt)?.display?.Name) || text(plain(item?.displayName)) || text(item?.name)).replace(/§[0-9a-fk-or]/gi, '').slice(0, 256);
}
export function itemHeadProfile(item) {
  if (String(item?.name ?? '').replace(/^minecraft:/, '') !== 'player_head') return null;
  if (item.visualDataUnavailable) return { status: 'unavailable', hash: null };
  const legacy = plain(item?.nbt), components = item.components;
  const hasProfile = Array.isArray(components) ? components.some(c => ['profile', 'minecraft:profile'].includes(c?.type ?? c?.name))
    : components && (Object.hasOwn(components, 'profile') || Object.hasOwn(components, 'minecraft:profile'));
  const profile = itemComponent(item, 'profile') ?? legacy?.SkullOwner;
  let properties = profile?.properties ?? profile?.Properties;
  if (properties && !Array.isArray(properties)) properties = Array.isArray(properties.textures) ? properties.textures.map(p => ({ name: 'textures', ...p })) : [];
  const property = properties?.find(p => p?.name === 'textures');
  const encoded = property?.value ?? property?.Value;
  if (typeof encoded === 'string' && encoded.length <= 16384) {
    try {
      const data = JSON.parse(atob(encoded)), hash = minecraftTextureHash(data?.textures?.SKIN?.url);
      return { status: hash ? 'ready' : 'unavailable', hash };
    } catch { return { status: 'unavailable', hash: null }; }
  }
  // A real profile always takes priority over derived legacy fields, including
  // malformed/removed profiles. Never reuse the previous slot's texture.
  if (profile != null || hasProfile || legacy && Object.hasOwn(legacy, 'SkullOwner')) return { status: 'unavailable', hash: null };
  if (item.headTextureStatus === 'unavailable') return { status: 'unavailable', hash: null };
  if (HASH.test(item.headTextureHash ?? '')) return { status: 'ready', hash: item.headTextureHash };
  return null;
}
export function withItemVisualIdentity(item) {
  if (!item) return item;
  const head = itemHeadProfile(item), name = itemDisplayName(item);
  return { ...item, displayName: name, ...(name ? { customName: name } : {}),
    headTextureHash: head?.hash ?? null, ...(head ? { headTextureStatus: head.status } : {}) };
}
