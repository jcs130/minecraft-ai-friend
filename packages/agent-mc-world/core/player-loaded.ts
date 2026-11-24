import type { EventEmitter } from 'node:events';

/**
 * 1.21.4+ / 26.x clients must send `player_loaded` after entering play.
 * Mineflayer writes it from the first `update_health` (health.js). Waiting
 * worlds such as NanoLimbo often send a play position without health, so that
 * path never fires. This helper sends on the first play-state position, and is
 * the session owner: it intercepts every `player_loaded` write so each play
 * session emits the packet exactly once, whether the caller is this helper or
 * mineflayer. Leaving play, or `start_configuration`, starts a new session.
 * The packet is not swallowed when a session still needs it, and it is never
 * written during configuration.
 */
export interface PlayerLoadedBot {
  _client: EventEmitter & {
    state?: string;
    write: (name: string, params?: unknown) => unknown;
  };
  supportFeature?: (name: string) => boolean;
}

type WriteFn = (name: string, params?: unknown) => unknown;

export function installPlayerLoadedAck(bot: PlayerLoadedBot): () => void {
  let sentThisPlaySession = false;
  let disposed = false;
  const client = bot._client;
  const origWrite: WriteFn = client.write.bind(client);

  const enabled = () => bot.supportFeature?.('sendsPlayerLoadedPacket') === true;
  const inPlay = () => client.state === undefined || client.state === 'play';

  const writeOnce = () => {
    if (disposed || !enabled() || !inPlay() || sentThisPlaySession) return false;
    sentThisPlaySession = true;
    origWrite('player_loaded', {});
    return true;
  };

  const write: WriteFn = function (this: unknown, name: string, params?: unknown) {
    if (name !== 'player_loaded') return origWrite(name, params);
    // Session owner: accept the first in-play write from any caller; drop
    // duplicates and configuration-phase writes. A needed first write is never
    // dropped.
    if (disposed || !enabled() || !inPlay() || sentThisPlaySession) return undefined;
    sentThisPlaySession = true;
    return origWrite(name, params ?? {});
  };

  const onPosition = () => { writeOnce(); };
  const onState = (state: string) => {
    if (state && state !== 'play') sentThisPlaySession = false;
  };
  const onStartConfiguration = () => { sentThisPlaySession = false; };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (client.write === write) client.write = origWrite;
    client.removeListener('position', onPosition);
    client.removeListener('position_look', onPosition);
    client.removeListener('state', onState);
    client.removeListener('start_configuration', onStartConfiguration);
    client.removeListener('end', dispose);
  };

  client.write = write;
  client.on('position', onPosition);
  client.on('position_look', onPosition);
  client.on('state', onState);
  client.on('start_configuration', onStartConfiguration);
  client.once('end', dispose);
  return dispose;
}
