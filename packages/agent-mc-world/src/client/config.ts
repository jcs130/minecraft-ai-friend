import { fileURLToPath } from 'node:url';
import { MINECRAFT_DEFAULTS, type MinecraftConfigSection } from '../../core/config.ts';
import { protocolVersion } from './authentication.ts';

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
}
