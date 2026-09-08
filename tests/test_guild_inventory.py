import json
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'world/sidecar'))
from guild_inventory import snapshot,count_item

UUID='00000000-0000-0000-0000-000000000001'
class Fake:
    def __init__(self):
        self.items={i:('minecraft:dirt',64) for i in range(9,45)}
        self.corrupt=None
        self.calls=[]
        self.count='Found 4 matching item(s) on player Kirito'
    def cmd(self,command):
        self.calls.append(command)
        if command.startswith('data get'): return 'Kirito has the following entity data: [I;0,0,0,1]'
        if command.startswith('clear'): return self.count
        offset=int(command.rsplit(' ',1)[1]); end=min(46,offset+12)
        rows=[]
        for i in range(offset,end):
            item,count=self.items.get(i,('minecraft:air',0))
            rows.append(dict(index=i,playerSide=i>=5,id=item,count=count,output=False))
        value=dict(schema=1,capability='physical_menu_v1',ok=True,actorUuid=UUID,menu='InventoryMenu',
                   cursorEmpty=True,stillValid=True,slotCount=46,offset=offset,slots=rows,
                   epoch=UUID,dimension='minecraft:overworld',containerId=0,nextOffset=end if end<46 else -1)
        if self.corrupt: self.corrupt(value)
        return 'QD_WORLD_JSON '+json.dumps(value)
class InventoryTests(unittest.TestCase):
    def setUp(self): self.r=Fake(); self.npc=SimpleNamespace(R=self.r)
    def test_empty_armor_and_offhand_are_not_spare_backpack_slots(self):
        result=snapshot(self.npc,'Kirito')
        self.assertEqual(result['freeSlots'],0); self.assertEqual(result['emeraldCapacity'],0)
        self.assertEqual(result['counts'],{'minecraft:dirt':2304})
        self.assertTrue(all(c.startswith(('data get','qdworld gui')) for c in self.r.calls))
    def test_only_empty_slots_prove_reward_room_without_component_identity(self):
        self.r.items[9]=('minecraft:air',0); self.r.items[44]=('minecraft:emerald',60)
        value=snapshot(self.npc,'Kirito')
        self.assertEqual(value['emeraldCapacity'],64); self.assertEqual(value['freeSlots'],1)
        self.r.items[9]=('minecraft:emerald',1)
        self.assertEqual(snapshot(self.npc,'Kirito')['emeraldCapacity'],0)
    def test_wrong_body_menu_and_changing_epoch_fail_closed(self):
        changes=[lambda d:d.update(actorUuid='00000000-0000-0000-0000-000000000002'),
                 lambda d:d.update(menu='ChestMenu'), lambda d:d.update(cursorEmpty=False),
                 lambda d:d.update(epoch='00000000-0000-0000-0000-000000000002') if d['offset'] else None,
                 lambda d:d.update(nextOffset=-1), lambda d:d['slots'].pop()]
        for change in changes:
            self.r.corrupt=change
            with self.assertRaises(ValueError): snapshot(self.npc,'Kirito')
    def test_slot_identity_and_bool_count_are_rejected(self):
        self.r.items[9]=('minecraft:emerald',True)
        with self.assertRaises(ValueError): snapshot(self.npc,'Kirito')
    def test_count_readonly_actual_language_and_no_items(self):
        self.assertEqual(count_item(self.npc,'Kirito','minecraft:bread'),4)
        self.assertEqual(self.r.calls[-1],'clear Kirito minecraft:bread 0')
        self.r.count='No items were found on player Kirito'
        self.assertEqual(count_item(self.npc,'Kirito','minecraft:bread'),0)
        self.r.count='Found 4 matching item(s) on player AnotherPlayer'
        with self.assertRaises(ValueError): count_item(self.npc,'Kirito','minecraft:bread')
    def test_raw_selector_and_commands_are_not_inventory_names(self):
        with self.assertRaises(ValueError): snapshot(self.npc,'@a')
        with self.assertRaises(ValueError): count_item(self.npc,'Kirito','minecraft:bread 3')
        self.assertEqual(self.r.calls,[])

if __name__=='__main__': unittest.main()
