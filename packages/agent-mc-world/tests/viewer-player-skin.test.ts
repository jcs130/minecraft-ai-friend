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
