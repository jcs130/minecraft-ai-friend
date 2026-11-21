import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import minecraftData from 'minecraft-data';
import { expect,it } from 'vitest';
import { entityNativeState,installEntityNativeState } from '../core/entity-native-state.ts';
it('retains parsed spawn type, UUID, typed incremental metadata and public state without losing earlier fields',()=>{
 const e={id:7,uuid:'00000000-0000-0000-0000-000000000007',name:'creeper',type:'hostile',width:.6,height:1.7};
 const bot=Object.assign(new EventEmitter(),{_client:new EventEmitter(),registry:minecraftData('1.21.11'),entities:{7:e},entity:{id:1},teamMap:{[e.uuid]:{team:'test',collisionRule:1}}}) as unknown as Bot;
 const dispose=installEntityNativeState(bot);
 bot._client.emit('spawn_entity',{entityId:7,objectUUID:e.uuid,type:32,x:1,y:64,z:2,objectData:0});
 bot._client.emit('entity_metadata',{entityId:7,metadata:[{key:15,type:'byte',value:1}]});
 bot._client.emit('entity_metadata',{entityId:7,metadata:[{key:9,type:'float',value:20}]});
 const s=entityNativeState(bot,e as never)!;expect(s.spawn).toMatchObject({typeId:32,uuid:e.uuid});
 expect(s.metadata).toEqual(expect.arrayContaining([expect.objectContaining({key:15,type:'byte',value:1}),expect.objectContaining({key:9,type:'float',value:20})]));expect(s.updates).toHaveLength(2);expect(s.team).toMatchObject({name:'test',collisionRule:1});
 bot._client.emit('entity_destroy',{entityIds:[7]});expect(entityNativeState(bot,e as never)).toBeNull();dispose();
});
