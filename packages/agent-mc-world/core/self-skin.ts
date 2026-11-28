import type { Bot } from 'mineflayer';
import type { WorldRequestFacts } from '../src/contracts/host.ts';
import { playerSkinTexture } from './viewer-player-profile.mjs';

/** A viewer overlay, another player's texture, and an absent texture are not evidence of the body's skin. */
export function selfSkin(bot: Bot | null | undefined): WorldRequestFacts['selfSkin'] {
  const uuid = bot?._client?.uuid ?? bot?.player?.uuid ?? bot?.entity?.uuid;
  const player = bot?.players?.[bot.username];
  if (!bot || !uuid || player?.uuid !== uuid) return null;
  const texture = playerSkinTexture(player);
  return texture ? { username: bot.username, uuid, textureHash: texture.hash, model: texture.model, source: 'player-info' } : null;
}
