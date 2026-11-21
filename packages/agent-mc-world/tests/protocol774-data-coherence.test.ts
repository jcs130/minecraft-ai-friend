import '../core/dependency-patches.ts';
import { createRequire } from 'node:module';
import { expect,it } from 'vitest';
const root=createRequire(import.meta.url),mf=createRequire(root.resolve('mineflayer'));
const canonical=root('minecraft-data')('1.21.11');
const map=(r:any)=>r.protocol.play.toClient.types.packet_entity_update_attributes[1][1].type[1].type[1][0].type[1].mappings;
it('uses the package-pinned protocol774 registry, not an older transitive schema',()=>{
 const registry=mf('prismarine-registry')('1.21.11');
 expect(map(registry)['22']).toBe('generic.movement_speed');
 expect(registry.protocol.types.SlotComponent).toEqual(canonical.protocol.types.SlotComponent);
});
function v(n:number){const b=[];do{let x=n&127;n>>>=7;if(n)x|=128;b.push(x);}while(n);return Buffer.from(b);}
function f(n:number){const b=Buffer.alloc(8);b.writeDoubleBE(n);return b;}
it('decodes independently assembled774 attribute IDs without misreporting speed as scale',()=>{
 const mappings=canonical.protocol.play.toClient.types.packet[1][0].type[1].mappings;
 const id=Number(Object.entries(mappings).find(([,n])=>n==='entity_update_attributes')![0]);
 // SYNTHETIC wire with actual observed values; not a captured attribute packet.
 const bytes=Buffer.concat([v(id),v(7),v(3),v(22),f(.25),v(0),v(25),f(1),v(0),v(32),f(0),v(0)]);
 const parser=mf('minecraft-protocol').createDeserializer({state:'play',isServer:false,version:'1.21.11',noErrorLogging:true});
 const parsed=parser.parsePacketBuffer(bytes);expect(parsed.metadata.size).toBe(bytes.length);
 expect(parsed.data.params.properties.map((p:any)=>[p.key,p.value])).toEqual([['generic.movement_speed',.25],['generic.scale',1],['water_movement_efficiency',0]]);
});
it('leaves non774 schemas on their existing dependency/version path',()=>{
 expect(mf('prismarine-registry')('1.21.1').version.version).toBe(767);
 expect(mf('prismarine-registry')('26.1').version.version).toBe(root('minecraft-data')('26.1').version.version);
});
