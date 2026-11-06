import {it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {attachProximityVoice} from '../src/proximity-voice.ts';
function fixture(){const bot=new EventEmitter() as any;bot._client=new EventEmitter();bot._client.state='play';const packets:any[]=[];bot._client.write=(_name:string,p:any)=>packets.push(p);return{bot,packets};}
it('explicit voice shutdown unregisters only its channel once without closing the game connection',()=>{
 const {bot,packets}=fixture();const voice=attachProximityVoice(bot);voice.close();voice.close();
 expect(packets.map(p=>[p.channel,p.data.toString()])).toEqual([['minecraft:register','mcagent:voice'],['minecraft:unregister','mcagent:voice']]);
 expect(bot._client.state).toBe('play');expect(bot._client.listenerCount('custom_payload')).toBe(0);
});
it('replacing an adapter unregisters before registering the replacement; stale close leaves it attached',()=>{
 const {bot,packets}=fixture();const old=attachProximityVoice(bot);const current=attachProximityVoice(bot);old.close();
 expect(packets.map(p=>p.channel)).toEqual(['minecraft:register','minecraft:unregister','minecraft:register']);
 expect(bot._client.listenerCount('custom_payload')).toBe(1);current.close();
});
it('network end resolves pending work without sending any extra packet or replaying audio',async()=>{
 const {bot,packets}=fixture();const voice=attachProximityVoice(bot);const result=voice.say('synthetic pending');const count=packets.length;
 bot.emit('end');voice.close();expect((await result).state).toBe('unknown');expect(packets.length).toBe(count);
});
it('unregister write failure still releases listeners and pending work without retry',async()=>{
 const {bot,packets}=fixture();const voice=attachProximityVoice(bot);const result=voice.say('synthetic pending');let calls=0;
 bot._client.write=()=>{calls++;throw Error('connection ended');};expect(()=>voice.close()).not.toThrow();voice.close();
 expect((await result).state).toBe('unknown');expect(calls).toBe(1);expect(bot._client.listenerCount('custom_payload')).toBe(0);expect(packets.filter(p=>p.channel==='mcagent:voice')).toHaveLength(1);
});
