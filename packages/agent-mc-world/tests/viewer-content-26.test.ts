import {it,expect} from 'vitest';
import {viewerParticlePacket,viewerMapPacket,frameMapId} from '../core/viewer-content.mjs';
const base={x:0,y:69,z:0,offsetX:0,offsetY:0,offsetZ:0,velocityOffset:0,amount:1,longDistance:true};
it('26.1 packed dust colors use current protocol, never old float order',()=>{
 expect(viewerParticlePacket({...base,particle:{type:'dust',data:{color:0xff8000,scale:1}}},{version:'26.1'})).toMatchObject({color:[1,128/255,0],size:1});
 expect(viewerParticlePacket({...base,particle:{type:'dust_color_transition',data:{fromColor:0xff0000,toColor:255,scale:2}}},{version:'26.1'})).toMatchObject({color:[1,0,0],colorEnd:[0,0,1],size:2});
 expect(viewerParticlePacket({...base,particle:{type:'dust',data:{red:1,green:0,blue:0,scale:1}}},{version:'26.1'})).toBeNull();
});
it('26.1 current map packets and item components remain validated',()=>{
 expect(viewerMapPacket({itemDamage:4,scale:0,columns:1,rows:1,x:0,y:0,data:Buffer.from([4])})).toMatchObject({mapId:4,data:Uint8Array.from([4])});
 expect(frameMapId({itemId:1,itemCount:1,components:[{type:'map_id',data:4}]},{items:{1:{name:'filled_map'}}})).toBe(4);
});

import {loadViewerSoundRegistry} from '../core/viewer-sound-registry.ts';
import {viewerSoundPacket} from '../core/viewer-sound-packets.ts';
import {createRequire} from 'node:module';
it('26.1 numeric sounds compensate current holder decoding exactly once',async()=>{
 const require=createRequire(import.meta.url);const data=require('minecraft-data')('26.1');
 const result=await loadViewerSoundRegistry('/nonexistent','26.1',data);
 expect(result.registry.sounds?.[0]?.name).toBe('entity.allay.ambient_with_item');
 expect(result.registry.sounds?.[1901]?.name).toBe('item.nautilus_saddle_equip');
 expect(viewerSoundPacket('sound_effect',{sound:{soundId:0},x:0,y:0,z:0,volume:1,pitch:1},result.registry,()=>null)?.name).toBe('entity.allay.ambient_with_item');
});
