'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync } = require('node:child_process')

test('item stacks map once and item cooldowns use the same vanilla identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-idmap-'))
  try {
    const map = path.join(root, 'map.json')
    fs.writeFileSync(map, JSON.stringify({ states: {79334:100}, items: { 3272: 340, 340: 2 } }))
    const script = `
      const assert=require('node:assert/strict'),r=require(${JSON.stringify(path.join(__dirname, 'idmap-remap.cjs'))});r.load();
      const stack=()=>({itemCount:1,itemId:3272,components:[]});
      for(const [name,packet,get] of [
        ['set_slot',{item:stack()},p=>p.item.itemId],
        ['window_items',{items:[stack()]},p=>p.items[0].itemId],
        ['entity_equipment',{equipments:[{item:stack()}]},p=>p.equipments[0].item.itemId],
        ['container_set_content',{itemsWithSlots:[{itemStack:stack()}]},p=>p.itemsWithSlots[0].itemStack.itemId],
        ['set_cooldown',{itemID:3272,cooldownTicks:20},p=>p.itemID]
      ])assert.equal(get(r.remapOut(name,packet)),340,name);
      assert.equal(r.remapOut('world_event',{effectId:2001,data:79334}).data,100);
      assert.equal(r.remapOut('world_event',{effectId:2002,data:79334}).data,79334);
      assert.equal(r.remapOut('world_particles',{particle:{type:'block',data:79334}}).particle.data,100);
    `
    execFileSync(process.execPath, ['-e', script], { env: { ...process.env, GATE_IDMAP_FILE: map, GATE_REMAP: '1' } })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
