import '../core/dependency-patches.ts';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { expect,it } from 'vitest';
const root=createRequire(import.meta.url),mf=createRequire(root.resolve('mineflayer'));
function rig(){const bot:any=Object.assign(new EventEmitter(),{registry:mf('prismarine-registry')('1.21.11'),_client:new EventEmitter()});bot.supportFeature=bot.registry.supportFeature;mf('mineflayer/lib/plugins/team.js')(bot);return bot;}
const message={type:'string',value:''};
it('retains modern decoded friendly-fire and friendly-invisibility flags through team add/change',()=>{
 const bot=rig(),uuid='00000000-0000-0000-0000-000000000007';
 // SYNTHETIC decoded packet matching the actual774 flags schema, not captured wire.
 bot._client.emit('teams',{team:'test',mode:'add',name:message,prefix:message,suffix:message,flags:{friendly_fire:true,see_friendly_invisible:true},nameTagVisibility:'never',collisionRule:'never',players:[uuid]});
 expect(bot.teamMap[uuid].friendlyFire).toBe(3);
 bot._client.emit('teams',{team:'test',mode:'change',name:message,prefix:message,suffix:message,flags:{friendly_fire:false,see_friendly_invisible:true},nameTagVisibility:'always',collisionRule:'always'});
 expect(bot.teamMap[uuid].friendlyFire).toBe(2);
});
it('continues to retain legacy numeric flags',()=>{
 const bot=rig();bot._client.emit('teams',{team:'legacy',mode:'add',name:message,prefix:message,suffix:message,friendlyFire:1,nameTagVisibility:'always',collisionRule:'always',players:['legacy']});
 expect(bot.teamMap.legacy.friendlyFire).toBe(1);
});
