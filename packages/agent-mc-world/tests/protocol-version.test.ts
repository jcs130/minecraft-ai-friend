import { createRequire } from 'node:module';
import { once } from 'node:events';
import mineflayer from 'mineflayer';
import { expect, it } from 'vitest';
// Native status ping, auto detection and offline protocol login. This temporary
// server has no world: it cannot verify gameplay or rendering parity.
const require = createRequire(import.meta.url);
const protocol = createRequire(require.resolve('mineflayer'))('minecraft-protocol');

it.each(['1.20.6', '1.21.1'])('negotiates Java %s against a real loopback protocol server', async version => {
  const server = protocol.createServer({ host: '127.0.0.1', port: 0, version, 'online-mode': false, maxPlayers: 4,
    motd: 'Agent MC World isolated protocol fixture', hideErrors: true });
  const errors: string[] = [];
  server.on('error', (error: Error) => errors.push(error.message)); await once(server, 'listening');
  const port = server.socketServer.address().port, login = once(server, 'login');
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username: 'VersionFixture', auth: 'offline', logErrors: false });
  bot.on('error', error => { errors.push(error.message); });
  try {
    const [client] = await login;
    expect(client.username).toBe('VersionFixture'); expect(bot.version).toBe(version); expect(errors).toEqual([]);
  } finally {
    bot.quit();
    for (const client of Object.values(server.clients) as Array<{ end(reason: string): void }>) client.end('Fixture complete');
    const closed = once(server, 'close'); server.close(); await closed;
  }
}, 15_000);
