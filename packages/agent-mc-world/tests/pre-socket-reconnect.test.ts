import {EventEmitter} from 'node:events';
import net from 'node:net';
import {expect, it, vi} from 'vitest';
import mineflayer from 'mineflayer';
import * as endpoints from '../core/connect-endpoint.ts';
import {Bridge} from '../core/bridge.ts';

it.each([true, false])('settles exhaustion before socket attachment and respects autoReconnect=%s', async autoReconnect => {
  vi.useFakeTimers();
  const candidate = vi.spyOn(endpoints,'resolveMinecraftConnectCandidates').mockResolvedValue({
    candidates:[{host:'127.0.0.1',port:25565,source:'fixture'}]
  });
  let accepting = false;
  const dial = vi.spyOn(net,'connect').mockImplementation((() => {
    const socket = new net.Socket();
    queueMicrotask(() => accepting ? socket.emit('connect') : socket.emit('error',Object.assign(Error('refused'),{code:'ECONNREFUSED'})));
    return socket;
  }) as typeof net.connect);
  const clients: EventEmitter[] = [];
  const create = vi.spyOn(mineflayer,'createBot').mockImplementation((opts:any) => {
    const client = Object.assign(new EventEmitter(),{setSocket:vi.fn(),write:vi.fn()});
    const bot = Object.assign(new EventEmitter(),{_client:client,loadPlugin(){},quit(){},version:'1.21.1'});
    client.on('error',e=>bot.emit('error',e));
    client.on('end',r=>bot.emit('end',r));
    clients.push(client);
    opts.connect(client);
    return bot as never;
  });
  const log={info(){},warn(){},error(){},debug(){},trace(){},emit(){},child(){return this;}};
  const disconnect=vi.fn();
  const bridge=new Bridge({host:'test.invalid',port:25565,username:'Fixture',version:'1.21.1',
    viewerPort:0,log:log as never,autoReconnect,onDisconnect:disconnect,onSpawn(){}});
  try {
    bridge.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(bridge.connected).toBe(false);
    accepting = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(create).toHaveBeenCalledTimes(autoReconnect?2:1);
    if(autoReconnect)expect((clients[1] as any).setSocket).toHaveBeenCalledTimes(1);
    clients[0]!.emit('end','late');
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    await bridge.stop(); create.mockRestore(); dial.mockRestore(); candidate.mockRestore(); vi.useRealTimers();
  }
});
