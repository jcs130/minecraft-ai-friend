import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { SimpleVoiceChatLane } from '../core/simple-voice-chat-lane.ts';

function fakeBot() {
  const client = new EventEmitter() as EventEmitter & { state: string; write: (name: string, pkt: any) => void };
  client.state = 'play';
  const writes: any[] = [];
  client.write = (name, pkt) => { writes.push({ name, ...pkt }); };
  const bot: any = { _client: client, on: client.on.bind(client), once: client.once.bind(client), off: client.off.bind(client), emit: client.emit.bind(client) };
  return { bot, client, writes };
}
const fakeOpus = () => ({ kind: 'test', encode: () => Buffer.from([1]), close() {} });
const until = async (fn: () => boolean, ms = 2000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise(r => setTimeout(r, 10)); return fn(); };

describe('SimpleVoiceChatLane server-pack gate', () => {
  it('stays disabled by default and never attaches', () => {
    const { bot, writes } = fakeBot();
    const lane = new SimpleVoiceChatLane({ config: () => ({ enabled: false, officialJar: '', javaPath: '', compatibilityVersion: 20 }), blob: () => null, opus: fakeOpus });
    lane.sync({ bot, stillCurrent: () => true });
    expect(lane.attached).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('holds SVC while the gate is closed (lobby), attaches after it opens, and closes again on a backend switch', async () => {
    const { bot, client, writes } = fakeBot();
    let gate = false;
    const lane = new SimpleVoiceChatLane({
      config: () => ({ enabled: true, officialJar: '', javaPath: '', compatibilityVersion: 20, bindHost: '127.0.0.1' }),
      blob: () => null, opus: fakeOpus, resolveUdpHost: async () => '127.0.0.1',
    });
    const ctx = { bot, stillCurrent: () => client.state === 'play' && gate };
    lane.sync(ctx);
    expect(lane.attached).toBe(false);
    expect(writes.filter(w => w.channel === 'voicechat:request_secret')).toHaveLength(0);
    gate = true;
    lane.sync(ctx);
    expect(lane.attached).toBe(true);
    expect(await until(() => writes.some(w => w.channel === 'voicechat:request_secret'))).toBe(true);
    client.state = 'configuration';
    lane.sync();
    expect(lane.attached).toBe(false);
    client.state = 'play';
    lane.sync(ctx);
    expect(lane.attached).toBe(true);
    await lane.stop();
    expect(lane.attached).toBe(false);
  });
});
