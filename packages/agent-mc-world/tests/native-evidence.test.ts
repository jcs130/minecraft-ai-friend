import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { NativeEvidenceArchive, compactNativeState, compactNativeItems, compactNativeBody, compactNativeActionReceipt } from '../src/client/native-evidence.ts';

it('action readbacks retain measured held item, navigation and uncertainty without repeating a full bag or history',()=>{
  const state={position:[1,64,3],health:18,selectedSlot:8,inventory:Array.from({length:36},(_,slot)=>({slot,empty:false,name:'stone',count:64,instanceHash:'a'.repeat(64)})),
    menuSlots:[],actions:Array.from({length:30},(_,i)=>({id:'old-'+i,phase:'completed'})),
    inventoryTransfer:{phase:'unknown',dispatched:true,reason:'No confirmation'},navigation:{actionId:'original',phase:'running',goal:{x:1,y:64,z:8}}};
  const before=structuredClone(state),compact=compactNativeActionReceipt(state);
  expect(compact.inventorySummary).toMatchObject({size:36,occupiedStacks:36,heldItem:{slot:8,count:64}});
  expect(compact).toMatchObject({health:18,inventoryTransfer:{phase:'unknown',dispatched:true},navigation:{actionId:'original',phase:'running'}});
  expect('inventory' in compact).toBe(false);expect('actions' in compact).toBe(false);expect(JSON.stringify(compact).length).toBeLessThan(1500);
  expect(state).toEqual(before);expect(compactNativeActionReceipt({}).inventorySummary).toBeNull();
});
it('light body observations retain GUI/unknown action identities without repeating item lists or inventing absent inventory',()=>{
  const state={connected:true,generation:3,health:11,food:12,screenToken:'current',screenTitle:'Chest',selectedSlot:0,
    inventory:Array.from({length:41},(_,slot)=>({slot,count:64,name:'minecraft:stone',displayName:'s'.repeat(200),instanceHash:'a'.repeat(64)})),
    menuSlots:[{slot:0,count:1,name:'minecraft:torch'}],cursor:{empty:true},actions:[{id:'unknown-original',phase:'unknown',updatedAt:1}]};
  const body=compactNativeBody(state),full=compactNativeState(state);
  expect(body).toMatchObject({generation:3,health:11,screenToken:'current',inventorySummary:{size:41,occupiedStacks:41,heldItem:{slot:0}},
    menuSummary:{size:1,occupiedStacks:1},actions:[{id:'unknown-original',phase:'unknown'}],actionSummary:{unknown:1}});
  expect(body.inventory).toBeUndefined();expect(body.menuSlots).toBeUndefined();expect(JSON.stringify(body).length).toBeLessThan(JSON.stringify(full).length/3);
  expect(compactNativeBody({connected:false}).inventorySummary).toBeNull();expect(compactNativeBody({}).menuSummary).toBeNull();
});
it('keeps unresolved inventory exchange identity and confirmation boundaries in compact state',()=>{
  const result=compactNativeState({inventoryPick:'agent-mc-inventory-pick/v1',inventoryTransfer:{id:'original:1',actionId:'original',phase:'unknown',sourceSlot:30,dispatched:true,reason:'confirmation timed out',unboundedDetails:'x'.repeat(10000)},inventory:[{slot:30,count:23,name:'minecraft:wheat_seeds',instanceHash:'a'.repeat(64)}]});
  expect(result.inventoryTransfer).toEqual({id:'original:1',actionId:'original',phase:'unknown',sourceSlot:30,dispatched:true,reason:'confirmation timed out'});
  expect((result.inventory as any).occupied[0].instanceHash).toBe('a'.repeat(64));
  expect(JSON.stringify(result).length).toBeLessThan(1000);
});
it('bounds common state while retaining exact original revisions with digest and paginated access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-evidence-'));
  try {
    const archive = new NativeEvidenceArchive(dir), book = '原始书本正文'.repeat(20000), original = { connected: true, position: [1, 64, 2], inventory: [{ slot: 1, count: 1, name: 'minecraft:written_book', encoded: { pages: book } }], menuSlots: [], messages: [{ text: book }], actions: [] };
    const first = archive.save('same-action', original), second = archive.save('same-action', { ...original, position: [2, 64, 2] });
    expect(JSON.stringify(compactNativeState(original)).length).toBeLessThan(1500);
    expect(archive.read('same-action', undefined, 0, 100).sha256).toBe(second.sha256);
    let text = ''; for (let offset = 0; offset < first.originalChars; offset += 16000) text += archive.read('same-action', first.sha256, offset, 16000).text;
    expect(JSON.parse(text)).toEqual(original);
    expect(() => archive.read('same-action', '../outside')).toThrow('digest');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('pages the exact script report independently of a large original body snapshot',()=>{
  const dir=mkdtempSync(join(tmpdir(),'native-script-evidence-'));
  try {
    const archive=new NativeEvidenceArchive(dir),script={ok:true,result:{symbols:['player_position','getblocklist']},programReport:true};
    const original={evidence:{inventory:[{book:'large book'.repeat(50000)}],script}},ref=archive.save('program',original);
    const page=archive.read(ref.key,ref.sha256,0,8000,'script');
    expect(JSON.parse(page.text)).toEqual(script);expect(page.sha256).toBe(ref.sha256);expect(page.part).toBe('script');
    expect(page.originalChars).toBeGreaterThan(400000);expect(page.totalChars).toBeLessThan(300);
    const full=archive.read(ref.key,ref.sha256,0,40);expect(full.part).toBe('full');expect(full.text).toContain('inventory');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
it('aliases identical displayed inventory slots but preserves distinct container mappings and changes',()=>{
  const item={slot:0,count:4,name:'minecraft:stone',displayName:'Stone',encoded:{private:'full components'}};
  const state={inventory:[item,{slot:1,empty:true}],menuSlots:[{...item},...Array.from({length:8},(_,i)=>({slot:i+1,empty:true}))]};
  expect(compactNativeItems(state)).toEqual({inventory:{size:2,occupied:[{slot:0,count:4,name:'minecraft:stone',displayName:'Stone'}]},menuSlots:{size:9,occupiedFrom:'inventory.occupied'}});
  expect((compactNativeItems({...state,menuSlots:[{...item,slot:36}]}).menuSlots as any).occupied[0].slot).toBe(36);
  expect((compactNativeItems({...state,menuSlots:[{...item,count:3}]}).menuSlots as any).occupied[0].count).toBe(3);
  expect(compactNativeItems({inventory:[],menuSlots:[]}).menuSlots).toEqual({size:0,occupied:[]});
});
