import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import minecraftData from 'minecraft-data';
import { expect, it } from 'vitest';
import { ChestBook, CONTAINER_FIND } from '../core/chests.ts';
import { needsBareHandToInteract } from '../core/hand-interaction.ts';
import { LEDGER_GUARD_BLOCKS } from '../core/placed-ledger.ts';

it.each(['1.21.1','1.20.6'])('discovers and restores every registered shulker colour in %s', version => {
  const blocks = minecraftData(version).blocksArray.filter(block=>block.name.endsWith('shulker_box'));
  expect(blocks).toHaveLength(17);
  const dir=mkdtempSync(join(tmpdir(),'mc-shulker-')),file=join(dir,'containers.json');
  try {
    const book=new ChestBook(file);
    for(const [x,block] of blocks.entries()) {
      expect(CONTAINER_FIND).toContain(block.name);
      expect(needsBareHandToInteract(block.name,'custom_wand')).toBe(true);
      expect(LEDGER_GUARD_BLOCKS.has(block.name)).toBe(true);
      const position={x,y:64,z:0};
      book.rememberStation('overworld',position,block.name);
      book.remember('overworld',position,[{name:'oak_log',count:x+1}],1,27);
    }
    book.rememberStation('overworld',{x:99,y:64,z:0},'crafting_table');
    book.rememberStation('the_nether',{x:0,y:64,z:0},'purple_shulker_box');
    const restored=new ChestBook(file),containers=restored.chestsIn('overworld');
    expect(containers.map(c=>c.name).sort()).toEqual(blocks.map(b=>b.name).sort());
    expect(containers.every(c=>c.slots===27&&c.usedSlots===1&&typeof c.observedAt==='number')).toBe(true);
    expect(restored.itemSources('overworld','oak_log')).toHaveLength(blocks.length);
    expect(restored.tally('overworld').oak_log).toBe(153);
    expect(restored.chestsIn('the_nether').map(c=>c.name)).toEqual(['purple_shulker_box']);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
