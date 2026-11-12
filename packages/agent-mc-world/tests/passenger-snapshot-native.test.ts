import '../core/dependency-patches.ts';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
import {methodHarness} from './method-harness.ts';
import type {Bot} from 'mineflayer';
import {Vec3} from 'vec3';
const req=createRequire(createRequire(import.meta.url).resolve('mineflayer'));

it.each(['1.21.1','1.20.6'])('applies complete passenger snapshots once and detaches only from the matching vehicle (%s)',version=>{
  const h=methodHarness(version);h.close();const b=h.bot as unknown as Bot;
  Object.assign(b,{supportFeature:b.registry.supportFeature});const self=b.entity;
  req('mineflayer/lib/plugins/entities.js')(b);b.entity=self;b.entities[self.id]=self;
  for(const id of [9,10])b.entities[id]={id,name:'boat',isValid:true,position:new Vec3(.5,64,.5),passengers:[]} as never;
  let mounts=0,dismounts=0;b.on('mount',()=>mounts++);b.on('dismount',()=>dismounts++);
  const packet=(id:number,passengers:number[])=>b._client.emit('set_passengers',{entityId:id,passengers});
  packet(9,[self.id,2]);packet(9,[self.id,2]);
  expect(b.entities[9].passengers.map(p=>p.id)).toEqual([self.id,2]);expect(mounts).toBe(1);
  packet(9,[self.id]);expect(b.entities[2].vehicle).toBeNull();expect(dismounts).toBe(0);
  packet(10,[self.id]);expect(b.vehicle).toBe(b.entities[10]);expect(b.entities[9].passengers).toEqual([]);
  packet(9,[]);expect(b.vehicle).toBe(b.entities[10]);expect(dismounts).toBe(0);
  packet(10,[]);packet(10,[]);
  expect(b.vehicle).toBeNull();expect(b.entity.vehicle).toBeNull();expect(dismounts).toBe(1);expect(mounts).toBe(2);
});
