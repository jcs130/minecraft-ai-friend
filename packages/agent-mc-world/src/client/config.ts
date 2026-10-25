import { fileURLToPath } from 'node:url';
import { MINECRAFT_DEFAULTS, type MinecraftConfigSection } from '../../core/config.ts';
import { protocolVersion } from './authentication.ts';
import { respawnDelay } from '../../core/death-lifecycle.ts';
import { validateJavaClientConfiguration } from './java-client.ts';
import { isIP } from 'node:net';
import { validateReferenceConfig } from '../../core/reference-index.ts';

/** Java server notation, shared by SDKs and host setup forms. Does not connect or resolve DNS. */
export function parseMinecraftServerAddress(value: string, defaultPort = 25565): { host: string; port: number } {
  if (typeof value !== 'string' || !Number.isInteger(defaultPort) || defaultPort < 1 || defaultPort > 65535)
    throw new Error('Invalid Minecraft server address or default port.');
  const address = value.trim();
  if (!address || /[\s/@?#\\]/.test(address) || address.includes('://'))
    throw new Error('Enter a Minecraft server host or host:port, without a URL, path or credentials.');
  let host = address, port = defaultPort;
  if (address.startsWith('[')) {
    const parts = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(address);
    if (!parts || isIP(parts[1]) !== 6) throw new Error('Invalid bracketed IPv6 Minecraft server address.');
    host = parts[1];
    if (parts[2] !== undefined) port = Number(parts[2]);
  } else if (address.includes(':') && isIP(address) !== 6) {
    const parts = /^([^:]+):([0-9]+)$/.exec(address);
    if (!parts) throw new Error('Invalid Minecraft server port. Use [IPv6]:port for IPv6 with a port.');
    host = parts[1]; port = Number(parts[2]);
  }
  if (isIP(host) === 0 && (host.length > 253 || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9.])?$/.test(host)))
    throw new Error('Invalid Minecraft server host.');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Minecraft port must be an integer from 1 to 65535.');
  return { host, port };
}

export type MinecraftClientConfig = MinecraftConfigSection;
/** Neutral remote client defaults; server commands and account prefixes belong to integrations. */
export const MINECRAFT_CLIENT_DEFAULTS: MinecraftClientConfig = {
  ...structuredClone(MINECRAFT_DEFAULTS), host: '', username: '', version: 'auto', enabled: false, viewerPort: 0,
  viewerAssetsDir: fileURLToPath(new URL('../../dist/viewer/', import.meta.url)), escapeCommand: '',
  local: { ...MINECRAFT_DEFAULTS.local, startWithWorld: false, serverDir: '', cheats: false },
  client: { ...MINECRAFT_DEFAULTS.client, autoSpectate: false, resyncSec: 0 },
  player: { ...MINECRAFT_DEFAULTS.player, teleportToBot: false },
};
export function assertMinecraftReady(cfg: MinecraftClientConfig): void {
  validateReferenceConfig(cfg.knowledge);
  if (cfg.perception?.mineralVision !== undefined && typeof cfg.perception.mineralVision !== 'boolean')
    throw new Error('perception.mineralVision must be a boolean. Default false.');
  if (cfg.memoryAgentId !== undefined && (typeof cfg.memoryAgentId !== 'string' || !cfg.memoryAgentId.trim() || cfg.memoryAgentId.length > 160 || /[\x00-\x1f\x7f]/.test(cfg.memoryAgentId)))
    throw new Error('memoryAgentId must be a stable non-empty identifier, at most 160 characters.');
  if (cfg.skinModel !== undefined && !['classic', 'slim'].includes(cfg.skinModel)) throw new Error('Unknown skin arm model');
  if (cfg.localSkinEnabled !== undefined && typeof cfg.localSkinEnabled !== 'boolean') throw new Error('localSkinEnabled must be a boolean');
  if (cfg.viewDistance !== undefined && (!Number.isSafeInteger(cfg.viewDistance) || cfg.viewDistance < 2 || cfg.viewDistance > 32))
    throw new Error('viewDistance must be an integer from 2 to 32 chunks (server may cap/ignore it; not anti-xray).');
  respawnDelay(cfg.deathRespawnDelayMs);
  if (cfg.viewerMaxSessions !== undefined && (!Number.isSafeInteger(cfg.viewerMaxSessions) || cfg.viewerMaxSessions < 0))
    throw new Error('viewerMaxSessions must be a non-negative safe integer (0 disables the audience cap).');
  if (cfg.provider !== undefined && !['mineflayer', 'java-client'].includes(cfg.provider)) throw new Error('Unknown Minecraft body provider');
  if (cfg.provider === 'java-client') validateJavaClientConfiguration(cfg.javaClient);
  if (!cfg.host.trim() || !cfg.username.trim()) throw new Error('Configure a Minecraft server address and account.');
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error('Minecraft port must be an integer from 1 to 65535.');
  const mode = (cfg as MinecraftConfigSection & { auth?: string }).auth ?? 'offline';
  if (!['offline', 'microsoft'].includes(mode)) throw new Error('Minecraft authentication must be offline or microsoft.');
  if (mode === 'offline' && !/^[A-Za-z0-9_]{1,16}$/.test(cfg.username))
    throw new Error('Offline Minecraft account must contain 1–16 letters, digits or underscores.');
  if (cfg.username.length > 254 || /[\x00-\x1f\x7f]/.test(cfg.username) || cfg.username !== cfg.username.trim())
    throw new Error('Invalid Minecraft account identifier.');
  if (cfg.idle.selector !== 'random') throw new Error('Idle inference belongs to the host; migrate legacy configuration before connecting.');
  protocolVersion(cfg.version);
  if (cfg.keepAliveTimeoutMs !== undefined && (!Number.isInteger(cfg.keepAliveTimeoutMs) || cfg.keepAliveTimeoutMs < 1000 || cfg.keepAliveTimeoutMs > 300000))
    throw new Error('keepAliveTimeoutMs must be an integer from 1000 to 300000 milliseconds.');
  if (cfg.chatDuplicateWindowMs !== undefined && (!Number.isSafeInteger(cfg.chatDuplicateWindowMs) || cfg.chatDuplicateWindowMs < 0))
    throw new Error('chatDuplicateWindowMs must be a non-negative safe integer in milliseconds (0 disables it).');
}
