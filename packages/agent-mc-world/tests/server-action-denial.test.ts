import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { Bridge } from '../core/bridge.ts';
import { parseServerActionDenial } from '../core/server-feedback.ts';
import { methodHarness } from './method-harness.ts';

const raw = 'MC_PROTECTION {"schemaVersion":1,"action":"break","status":"deny","allowed":false,"world":"minecraft:overworld","x":-472,"y":67,"z":-493,"retrySameAction":false,"reason":"guild_hall"}';
describe('direct server action denial', () => {
  it('reads explicit coordinates without depending on one server prefix or translating a protected region', () => {
    expect(parseServerActionDenial(raw)).toMatchObject({ action:'break', dimension:'overworld', x:-472, y:67, z:-493, reason:'guild_hall' });
    expect(parseServerActionDenial(raw.replace('MC_PROTECTION ', 'OTHER_SERVER '))).toBeTruthy();
    for (const changed of [raw.replace('"deny"','"allow_likely"'), raw.replace('-472','"-472"'), raw.replace('"world":','"elsewhere":'), raw.replace('"break"','"chat"')]) {
      expect(parseServerActionDenial(changed)).toBeNull();
    }
    expect(parseServerActionDenial('这里禁止深挖，请到村西矿坑')).toBeNull();
  });
  it('updates the exact observed cell even after dig timed out, without poisoning another dimension or unknown block', () => {
    const r=methodHarness('1.21.1');
    try {
      const bridge=new Bridge({host:'fixture',port:25565,username:'fixture',version:'1.21.1',viewerPort:0,log:r.host.log,onSpawn(){},onDisconnect(){}});
      Object.assign(bridge,{_bot:r.bot});
      r.set(-472,67,-493,'stone');
      const denial=parseServerActionDenial(raw)!;
      expect(bridge.noteServerActionDenied({...denial,dimension:'the_nether'})).toBe(false);
      expect(bridge.noteServerActionDenied(denial)).toBe(false); // no active matching dig to abort
      expect((bridge as any).protection.verdict('overworld',-472,67,-493,r.bot.registry.blocksByName.stone.id)).toBe('protected');
      expect((bridge as any).protection.verdict('overworld',-471,67,-493,r.bot.registry.blocksByName.stone.id)).toBe('allowed');
      r.bot.targetDigBlock=r.bot.blockAt(new Vec3(-472,67,-493));
      expect(bridge.noteServerActionDenied(denial)).toBe(true);
      expect(bridge.noteServerActionDenied({...denial,action:'place'})).toBe(false);
      expect((bridge as any).observedPlaceDenial('minecraft:overworld',denial)?.status).toBe('deny');
      expect((bridge as any).observedPlaceDenial('the_nether',denial)).toBeNull();
      expect((bridge as any).protection.verdict('overworld',-472,67,-493,r.bot.registry.blocksByName.dirt.id)).toBe('allowed');
    } finally {r.close();}
  });
  it('forwards structured rejection to the body only after excluding quoted player chat', async () => {
    const r=methodHarness('1.21.1');
    try {
      const apply=vi.fn(()=>true);
      Object.assign((r.world as any).bridge,{noteServerActionDenied:apply});
      (r.world as any).hookedBots.add(r.bot); (r.world as any).hookMessageEvents(r.bot);
      r.bot.emit('message',{toString:()=>raw},'system'); await Promise.resolve();
      expect(apply).toHaveBeenCalledOnce();
      r.bot.players={Jojo:{username:'Jojo',uuid:'uuid-jojo'}} as never;
      const quote={toString:()=>raw};
      r.bot.emit('message',quote,'system');r.bot.emit('chat','Jojo',raw,'',quote);await Promise.resolve();
      expect(apply).toHaveBeenCalledOnce();
      expect(r.world.requestFacts()!.parts!.find(p=>p.key==='serverFeedback')!.text).toContain('guild_hall');
    } finally {r.close();}
  });
  it('terminates a matching active native task with the complete original server reason', async () => {
    const r=methodHarness('1.21.1');
    try {
      Object.assign((r.world as any).bridge,{noteServerActionDenied:()=>true});
      Object.defineProperty(r.exec,'currentTask',{value:{id:9}});
      const stop=vi.spyOn(r.exec,'blockCurrentFromServer').mockReturnValue(true);
      (r.world as any).hookedBots.add(r.bot);(r.world as any).hookMessageEvents(r.bot);
      r.bot.emit('message',{toString:()=>raw},'system');await Promise.resolve();
      expect(stop).toHaveBeenCalledWith(raw);
    } finally {r.close();}
  });
  it('consumes action-bar denials as received effects and retains a concrete prohibition as raw evidence', async () => {
    const r=methodHarness('1.21.1');
    try {
      const apply=vi.fn(()=>false);
      Object.assign((r.world as any).bridge,{noteServerActionDenied:apply,noteServerBreakDenied:vi.fn()});
      (r.world as any).hookedBots.add(r.bot);(r.world as any).hookMessageEvents(r.bot);
      r.bot._client.emit('action_bar',{text:raw});
      expect(apply).toHaveBeenCalledOnce();
      r.bot.emit('message',{toString:()=> '村庄地下禁止深挖，请到村西矿坑 (-652,68,-484)。'},'system');
      await Promise.resolve();await Promise.resolve();
      expect(r.world.requestFacts()!.parts!.find(p=>p.key==='serverFeedback')!.text).toContain('村西矿坑');
    } finally {r.close();}
  });
});
