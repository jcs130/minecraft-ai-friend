import { describe, it, expect } from 'vitest';
import { AgentViewGallery, type AgentViewInput } from '../core/viewer-agent-views.ts';
import { MinecraftWorld } from '../core/world.ts';

const input = (): AgentViewInput => ({png:Buffer.from('89504e470d0a1a0a00000000','hex'),
  capturedAt:'2026-10-13T12:41:36.430Z',mode:'third',width:1280,height:720,dimension:'overworld',
  position:{x:-660.5,y:74,z:-693.5},focus:'检查木板结构'});

describe('actual Agent photograph gallery',()=>{
  it('keeps original bytes, isolates metadata, and never equates handoff to model delivery',()=>{
    const gallery=new AgentViewGallery(),source=input(),id=gallery.add(source)!;
    const before=Buffer.from(source.png);source.png[9]=42;source.position.x=1;
    expect(gallery.image(id)).toEqual(before);expect(gallery.list()[0].position.x).toBe(-660.5);
    gallery.mark(id,'host-event');expect(gallery.list()[0].delivery).toBe('host-event');
    expect(gallery.list()[0].modelReceived).toBeNull();
    const rows=gallery.list();rows[0].position.x=2;expect(gallery.list()[0].position.x).toBe(-660.5);
  });
  it('evicts old images by bytes and clears images when the viewer closes',()=>{
    const gallery=new AgentViewGallery(8,24),first=gallery.add(input())!,second=gallery.add(input())!;
    const third=gallery.add(input())!;expect(gallery.image(first)).toBeUndefined();
    expect(gallery.list().map(x=>x.id)).toEqual([third,second]);
    expect(gallery.add({...input(),png:Buffer.alloc(25)})).toBeNull();
    gallery.clear();expect(gallery.list()).toEqual([]);expect(gallery.image(third)).toBeUndefined();
  });
  it('keeps rejected or stale background handoffs distinct from successful ones',async()=>{
    const gallery=new AgentViewGallery(),id=gallery.add(input())!,outcome={text:'capture',blobs:[]};
    const harness:any=Object.create(MinecraftWorld.prototype);
    harness.visualFrames=new WeakMap([[outcome,{id,gallery}]]);
    harness.visualJobIsCurrent=()=>true;
    const job:any={controller:new AbortController(),host:{pushEvent:async()=>{throw Error('host unavailable');},log:{warn(){}}},timedOut:false};
    await harness.deliverVisualObservation(job,Promise.resolve(outcome));expect(gallery.list()[0].delivery).toBe('failed');
    job.host.pushEvent=async()=>{};await harness.deliverVisualObservation(job,Promise.resolve(outcome));
    expect(gallery.list()[0].delivery).toBe('host-event');expect(gallery.list()[0].modelReceived).toBeNull();
    harness.visualJobIsCurrent=()=>false;await harness.deliverVisualObservation(job,Promise.resolve(outcome));
    expect(gallery.list()[0].delivery).toBe('discarded');
  });
});
