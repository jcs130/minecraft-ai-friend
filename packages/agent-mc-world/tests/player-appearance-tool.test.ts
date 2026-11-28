import { describe, expect, it } from 'vitest';
import { appearanceTool, compareSelfSkin } from '../src/appearance.ts';
import { skinsRestorerCommandKind, skinsRestorerRestoreCommand } from '../src/skinsrestorer.ts';
import { MinecraftWorld, MINECRAFT_TOOL_DECLS } from '../src/extension.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/index.ts';
import type { ToolCallContext } from '../src/contracts/host.ts';

const ctx = {} as ToolCallContext;
const expected = {textureHash:'a'.repeat(64), model:'slim'} as const;
const native = {...expected, username:'Example',uuid:'sample-id',source:'player-info'} as const;

describe('external agent appearance',()=>{
  it('keeps server state separate from the caller selection',async()=>{
    const probe=appearanceTool(()=>({selfSkin:native}));
    expect(probe.bodyControl).toBe('independent');
    expect(await probe.handler({expected},ctx)).toMatchObject({meta:{appearance:{observed:native,comparison:'matches'}}});
    expect(compareSelfSkin({selfSkin:native},{...expected,model:'classic'}).comparison).toBe('differs');
    expect(await probe.handler({expected:{...expected,model:'classic'},prepareRestore:'skinsrestorer'},ctx)).toMatchObject({meta:{appearance:{comparison:'differs',suggestedStep:{skill:'chat'}}}});
    expect(await probe.handler({expected,prepareRestore:'skinsrestorer'},ctx)).toMatchObject({meta:{appearance:{suggestedStep:null}}});
    expect(compareSelfSkin({selfSkin:native,experience:{serviceScope:{account:'microsoft:login@example.invalid'}}},expected).comparison).toBe('matches');
    expect(compareSelfSkin({selfSkin:native,experience:{serviceScope:{account:'offline:Other'}}},expected).comparison).toBe('unknown');
    expect(compareSelfSkin({selfSkin:null},expected)).toEqual({observed:null,comparison:'unknown'});
    expect(compareSelfSkin({selfSkin:{...native,textureHash:'a'.repeat(40)}}).comparison).toBe('observed');
    expect(await probe.handler({expected:{model:'classic'}},ctx)).toMatchObject({failed:true});
  });
  it('is discoverable in the native World even when the account is offline',async()=>{
    const world = new MinecraftWorld({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS)});
    expect(MINECRAFT_TOOL_DECLS.some(t=>t.name==='mc_appearance')).toBe(true);
    expect(await world.tools().find(t=>t.name==='mc_appearance')!.handler({},ctx))
      .toMatchObject({meta:{appearance:{comparison:'unknown',observed:null}}});
  });
  it('classifies the opt-in plugin syntax without contacting a server',()=>{
    const restore=skinsRestorerRestoreCommand(expected);
    expect(skinsRestorerCommandKind(restore,expected)).toBe('restore-selected');
    for(const command of ['/skin clear','/skin Other','/skin random','/skin update'])
      expect(skinsRestorerCommandKind(command,expected)).toBe('change');
    expect(skinsRestorerCommandKind('/skin help',expected)).toBe('inspect');
    expect(skinsRestorerCommandKind('/some_other_plugin',expected)).toBe('other');
  });
});
