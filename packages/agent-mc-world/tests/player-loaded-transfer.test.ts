import '../core/dependency-patches.ts';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { installPlayerLoadedAck } from '../core/player-loaded.ts';

const require = createRequire(import.meta.url);

const LOBBY_ERROR = 'Unable to connect to lobby: An internal server connection error occurred.';

const LIMBO_POSITION = {
  teleportId: 1,
  x: 0,
  y: 400,
  z: 0,
  dx: 0,
  dy: 0,
  dz: 0,
  yaw: 0,
  pitch: 0,
  flags: {},
};

const WORLD_POSITION = {
  teleportId: 2,
  x: 0.5,
  y: 65,
  z: 0.5,
  dx: 0,
  dy: 0,
  dz: 0,
  yaw: 0,
  pitch: 0,
  flags: {},
};

function slimLoginPacket(registry: { loginPacket: Record<string, unknown> }, worldName: string) {
  const raw = registry.loginPacket;
  const worldState = { ...(raw.worldState as Record<string, unknown>), name: worldName, death: undefined };
  return {
    entityId: 1,
    isHardcore: raw.isHardcore,
    worldNames: raw.worldNames,
    maxPlayers: raw.maxPlayers,
    viewDistance: raw.viewDistance,
    simulationDistance: raw.simulationDistance,
    reducedDebugInfo: raw.reducedDebugInfo,
    enableRespawnScreen: raw.enableRespawnScreen,
    doLimitedCrafting: raw.doLimitedCrafting,
    worldState,
    onlineMode: raw.onlineMode ?? false,
    enforcesSecureChat: raw.enforcesSecureChat ?? false,
  };
}

async function waitForPacket(client: { on: Function; off?: Function }, name: string, ms: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => { client.off?.('packet', onPacket); resolve(false); }, ms);
    const onPacket = (data: unknown, meta: { name: string }) => {
      if (meta.name !== name) return;
      clearTimeout(timer);
      client.off?.('packet', onPacket);
      resolve(true);
    };
    client.on('packet', onPacket);
  });
}

async function runLimboTransfer(opts: { installAck: boolean }) {
  const {
    loadExperimentalMineflayer,
    installExperimentalMinecraftDataResolution,
    uninstallExperimentalMinecraftDataResolution,
  } = await import('../core/experimental-26.2.ts');
  installExperimentalMinecraftDataResolution();
  const experimentalProtocol = require('../vendor/experimental-26.2/minecraft-protocol');
  const registry = require('../vendor/experimental-26.2/minecraft-data')('26.2');
  const server = experimentalProtocol.createServer({
    host: '127.0.0.1',
    port: 0,
    version: '26.2',
    'online-mode': false,
    maxPlayers: 4,
    motd: 'Agent MC World NanoLimbo-shaped 26.2 fixture',
    hideErrors: true,
  });
  const errors: string[] = [];
  const inbound: string[] = [];
  server.on('error', (error: Error) => errors.push(error.message));
  await once(server, 'listening');
  const port = server.socketServer.address().port;
  const joined = once(server, 'playerJoin');

  const bot = loadExperimentalMineflayer().createBot({
    host: '127.0.0.1',
    port,
    username: opts.installAck ? 'LoadedAckBot' : 'NoAckBot',
    auth: 'offline',
    version: '26.2',
    logErrors: false,
    hideErrors: true,
  });
  bot.on('error', (error: Error) => errors.push(error.message));
  const disposeAck = opts.installAck ? installPlayerLoadedAck(bot) : () => {};

  let kickReason: string | undefined;
  let reachedOfficialPlay = false;
  let sawPlayerLoadedInLimbo = false;

  try {
    const [client] = await joined as [any];
    client.on('packet', (_data: unknown, meta: { name: string }) => inbound.push(meta.name));
    const rememberKick = (reason: unknown) => {
      if (reason == null) return;
      const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
      if (text && text !== '{}' && text !== 'null' && !kickReason) kickReason = text;
    };
    client.on('end', rememberKick);
    client.on('disconnect', rememberKick);
    client.on('kick_disconnect', (packet: { reason?: unknown }) => rememberKick(packet?.reason ?? packet));
    bot.on('kicked', rememberKick);
    bot.on('end', rememberKick);

    client.write('login', slimLoginPacket(registry, 'minecraft:overworld'));
    client.write('position', LIMBO_POSITION);

    sawPlayerLoadedInLimbo = inbound.includes('player_loaded') || await waitForPacket(client, 'player_loaded', 750);

    // Hypothesized waiting-world gate: transfer only proceeds after player_loaded.
    // This is a local reproduction of the evidenced client difference, not a dump of Velocity source.
    if (!sawPlayerLoadedInLimbo) {
      const ended = once(bot, 'end');
      client.end(LOBBY_ERROR);
      await Promise.race([ended, new Promise((r) => setTimeout(r, 2_000))]);
      return { sawPlayerLoadedInLimbo, kickReason, reachedOfficialPlay, inbound, errors };
    }

    client.write('start_configuration', {});
    const acked = await waitForPacket(client, 'configuration_acknowledged', 2_000);
    client.write('finish_configuration', {});
    const finished = await waitForPacket(client, 'finish_configuration', 2_000);
    client.write('login', slimLoginPacket(registry, 'minecraft:overworld'));
    client.write('position', WORLD_POSITION);
    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
    await new Promise((r) => setTimeout(r, 400));
    reachedOfficialPlay = inbound.includes('player_loaded') && client.state === 'play';
    return { sawPlayerLoadedInLimbo, kickReason, reachedOfficialPlay, inbound, errors, acked, finished };
  } finally {
    disposeAck();
    const end = (bot as { quit?: () => void; end?: () => void }).quit ?? (bot as { end?: () => void }).end;
    try { end?.call(bot); } catch { /* already closed */ }
    for (const client of Object.values(server.clients) as Array<{ end(reason: string): void }>) {
      try { client.end('Fixture complete'); } catch { /* already closed */ }
    }
    const closed = once(server, 'close');
    server.close();
    await closed.catch(() => {});
    uninstallExperimentalMinecraftDataResolution();
  }
}

it('mineflayer without the ack helper does not send player_loaded after a NanoLimbo-shaped position-without-health, and the transfer fixture kicks', async () => {
  const result = await runLimboTransfer({ installAck: false });
  expect(result.sawPlayerLoadedInLimbo).toBe(false);
  expect(result.reachedOfficialPlay).toBe(false);
  expect(String(result.kickReason ?? '')).toContain('internal server connection error');
}, 20_000);

it('installPlayerLoadedAck sends player_loaded on the limbo position and the local 127.0.0.1 transfer fixture then completes a second play session', async () => {
  const result = await runLimboTransfer({ installAck: true });
  expect(result.errors).toEqual([]);
  expect(result.sawPlayerLoadedInLimbo).toBe(true);
  expect(result.reachedOfficialPlay).toBe(true);
  expect(result.kickReason === undefined || !String(result.kickReason).includes('internal server connection error')).toBe(true);
}, 20_000);
