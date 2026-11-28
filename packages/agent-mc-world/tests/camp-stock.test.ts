import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CampStockBook, bedFoot, campScopeKey } from '../core/camp-stock.ts';
import { ChestBook } from '../core/chests.ts';
import { EventEmitter } from 'node:events';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
import { installWorldIdentity } from '../core/world-scope.ts';

describe('scoped camp supplies',()=>{
  const at={x:1,y:64,z:2};
  const scope=(world='w',account='alice')=>campScopeKey({realm:world,dimension:'overworld',account,agent:'agent'});
  it('persists observed sites apart from carried items and from another world or account',()=>{
    const dir=mkdtempSync(join(tmpdir(),'camp-stock-'));
    const file=join(dir,'assets.sqlite');
    const key=scope();
    const first=new CampStockBook(file);
    try {
      first.register(key,'home',at,12,100);
      first.observe(key,at,'white_bed','visible-block',110);
      first.observe(key,{...at,x:99},'white_bed','visible-block',112);
      first.close();
      const next=new CampStockBook(file);
      try {
        expect(next.read(key,'home','bed').records).toMatchObject([{...at,seenAt:110,items:null}]);
        expect(next.read(scope('other'),'home','bed').records).toEqual([]);
        expect(next.read(scope('w','bob'),'home','bed').records).toEqual([]);
        next.observe(key,at,'air','visible-replacement',180);
        next.observe(key,at,'white_bed','late-packet',120);
        expect(next.read(key,'home','bed').records).toEqual([]);
      } finally {next.close();}
    } finally {first.close();rmSync(dir,{recursive:true,force:true});}
  });
  it('makes camp registration and lookup reachable through the public tools, including after a native world change',async()=>{
    const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),username:'alice'};
    const world=new MinecraftWorld({cfg}),client=new EventEmitter();
    const bot=Object.assign(new EventEmitter(),{_client:client,entity:{position:{...at}},game:{dimension:'overworld'}});
    const detach=installWorldIdentity(bot as never);
    Object.assign(world,{bridge:{bot,connected:true},snapshot:()=>({invSynced:true})});
    const tool=(name:string,args:Record<string,unknown>)=>world.tools().find(t=>t.name===name)!.handler(args,{} as never);
    try {
      expect(await tool('mc_bag',{detail:'camp'})).toMatchObject({failed:true});
      client.emit('login',{worldState:{name:'world-a'}});
      expect(await tool('mc_map',{camp:{name:'base'}})).toMatchObject({data:{camps:[{name:'base',...at}]}});
      const exposed=world as unknown as {campStock:CampStockBook;campScope():string;bagReadout(q:string):{data:Record<string,unknown>}};
      exposed.campStock.observe(exposed.campScope(),at,'white_bed','visible-block',1000);
      expect(await tool('mc_bag',{camp:'base',detail:'camp',item:'床'})).toMatchObject({data:{records:[{kind:'white_bed',seenAt:1000}]}});
      expect(exposed.bagReadout('bed').data).toMatchObject({campEvidence:[{kind:'white_bed'}]});
      client.emit('respawn',{worldState:{name:'world-b'}});
      expect(await tool('mc_bag',{detail:'camp'})).toMatchObject({data:{camps:[]}});
      exposed.campStock.close();
    } finally {detach();}
  });
  it('maps bed halves to one physical bed',()=>{
    expect(bedFoot({...at,z:1},'head','north')).toEqual(bedFoot(at,'foot','north'));
    expect(bedFoot(at,'head','unknown')).toBeNull();
  });
  it('keeps physical container reads separate from sightings; a reopened empty window replaces old stock',()=>{
    const db=new CampStockBook(null);
    try {
      const k=scope(), other=scope('w','bob');
      db.register(k,'camp',at,12);
      db.observe(k,at,'barrel','visible-block',10);
      const book=new ChestBook(null);
      const bound=book.forRealm('w',r=>db.observe(k,r,r.name!,'window',r.observedAt!,r.items));
      const unrelated=book.forRealm('w',r=>db.observe(other,r,r.name!,'window',r.observedAt!,r.items));
      expect(db.read(k,'camp').records[0].items).toBeNull();
      bound.remember('overworld',at,[{name:'oak_log',count:4}],1,27,'barrel');
      unrelated.remember('overworld',at,[{name:'diamond',count:99}],1,27,'barrel');
      expect(db.read(k,'camp','oak_log').records[0]).toMatchObject({items:[{name:'oak_log',count:4}]});
      expect(db.read(k,'camp','diamond').records).toEqual([]);
      bound.remember('overworld',at,[],0,27,'barrel');
      expect(db.read(k,'camp').records[0].items).toEqual([]);
      expect(db.read(k,'camp','oak_log').records).toEqual([]);
    } finally {db.close();}
  });
  it('pages observations, excludes other elevations and invalidates contents when a block is replaced',()=>{
    const db=new CampStockBook(null),k=scope();
    try {
      db.register(k,'camp',at,6);
      db.observe(k,at,'chest','window',10,[{name:'iron_ingot',count:3}]);
      db.observe(k,at,'barrel','visible-block',11);
      db.observe(k,{...at,x:2},'crafting_table','visible-block',12);
      db.observe(k,{...at,y:90},'furnace','visible-block',13);
      expect(db.read(k,'camp',undefined,0,1)).toMatchObject({records:[{kind:'barrel',items:null,openedAt:null}],nextOffset:1});
      expect(db.read(k,'camp',undefined,1,1)).toMatchObject({records:[{kind:'crafting_table'}],nextOffset:null});
    } finally {db.close();}
  });
});
