import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from maw_bedrock_resources import sha
from maw_bedrock_visuals import Models, SceneAssets, selected_variant, book_geometry


class VisualAssetsTests(unittest.TestCase):
    def fixture(self, root):
        manifest={'assetIntegrityVerified':True,'assets':{}}
        def put(key,value):
            raw=value if isinstance(value,bytes) else json.dumps(value).encode()
            path=root/key;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            manifest['assets'][key]={'bytes':len(raw),'sha256':sha(raw),'source':'test.jar'}
            (root/'native-assets.json').write_text(json.dumps(manifest),'utf-8')
        def png(color=(20,40,60,255),size=(16,16)):
            out=io.BytesIO();Image.new('RGBA',size,color).save(out,'PNG');return out.getvalue()
        return manifest,put,png

    def test_java_implicit_uvs_preserve_native_cube_dimensions_and_atlas_texels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);_,put,png=self.fixture(root);put('assets/test/textures/block/a.png',png(size=(32,32)))
            models=Models(SceneAssets(root));geo,image=models.convert({'textures':{'a':'test:block/a'},'elements':[{'from':[0,0,0],'to':[16,16,16],'faces':{d:{'texture':'#a'} for d in ['up','down','north','south','east','west']}}]},'geometry.test')
            cube=geo['minecraft:geometry'][0]['bones'][2]['cubes'][0]
            self.assertEqual(cube['origin'],[-8,0,-8]);self.assertEqual(cube['size'],[16,16,16])
            self.assertEqual(cube['uv']['north'],{'uv':[0,0],'uv_size':[32,32]})
            self.assertEqual(Image.open(io.BytesIO(image)).tobytes(),Image.open(io.BytesIO(png(size=(32,32)))).tobytes())

    def test_element_pivot_state_rotation_and_face_uv_rotation_are_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);_,put,png=self.fixture(root);put('assets/test/textures/block/a.png',png())
            geo,_=Models(SceneAssets(root)).convert({'textures':{'a':'test:block/a'},'elements':[{'from':[2,4,6],'to':[6,10,12],'rotation':{'axis':'z','angle':45,'origin':[8,8,8]},'faces':{'east':{'texture':'#a','uv':[1,2,5,8],'rotation':90}}}]},'geometry.test',x=90,y=180)
            bones=geo['minecraft:geometry'][0]['bones'];self.assertEqual(bones[1]['rotation'],[90,-180,0]);self.assertEqual(bones[2]['pivot'],[0,8,0]);self.assertEqual(bones[2]['rotation'],[0,0,-45])
            self.assertEqual(bones[2]['cubes'][0]['uv']['west'],{'uv':[1,2],'uv_size':[4,6],'uv_rotation':90})

    def test_original_animated_strip_and_interpolation_follow_native_frame_times(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);_,put,_=self.fixture(root);sheet=Image.new('RGBA',(16,32),(0,0,0,255));sheet.paste((200,100,0,255),(0,16,16,32));raw=io.BytesIO();sheet.save(raw,'PNG')
            put('assets/test/textures/block/a.png',raw.getvalue());put('assets/test/textures/block/a.png.mcmeta',{'animation':{'frametime':2,'interpolate':True}})
            models=Models(SceneAssets(root));model={'textures':{'a':'test:block/a'},'elements':[{'from':[0,0,0],'to':[16,16,16],'faces':{'north':{'texture':'#a','uv':[0,0,16,16]}}}]}
            _,image=models.convert(model,'geometry.test');self.assertEqual(len(models.frames),4)
            self.assertEqual(Image.open(io.BytesIO(image)).getpixel((0,0)),(0,0,0,255))
            self.assertEqual(Image.open(io.BytesIO(models.frames[1])).getpixel((0,0)),(100,50,0,255));self.assertEqual(Image.open(io.BytesIO(models.frames[2])).getpixel((0,0)),(200,100,0,255))
            frames=list(models.frames);models.convert(model,'geometry.test');self.assertEqual(frames,models.frames)

    def test_unresolved_priority_and_hash_tampering_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);manifest,put,png=self.fixture(root);key='assets/test/textures/block/a.png';put(key,png())
            meta=manifest['assets'][key];meta['variants']=[{'source':'a.jar'},{'source':'b.jar'}];(root/'native-assets.json').write_text(json.dumps(manifest),'utf-8')
            with self.assertRaisesRegex(ValueError,'ambiguous'):SceneAssets(root).read(key)
            meta['variants']=[];(root/'native-assets.json').write_text(json.dumps(manifest),'utf-8');(root/key).write_bytes(png((1,2,3,255)))
            with self.assertRaisesRegex(ValueError,'hash'):SceneAssets(root).read(key)

    def test_explicit_one_mod_above_vanilla_priority_is_verified_and_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);manifest,put,png=self.fixture(root);key='assets/minecraft/textures/block/oak_planks.png';put(key,png())
            meta=manifest['assets'][key];meta.update({'source':'domum.jar','priorityResolution':'neoforge-21.1.248-mods-above-vanilla','overriddenSources':['minecraft-1.21.1-client.jar'],'variants':[{'source':'minecraft-1.21.1-client.jar','sha256':'old','bytes':1},{'source':'domum.jar','sha256':meta['sha256'],'bytes':meta['bytes']}]})
            (root/'native-assets.json').write_text(json.dumps(manifest),'utf-8');assets=SceneAssets(root);self.assertEqual(assets.read(key),png());self.assertEqual(assets.resolutions[key]['source'],'domum.jar')
            meta['variants'].append({'source':'other.jar'});(root/'native-assets.json').write_text(json.dumps(manifest),'utf-8')
            with self.assertRaisesRegex(ValueError,'ambiguous'):SceneAssets(root).read(key)

    def test_unknown_or_ambiguous_block_variants_do_not_guess_a_cube(self):
        value={'variants':{'facing=north':{'model':'test:a'},'facing=south':{'model':'test:b'}}}
        self.assertEqual(selected_variant(value,{'facing':'south'})['model'],'test:b')
        with self.assertRaisesRegex(ValueError,'ambiguous'):selected_variant(value,{'facing':'west'})
        value['variants']['']={'model':'test:c'}
        with self.assertRaisesRegex(ValueError,'ambiguous'):selected_variant(value,{'facing':'north'})

    def test_special_models_and_wrapped_uv_remain_explicitly_unsupported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);_,put,png=self.fixture(root);put('assets/test/textures/block/a.png',png());models=Models(SceneAssets(root))
            with self.assertRaisesRegex(ValueError,'no_bounded'):models.convert({'parent':'builtin/entity'},'geometry.test')
            model={'textures':{'a':'test:block/a'},'elements':[{'from':[0,0,0],'to':[16,16,16],'faces':{'north':{'texture':'#a','uv':[0,0,32,16]}}}]}
            with self.assertRaisesRegex(ValueError,'wrapped_uv'):models.convert(model,'geometry.test')

    def test_book_tiers_keep_original_descendants_and_do_not_mutate_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);_,put,_=self.fixture(root)
            bones=[{'name':'tier1','pivot':[0,0,0]},{'name':'child1','parent':'tier1','pivot':[1,2,3],'rotation':[0,30,0]},{'name':'tier2','pivot':[0,0,0]},{'name':'child2','parent':'tier2','pivot':[4,5,6]}]
            raw={'format_version':'1.12.0','minecraft:geometry':[{'description':{'identifier':'geometry.original','texture_width':128,'texture_height':128},'bones':bones}]}
            put('assets/ars_nouveau/geo/spellbook_open.geo.json',raw);before=copy.deepcopy(raw)
            geo=book_geometry(SceneAssets(root),1,'geometry.test');kept=geo['minecraft:geometry'][0]['bones']
            self.assertEqual([b['name'] for b in kept],['maw_item_root','tier1','child1']);self.assertEqual(kept[2],bones[1]);self.assertEqual(kept[1]['parent'],'maw_item_root');self.assertEqual(raw,before)

if __name__=='__main__':unittest.main()
