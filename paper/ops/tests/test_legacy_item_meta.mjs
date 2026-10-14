import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {migrateLegacyItems,prepareLegacyItemMigration} from '../migrate-legacy-item-meta.mjs';
const shield=()=>({'==':'org.bukkit.inventory.ItemStack',v:3839,type:'SHIELD',amount:1,meta:{'==':'ItemMeta','meta-type':'TILE_ENTITY',blockMaterial:'SHIELD','display-name':'{"text":"赤铜纹战盾"}',lore:['原故事'],'enchants':{'minecraft:mending':1,'minecraft:unbreaking':2},PublicBukkitValues:{'agentfriend:weapon':'shield'}}});
test('only legacy shield meta type changes; original name, enchants and custom fields survive',()=>{
 const source={items:[shield()]},copy=structuredClone(source),result=migrateLegacyItems(source);
 assert.deepEqual(source,copy);assert.equal(result.changes.length,1);assert.equal(result.value.items[0].meta['meta-type'],'SHIELD');assert.equal(result.value.items[0].v,3839);
 const expected=shield();expected.meta['meta-type']='SHIELD';delete expected.meta.blockMaterial;assert.deepEqual(result.value.items[0],expected);
 assert.equal(migrateLegacyItems(result.value).changes.length,0);
});
test('other block-state items and shared meta objects remain intact',()=>{
 const first=shield(),other={...first,type:'SHULKER_BOX'};other.meta=first.meta;
 const result=migrateLegacyItems([first,other]);assert.equal(result.value[0].meta['meta-type'],'SHIELD');assert.deepEqual(result.value[1],other);
});
test('ambiguous and opaque banner/block state stops instead of losing data',()=>{
 const first=shield();first.meta.blockMaterial='BANNER';assert.throws(()=>migrateLegacyItems(first),/AMBIGUOUS/);
 for(const key of ['internal','unhandled','blockState','BlockEntityTag']){const item=shield();item.meta[key]='original bytes';assert.throws(()=>migrateLegacyItems(item),/NATIVE_CONVERSION/);}
});
test('separate prepared JSON does not edit source; roots and overwrite are rejected',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-meta-test-')),server=path.join(root,'server'),output=path.join(root,'output');await fs.mkdir(path.join(server,'plugins','AgentFriend'),{recursive:true});
 const file=path.join(server,'plugins','AgentFriend','data.json'),bytes=JSON.stringify({items:[shield()]});await fs.writeFile(file,bytes);
 const result=await prepareLegacyItemMigration({serverRoot:server,outputRoot:output});assert.equal(result.legacyShields,1);assert.equal(await fs.readFile(file,'utf8'),bytes);
 const prepared=JSON.parse(await fs.readFile(path.join(output,result.files[0].source),'utf8'));assert.equal(prepared.items[0].meta['meta-type'],'SHIELD');
 await assert.rejects(prepareLegacyItemMigration({serverRoot:server,outputRoot:output}),/OUTPUT_EXISTS/);
 await assert.rejects(prepareLegacyItemMigration({serverRoot:server,outputRoot:server}),/ROOTS_OVERLAP/);
});
test('all candidates validate before prepared output is written',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-meta-test-')),server=path.join(root,'server'),output=path.join(root,'output');await fs.mkdir(path.join(server,'plugins'),{recursive:true});
 await fs.writeFile(path.join(server,'plugins','a.json'),JSON.stringify(shield()));const bad=shield();bad.meta.internal='opaque';await fs.writeFile(path.join(server,'plugins','b.json'),JSON.stringify(bad));
 await assert.rejects(prepareLegacyItemMigration({serverRoot:server,outputRoot:output}),/NATIVE_CONVERSION/);await assert.rejects(fs.stat(output),{code:'ENOENT'});
});
