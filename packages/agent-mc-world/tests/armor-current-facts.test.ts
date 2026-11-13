import {expect,it} from 'vitest';
import {methodHarness} from './method-harness.ts';
import {narrateWorldSegments,snapshotFromBot} from '../core/terrain.ts';
it('projects missing slots and carry spares separately without asserting remote stock',()=>{
  const r=methodHarness('1.21.1');try{
    const snap={...snapshotFromBot(r.bot as any,{scanBlocks:false}),invSynced:true};
    snap.equipment=[{slot:'head',name:'iron_helmet',durability:{left:8,max:165},enchantments:[]}];
    const part=()=>narrateWorldSegments(snap).find(p=>p.key==='equip')!;
    expect(part().text).toContain('空着的护甲槽');expect(part().text).toContain('随身备用护甲：无');
    const old=part().cmp;snap.inventory.push({name:'iron_chestplate',count:1});
    expect(part().cmp).not.toBe(old);expect(part().text).toContain('铁胸甲');expect(part().text).toContain('仓库现货未知');
    snap.invSynced=false;expect(part().text).not.toContain('空着');expect(part().text).toContain('尚未同步');
  }finally{r.close();}
});
