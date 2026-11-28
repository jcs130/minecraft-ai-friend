import {selfSkin} from '../core/self-skin.ts';
import type {Bot} from 'mineflayer';
import {expect,it} from 'vitest';
import {viewerPlayerSkin} from '../core/viewer-player-skin.ts';
import {playerSkinTexture} from '../core/viewer-player-profile.mjs';
const hash='a'.repeat(64),url='http://textures.minecraft.net/texture/'+hash;
it('uses vanilla server texture properties and the supplied arm model without a name lookup',()=>{
  const raw={properties:[{name:'textures',value:Buffer.from(JSON.stringify({textures:{SKIN:{url,metadata:{model:'slim'}}}})).toString('base64')}]};
  expect(playerSkinTexture(raw)).toEqual({hash,model:'slim'});
  const player={uuid:'real-uuid',...raw};const bot={players:{Alice:player}} as never;
  expect(viewerPlayerSkin(bot,'Alice','real-uuid')).toEqual({skinUrl:`/head-texture/${hash}.png`,skinModel:'slim'});
  expect(viewerPlayerSkin(bot,'Alice','superseded-uuid')).toEqual({});
  expect(viewerPlayerSkin(bot,'Alice','real-uuid',false)).toEqual({skinAvailability:'disabled'});
  expect(playerSkinTexture({skinData:{url:'https://evil.test/texture/'+hash}})).toBeNull();
  expect(playerSkinTexture({properties:[{name:'textures',value:'x'.repeat(20000)}]})).toBeNull();
});

it('reads the current self account after a profile refresh and forgets it on removal or UUID mismatch',()=>{
  const profile={uuid:'self',skinData:{url,model:'slim'}};
  const bot={username:'Alice',_client:{uuid:'self'},players:{Alice:profile,Bob:{...profile,uuid:'other'}}};
  const read=()=>selfSkin(bot as unknown as Bot);
  expect(read()).toEqual({username:'Alice',uuid:'self',model:'slim',textureHash:hash,source:'player-info'});
  profile.skinData={url:url.replace(hash,'b'.repeat(64)),model:'classic'};
  expect(read()).toMatchObject({textureHash:'b'.repeat(64),model:'classic'});
  profile.uuid='other';expect(read()).toBeNull();
  expect(selfSkin(null)).toBeNull();
});
