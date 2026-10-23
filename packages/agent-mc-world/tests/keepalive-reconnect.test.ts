import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
import mineflayer from 'mineflayer';
import {Bridge} from '../core/bridge.ts';
const req=createRequire(createRequire(createRequire(import.meta.url).resolve('mineflayer')).resolve('minecraft-protocol'));
it.each(['1.20.6','1.21.1'])('runs the actual keepalive timeout into bridge disconnect/reconnect and clears the old timer in %s',async version=>{
  vi.useFakeTimers();
  const bots:any[]=[],disconnected=vi.fn(),spawned=vi.fn();
  const create=vi.spyOn(mineflayer,'createBot').mockImplementation((options:any)=>{
    const client=Object.assign(new EventEmitter(),{write:vi.fn(),end:vi.fn()});
    const bot=Object.assign(new EventEmitter(),{_client:client,loadPlugin(){},quit(){client.end('operator');},
      entity:{position:{x:0,y:64,z:0}},version});
    client.end.mockImplementation((reason:string)=>{client.emit('end',reason);bot.emit('end',reason);});
    client.on('error',error=>bot.emit('error',error));
    req('./client/keepalive.js')(client,{checkTimeoutInterval:options.checkTimeoutInterval});
    bots.push(bot);return bot as never;
  });
  const log={info(){},warn(){},error(){},debug(){},trace(){},emit(){},child(){return this;}};
  const bridge=new Bridge({host:'fixture.test',port:25565,username:'Tester',version,viewerPort:0,keepAliveTimeoutMs:1000,log:log as never,
    onSpawn:spawned,onDisconnect:disconnected});
  Object.assign(bridge,{installSpawnGear(){}});
  try {
    bridge.start();bots[0].emit('spawn');expect(bridge.connected).toBe(true);
    bots[0]._client.emit('keep_alive',{keepAliveId:1n});
    await vi.advanceTimersByTimeAsync(1001);
    expect(bots[0]._client.end).toHaveBeenCalledWith('keepAliveError');
    expect(disconnected).toHaveBeenCalledOnce();expect(bridge.connectionState).toMatchObject({phase:'retrying',ready:false});
    expect(bridge.connectionState.failure).toContain('timed out');
    await vi.advanceTimersByTimeAsync(3000);expect(create).toHaveBeenCalledTimes(2);
    bots[1].emit('spawn');expect(bridge.connected).toBe(true);expect(spawned).toHaveBeenCalledTimes(2);
    // Ended transports cannot receive new keepalive packets. Delayed end events
    // from the old generation must not affect the new connection or retry loop.
    bots[0]._client.emit('end','late');bots[0].emit('end','late');await vi.advanceTimersByTimeAsync(1001);
    expect(bots[0]._client.end).toHaveBeenCalledTimes(1);expect(disconnected).toHaveBeenCalledTimes(1);
    await bridge.stop();await vi.advanceTimersByTimeAsync(10000);expect(create).toHaveBeenCalledTimes(2);
  }finally{await bridge.stop();create.mockRestore();vi.useRealTimers();}
});
