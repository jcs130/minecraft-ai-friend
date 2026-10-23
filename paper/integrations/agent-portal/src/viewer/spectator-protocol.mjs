// The relay has no game/action endpoint. Only these relative observation paths
// can reach the caller-owned loopback viewer; HTML/JS always belong to the site.
export const SPECTATOR_PROTOCOL = 'mc-spectator/1';
export const CHUNK_BYTES = 64 * 1024;
export const MAX_BODY_BYTES = 64 * 1024 * 1024;
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const BUILD_PATTERN = /^[a-f0-9]{64}:[a-f0-9]{64}$/;
export const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const SHA = /^[a-f0-9]{64}$/;
const JSON_PATHS = new Set(['status.json', 'build.json', 'manifest.json', 'sound-manifest.json', 'api/server-items', 'api/bundled-appearances', 'agent-views']);

export function observationPath(path) {
  if (typeof path !== 'string' || path.length > 1024 || /[%\\?#\x00-\x20]/.test(path)
      || path.split('/').some(s => !s || s === '.' || s === '..')) return null;
  if (path === 'events') return 'text/event-stream';
  if (JSON_PATHS.has(path)) return 'application/json';
  const file = /^(?:assets\/[a-z0-9_.-]+\/|textures\/gui\/|api\/(?:server-items|bundled-appearances)\/assets\/)[A-Za-z0-9_./-]+\.(png|json|mcmeta)$/.exec(path);
  if (file) return file[1] === 'png' ? 'image/png' : 'application/json';
  // Original Minecraft GLSL is data compiled by the trusted renderer. Never
  // accept a publisher's JavaScript module, HTML, SVG or arbitrary file suffix.
  if (/^assets\/[a-z0-9_.-]+\/shaders\/[A-Za-z0-9_./-]+\.(vsh|fsh|glsl)$/.test(path)
      || /^assets\/[a-z0-9_.-]+\/texts\/[A-Za-z0-9_./-]+\.txt$/.test(path)) return 'text/plain';
  if (/^sounds\/[A-Za-z0-9_./-]+\.ogg$/.test(path)) return 'audio/ogg';
  return null;
}

export function validatedSource(value, expectedUuid, trustedBuild) {
  if (value?.schemaVersion !== 1 || value.readOnly !== true || !['live_same_player_connection', 'paper_server_observation'].includes(value.mode)
      || value.identity?.confirmed !== true || !UUID_PATTERN.test(value.identity.playerUuid ?? '')
      || value.identity.playerUuid.toLowerCase() !== expectedUuid.toLowerCase()
      || value.connection?.ended !== false || value.viewer?.available !== true
      || !BUILD_PATTERN.test(value.build?.viewerBuild ?? '')) throw Error('SPECTATOR_SOURCE_IDENTITY_OR_STATE');
  for (const key of ['browserBundleSha256', 'consoleBundleSha256']) {
    if (!SHA.test(value.build[key] ?? '') || value.build[key] !== trustedBuild[key]) throw Error('SPECTATOR_RENDERER_BUILD_MISMATCH');
  }
  if (!SHA.test(value.viewer.registrySha256 ?? '')) throw Error('SPECTATOR_REGISTRY_INVALID');
  return { playerUuid: expectedUuid.toLowerCase(), viewerBuild: value.build.viewerBuild,
    registrySha256: value.viewer.registrySha256, readOnly: true, mode: value.mode };
}

export function encodeChunk(id, sequence, bytes) {
  if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || !Number.isInteger(sequence)
      || sequence < 0 || sequence > 0xffffffff || bytes.length < 1 || bytes.length > CHUNK_BYTES) throw Error('SPECTATOR_CHUNK_INVALID');
  const head = Buffer.allocUnsafe(8);
  head.writeUInt32BE(id, 0); head.writeUInt32BE(sequence, 4);
  return Buffer.concat([head, bytes]);
}

export function decodeChunk(bytes) {
  if (bytes.length <= 8 || bytes.length > CHUNK_BYTES + 8) throw Error('SPECTATOR_CHUNK_INVALID');
  return { id: bytes.readUInt32BE(0), sequence: bytes.readUInt32BE(4), bytes: bytes.subarray(8) };
}
