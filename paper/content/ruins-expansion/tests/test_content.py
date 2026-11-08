import copy,importlib.util,io,unittest,tempfile,struct,zlib
from pathlib import Path
import nbtlib
from nbtlib import Compound,List,Int,String

HERE=Path(__file__).resolve().parents[1]
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
b=module('ruins_build','build.py');merge_module=module('ruins_merge','prepare_overlay.py')
freeze=module('ruins_regions','prepare_regions.py')

class Content(unittest.TestCase):
 def test_entities_and_container_payloads_removed(self):
  data=nbtlib.File({'size':List[Int]([1,2,1]),'palette':List[Compound]([b.state('minecraft:chest')]),'blocks':List[Compound]([Compound({'state':Int(0),'pos':List[Int]([0,0,0]),'nbt':Compound({'LootTable':String('evil:loot')})})]),'entities':List[Compound]([Compound({'id':String('minecraft:command_block_minecart')})])})
  clean,stats=b.sanitize(data);self.assertFalse(clean['entities']);self.assertNotIn('nbt',clean['blocks'][0]);self.assertEqual(stats['removed_entities'],1)
 def test_connector_final_state_not_executed(self):
  data=nbtlib.File({'size':List[Int]([1,1,1]),'palette':List[Compound]([b.state('minecraft:jigsaw')]),'blocks':List[Compound]([Compound({'state':Int(0),'pos':List[Int]([0,0,0]),'nbt':Compound({'final_state':String('minecraft:command_block')})})])})
  clean,_=b.sanitize(data);self.assertEqual(str(clean['palette'][0]['Name']),'minecraft:air')
 def test_water_is_not_a_dry_walk_node(self):
  vox={(0,0,0):'minecraft:stone',(0,1,0):'minecraft:water'};collision={(0,0,0):[[0,0,0,1,1,1]],(0,1,0):[]}
  self.assertNotIn((0,1,0),b.walk_nodes(vox,collision))
 def test_half_slab_retains_half_coordinate(self):
  self.assertIn((0,.5,0),b.walk_nodes({(0,0,0):'minecraft:oak_slab'},{(0,0,0):[[0,0,0,1,.5,1]]}))
 def test_grass_and_snow_blocks_are_real_solid_floors(self):
  for name in ['minecraft:grass_block','minecraft:snow_block']:
   self.assertTrue(b.supported(name));self.assertIn((0,1,0),b.walk_nodes({(0,0,0):name},{(0,0,0):[[0,0,0,1,1,1]]}))
 def test_partial_snow_layer_is_not_a_full_cube_floor(self):
  self.assertFalse(b.supported('minecraft:snow'))
 def test_no_unknown_block_shape_fallback(self):
  data=nbtlib.File({'size':List[Int]([1,1,1]),'palette':List[Compound]([b.state('unknown:ore')]),'blocks':List[Compound]([Compound({'state':Int(0),'pos':List[Int]([0,0,0])})])})
  with self.assertRaisesRegex(ValueError,'unknown_1_21_1_blocks'):b.select_rooms(data,shapes={})
 def test_legacy_grass_has_explicit_migration(self):
  data=nbtlib.File({'size':List[Int]([1,1,1]),'palette':List[Compound]([b.state('minecraft:grass')]),'blocks':List[Compound]([Compound({'state':Int(0),'pos':List[Int]([0,0,0])})])})
  clean,stats=b.sanitize(data);self.assertEqual(str(clean['palette'][0]['Name']),'minecraft:short_grass');self.assertEqual(stats['renamed_legacy_grass'],1)
 def test_merge_preserves_original_sites_and_unrelated_fields(self):
  old={'schema-version':1,'extra':{'keep':True},'sites':{'old':{'rooms':[{'name':'original'}]}}};before=copy.deepcopy(old)
  merged=merge_module.merge(old,{'schema-version':1,'sites':{'new':{'rooms':[]}}})
  self.assertEqual(old,before);self.assertEqual(merged['sites']['old'],before['sites']['old']);self.assertEqual(merged['extra'],before['extra'])
 def test_duplicate_identity_is_never_overwritten(self):
  with self.assertRaisesRegex(ValueError,'id_conflict'):merge_module.merge({'schema-version':1,'sites':{'x':1}},{'schema-version':1,'sites':{'x':2}})
 def test_16_site_limit_is_not_bypassed(self):
  with self.assertRaisesRegex(ValueError,'limit_16'):merge_module.merge({'schema-version':1,'sites':{str(i):{}for i in range(16)}},{'schema-version':1,'sites':{'new':{}}})
 def test_any_existing_region_entity_or_poi_blocks_install_plan(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);(root/'entities').mkdir();(root/'entities/r.16.16.mca').touch()
   result=merge_module.preflight(root,{'sites':[{'bounds':[8192,64,8192,8200,90,8200]}]})
   self.assertFalse(result['canPrepare']);self.assertEqual(result['conflicts'],['entities/r.16.16.mca'])
 def test_negative_region_floor_division(self):self.assertEqual(merge_module.regions([-1,0,-1,0,10,0]),{'r.-1.-1.mca','r.-1.0.mca','r.0.-1.mca','r.0.0.mca'})
 def test_disconnected_route_is_not_fabricated(self):
  with self.assertRaisesRegex(ValueError,'unreachable_room'):b.route((0,1,0),(4,1,0),{(0,1,0),(4,1,0)})
 def test_authored_routes_keep_real_floor_and_headroom_between_stacked_rooms(self):
  data=nbtlib.File({'size':List[Int]([32,24,32]),'palette':List[Compound]([b.state('minecraft:air')]),'blocks':List[Compound]([]),'entities':List[Compound]([])})
  original=[(3,3,3),(24,10,23),(6,8,25)];site={'id':'frost_keep','origin':[8000,72,8000]}
  result,centres,spawns,routes,shifted=b.author_routes(data,original,site)
  states={tuple(map(int,x['pos'])):str(result['palette'][int(x['state'])]['Name'])for x in result['blocks']}
  for route in routes:
   for x,y,z in route:
    self.assertNotIn(states[(x,y-1,z)],b.AIR|b.HAZARD|{'minecraft:water'})
    for dy in range(3):self.assertIn(states[(x,y+dy,z)],b.AIR)
  for old,new in zip(original,centres):self.assertEqual([a+c for a,c in zip(old,site['origin'])],[a+c for a,c in zip(new,shifted['origin'])])
  self.assertTrue(all(len(points)>=8 for points in spawns))
 def region_fixture(self):
  raw=bytearray(8192)
  for index,x in enumerate([0,1]):
   nbt=nbtlib.File({'DataVersion':Int(3955),'xPos':Int(x),'zPos':Int(0),'Status':String('minecraft:full'),'block_entities':List[Compound]([])});stream=io.BytesIO();nbt.write(stream);compressed=zlib.compress(stream.getvalue());record=struct.pack('>I',len(compressed)+1)+b'\2'+compressed
   struct.pack_into('>I',raw,index*4,((index+2)<<8)|1);raw.extend(record+b'\0'*(4096-len(record)))
  return bytes(raw)
 def test_only_authored_chunk_is_retained(self):
  out=freeze.compact_region(self.region_fixture(),{(1,0)});self.assertEqual(len(out),12288);self.assertEqual(struct.unpack_from('>I',out,0)[0],0);self.assertEqual(struct.unpack_from('>I',out,4)[0],(2<<8)|1)
 def test_missing_requested_chunk_is_unknown_not_air(self):
  with self.assertRaisesRegex(ValueError,'missing_or_invalid'):freeze.compact_region(self.region_fixture(),{(2,0)})
 def test_region_slot_must_match_absolute_chunk(self):
  with self.assertRaisesRegex(ValueError,'coordinate_mismatch'):freeze.compact_region(self.region_fixture(),{(33,0)})

if __name__=='__main__':unittest.main()
