/** Player appearance from the server's player-info texture properties. */
import type mineflayer from 'mineflayer';

export function viewerPlayerSkin(bot: mineflayer.Bot, username: string | undefined,
  uuid?: string): { skinUrl?: string; skinModel?: 'classic' | 'slim' } {
  const player = (username ? bot.players?.[username] : undefined)
    ?? (uuid ? Object.values(bot.players ?? {}).find(entry => entry.uuid === uuid) : undefined);
  const skin = player?.skinData;
  if (!skin?.url || typeof skin.url !== 'string') return {};
  try {
    const url = new URL(skin.url);
    const hash = /^\/texture\/([0-9a-f]{40,64})$/.exec(url.pathname)?.[1];
    if (!hash || !['http:', 'https:'].includes(url.protocol) || url.hostname !== 'textures.minecraft.net'
      || url.port || url.username || url.password || url.search || url.hash) return {};
    return { skinUrl: `/head-texture/${hash}.png`, skinModel: skin.model === 'slim' ? 'slim' : 'classic' };
  } catch { return {}; }
}
