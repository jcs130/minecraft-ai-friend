/** Player appearance from the server's player-info texture properties. */
import type mineflayer from 'mineflayer';
import {playerSkinTexture} from './viewer-player-profile.mjs';

export function viewerPlayerSkin(bot: mineflayer.Bot, username: string | undefined,
  uuid?: string, remoteTextures = true): { skinUrl?: string; skinModel?: 'classic' | 'slim'; skinAvailability?: 'disabled' } {
  if (!remoteTextures) return { skinAvailability: 'disabled' };
  const named=username?bot.players?.[username]:undefined;
  const player=uuid?Object.values(bot.players??{}).find(entry=>entry.uuid===uuid):named;
  const skin=playerSkinTexture(player);
  return skin?{skinUrl:`/head-texture/${skin.hash}.png`,skinModel:skin.model}:{};
}
