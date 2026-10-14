// Prepare separate plugin-data files before the first Paper 1.21.1 startup.
// CraftMetaBlockState(SHIELD) became CraftMetaShield: the old ItemMeta alias is
// rejected by ItemStack.setItemMeta, silently discarding name/lore/enchantments.
// Native world/player/Minepacks NBT is handled by Minecraft's own DataFixer.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function migrateLegacyItems(input) {
  const value=structuredClone(input), changes=[], seen=new WeakSet();
  function visit(node,at=[]) {
    if(!node||typeof node!=='object'||seen.has(node))return;
    seen.add(node);
    if(node['==']==='org.bukkit.inventory.ItemStack'&&node.type==='SHIELD'&&node.meta?.['meta-type']==='TILE_ENTITY') {
      if(node.meta.blockMaterial!=='SHIELD')throw Error('LEGACY_SHIELD_TYPE_AMBIGUOUS: '+at.join('.'));
      // No existing installed shield uses opaque block-state/banner data.
      // Stop before changing any live file if a future one does; never lose it.
      if(['internal','unhandled','blockState','block-state','BlockEntityTag'].some(k=>node.meta[k]!=null))
        throw Error('LEGACY_SHIELD_BLOCK_STATE_REQUIRES_NATIVE_CONVERSION: '+at.join('.'));
      node.meta={...node.meta,'meta-type':'SHIELD'};delete node.meta.blockMaterial;
      changes.push(at.concat('meta'));
    }
    for(const [key,child]of Object.entries(node))visit(child,at.concat(key));
  }
  visit(value);return {value,changes};
}
const sha=b=>createHash('sha256').update(b).digest('hex');
const inside=(root,file)=>file.startsWith(root+path.sep);
export async function prepareLegacyItemMigration({serverRoot,outputRoot,yaml}) {
  const server=path.resolve(serverRoot),output=path.resolve(outputRoot);
  if(output===server||inside(server,output)||inside(output,server))throw Error('MIGRATION_ROOTS_OVERLAP');
  try{await fs.lstat(output);throw Error('MIGRATION_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  const pending=[];
  async function scan(dir) {
    for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
      if(entry.name.startsWith('.')||['cache','logs','lib','libs','node_modules'].includes(entry.name))continue;
      const file=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw Error('MIGRATION_SYMLINK_UNSUPPORTED');
      if(entry.isDirectory()){await scan(file);continue;}
      if(!entry.isFile()||!entry.name.match(/\.(?:yml|yaml|json)$/i))continue;
      const original=await fs.readFile(file),text=original.toString('utf8');
      if(!text.includes('TILE_ENTITY')||!text.includes('SHIELD'))continue;
      if(original.length>16*1024*1024)throw Error('MIGRATION_DATA_BUDGET_EXCEEDED');
      const isJson=entry.name.endsWith('.json');
      const converted=migrateLegacyItems(isJson?JSON.parse(text):yaml.load(text));
      if(!converted.changes.length)continue;
      const bytes=Buffer.from(isJson?JSON.stringify(converted.value,null,2)+'\n':yaml.dump(converted.value,{lineWidth:140,noRefs:false}));
      const relative=path.relative(server,file).split(path.sep).join('/');
      pending.push({relative,bytes,beforeSha256:sha(original),sha256:sha(bytes),changes:converted.changes});
    }
  }
  await scan(path.join(server,'plugins'));
  // All candidates validate before writing even the separate prepared output.
  await fs.mkdir(output,{recursive:true});
  for(const row of pending){const file=path.join(output,row.relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,row.bytes,{flag:'wx'});}
  return {schema:1,sourceUnmodified:true,legacyShields:pending.reduce((n,r)=>n+r.changes.length,0),
    files:pending.map(({relative,beforeSha256,sha256,changes})=>({target:relative,source:relative,beforeSha256,sha256,changes}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);const get=k=>args[args.indexOf(k)+1];
  for(const key of ['--server','--output','--report','--yaml-root'])if(!args.includes(key))throw Error('Usage: --server <stopped copy> --output <fresh dir> --report <new json> --yaml-root <js-yaml package root>');
  const yaml=createRequire(path.join(path.resolve(get('--yaml-root')),'package.json'))('js-yaml');
  const report=await prepareLegacyItemMigration({serverRoot:get('--server'),outputRoot:get('--output'),yaml});
  await fs.writeFile(get('--report'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({legacyShields:report.legacyShields,files:report.files.length,sourceUnmodified:true}));
}
