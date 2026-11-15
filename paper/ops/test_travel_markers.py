import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('markers',Path(__file__).with_name('plan-travel-markers.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def point(id='village',x=.5,y=65,z=.5):return dict(id=id,kind='public',name='初始村庄',worldName='world',x=x,y=y,z=z)
def flat(world,x,y,z):return 'minecraft:stone' if y<=64 else 'minecraft:air'

class MarkerRules(unittest.TestCase):
    def test_native_marker_and_real_reading_location(self):
        out=m.plan([point()],flat);self.assertEqual(out['blocked'],[])
        g=out['markers'][0]['geometry'];self.assertEqual(sum(c['after']=='minecraft:iron_block' for c in g['changes']),9)
        self.assertTrue(any(c['after']=='minecraft:beacon' for c in g['changes']))
        self.assertTrue(any(c['after'].startswith('minecraft:oak_wall_sign') for c in g['changes']))
        self.assertEqual(g['reader'][1],65)
    def test_all_arrival_spaces_are_reserved_before_planning(self):
        points=[point(),point('other',-2.5,65,.5)];out=m.plan(points,flat)
        for marker in out['markers']:
            for change in marker['geometry']['changes']:
                x,y,z=change['position']
                for p in points:self.assertFalse(x==int(p['x']//1) and z==int(p['z']//1))
    def test_duplicate_coordinates_coalesce(self):
        out=m.plan([point(),point('same')],flat);self.assertEqual(len(out['markers']),1);self.assertEqual(out['markers'][0]['aliases'],['same'])
    def test_containers_and_ore_never_replaceable(self):
        for block in ('minecraft:chest[facing=north,type=single,waterlogged=false]','minecraft:diamond_ore','minecraft:redstone_wire[power=0]'):
            out=m.plan([point()],lambda w,x,y,z:block if y<=64 else 'minecraft:air');self.assertFalse(out['markers']);self.assertEqual(len(out['blocked']),1)
    def test_existing_roofs_remain(self):
        def cave(w,x,y,z):return 'minecraft:stone' if y<=64 or y>=67 else 'minecraft:air'
        marker=m.plan([point()],cave)['markers'][0]
        self.assertTrue(all(c['position'][1]<67 for c in marker['geometry']['changes']))
        self.assertEqual(marker['geometry']['beam'],'open_sky_required_do_not_remove_roof')
    def test_fractional_slab_access(self):
        def slabs(w,x,y,z):return 'minecraft:sandstone_slab[type=bottom,waterlogged=false]' if y==64 else 'minecraft:stone' if y<64 else 'minecraft:air'
        marker=m.plan([point(y=64.5)],slabs)['markers'][0];self.assertEqual(marker['geometry']['reader'][1],64.5)
    def test_missing_world_not_silently_main_world(self):
        p=point();p['worldName']='';self.assertEqual(m.plan([p],flat)['blocked'][0]['reason'],'missing_verified_location')
    def test_personal_marker_does_not_publish_a_teleport_grant(self):
        p=point();p.update(kind='personal',owner='original-owner',name='我的家')
        marker=m.plan([p],flat)['markers'][0]
        self.assertEqual(marker['clickCommand'],'/mycli waypoint menu');self.assertEqual(marker['owner'],'original-owner')
        self.assertNotIn('share',marker);self.assertIn('玩家自定',marker['usage'])
    def test_compact_light_is_explicit_and_does_not_promise_beacon_buff(self):
        p=point();p['compactPreferred']=True
        geometry=m.choose(p,flat,set())
        self.assertEqual(sum(c['after']=='minecraft:iron_block' for c in geometry['changes']),1)
        self.assertEqual(geometry['beam'],'compact_light_marker_no_buff')
    def test_rejected_geometry_does_not_reserve_cells(self):
        reserved=set()
        self.assertIsNone(m.choose(point(),flat,reserved,accept=lambda geometry:False))
        self.assertEqual(reserved,set())
    def test_headroom_before_images_are_retained_even_if_already_air(self):
        geometry=m.choose(point(),flat,set())
        self.assertEqual(sum(c['before']==c['after']=='minecraft:air' for c in geometry['changes']),2)

if __name__=='__main__':unittest.main()
