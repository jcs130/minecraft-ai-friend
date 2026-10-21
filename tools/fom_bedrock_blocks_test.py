import io,json,tempfile,unittest,zipfile
from pathlib import Path
from PIL import Image
import fom_bedrock_blocks as b
import fom_bedrock_block_contract as contract

class NativeBlocksTests(unittest.TestCase):
    def fixture(self,root,*,animated=False):
        assets=root/'assets';assets.mkdir();manifest={}
        def put(name,value):
            raw=value if isinstance(value,bytes) else b.encoded(value);p=assets/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);manifest[name]={'bytes':len(raw),'sha256':b.sha(raw)}
        im=Image.new('RGBA',(16,32 if animated else 16),(255,0,0,255))
        if animated:im.paste((0,0,255,255),(0,16,16,32))
        stream=io.BytesIO();im.save(stream,'PNG');put('assets/test/textures/block/cube.png',stream.getvalue())
        if animated:put('assets/test/textures/block/cube.png.mcmeta',{'animation':{'frametime':2}})
        put('assets/test/models/block/cube.json',{'textures':{'all':'test:block/cube'},'elements':[{'from':[0,0,0],'to':[16,16,16],'faces':{face:{'texture':'#all'} for face in ['up','down','north','south','east','west']}}]})
        put('assets/test/blockstates/cube.json',{'variants':{'':{'model':'test:block/cube'}}})
        (assets/'native-assets.json').write_bytes(b.encoded({'assetIntegrityVerified':True,'assets':manifest}))
        state={'stateId':50000,'name':'test:cube','properties':{},'renderShape':'MODEL','hasBlockEntity':False,'dynamicShape':False,'hasOffsetFunction':False,'canOcclude':True,'solid':True}
        shape={'stateId':50000,'name':'test:cube','properties':{},'context':'native_empty_block_getter','collisionBoxes':[[0,0,0,1,1,1]],'selectionBoxes':[[0,0,0,1,1,1]],'hardness':1.5,'friction':0.6,'canBreakWithHand':False,'lightEmission':0}
        states=root/'states.jsonl';states.write_bytes(b.encoded(state));shapes=root/'shapes.jsonl';shapes.write_bytes(b.encoded(shape));extension=root/'test.jar';extension.write_bytes(b'test-only')
        return assets,states,shapes,extension,state,shape

    def test_native_state_identity_original_pixels_and_contract_tamper(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);assets,states,shapes,extension,_,_=self.fixture(root);out=root/'output'
            result=b.build(assets,states,shapes,out,extension=extension);self.assertEqual(result['mappedStates'],1);self.assertEqual(result['mappedBlocks'],1)
            c=contract.validate(out);catalog=json.loads((out/b.CATALOG).read_bytes());r=catalog['states'][0];v=catalog['blocks'][0]['variants'][0]
            self.assertEqual(r['nativeId'],50000);self.assertEqual(r['javaId'],115536);self.assertEqual(v['friction'],0.4);self.assertTrue(catalog['blocks'][0]['identifier'].split(':')[1].startswith('b_'))
            with zipfile.ZipFile(out/b.PACK) as z:
                atlas=json.loads(z.read('textures/terrain_texture.json'));path=atlas['texture_data'][v['texture']]['textures']+'.png';im=Image.open(io.BytesIO(z.read(path)));self.assertEqual(im.getpixel((0,0)),(255,0,0,255))
            (out/b.CATALOG).write_bytes(b'{}')
            with self.assertRaisesRegex(ValueError,'hash_mismatch'):contract.validate(out)

    def test_native_animation_keeps_frame_order_and_tick_durations(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);assets,states,shapes,extension,_,_=self.fixture(root,animated=True);out=root/'output'
            result=b.build(assets,states,shapes,out,extension=extension);self.assertEqual(result['animatedTextures'],1)
            with zipfile.ZipFile(out/b.PACK) as z:
                flip=json.loads(z.read('textures/flipbook_textures.json'))[0];self.assertEqual(flip['ticks_per_frame'],1);im=Image.open(io.BytesIO(z.read(flip['flipbook_texture']+'.png')))
                self.assertEqual(im.size,(16,64));self.assertEqual([im.getpixel((0,i*16)) for i in range(4)],[(255,0,0,255)]*2+[(0,0,255,255)]*2)

    def test_outside_collision_is_excluded_without_clamping(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);assets,states,shapes,extension,_,shape=self.fixture(root);shape['collisionBoxes']=[[0,0,0,1,1.5,1]];shapes.write_bytes(b.encoded(shape));out=root/'output'
            result=b.build(assets,states,shapes,out,extension=extension);self.assertEqual(result['mappedStates'],0);self.assertEqual(result['remainingReasons']['shape_outside_bedrock_bounds'],1)

    def test_multipart_uses_actual_properties_and_preserves_all_matching_parts(self):
        document={'multipart':[{'apply':{'model':'test:base'}},{'when':{'OR':[{'facing':'north|south'},{'open':'true'}]},'apply':{'model':'test:side'}}]}
        self.assertEqual(len(b.selected(document,{'facing':'east','open':'false'})),1)
        self.assertEqual(len(b.selected(document,{'facing':'south','open':'false'})),2)
        with self.assertRaisesRegex(ValueError,'weighted_variant'):b.selected({'variants':{'':[{'model':'a'},{'model':'b'}]}},{})
        with self.assertRaisesRegex(ValueError,'uvlock'):b.selected({'variants':{'':{'model':'a','x':90,'uvlock':True}}},{})

    def test_shape_export_from_other_state_is_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);assets,states,shapes,extension,_,shape=self.fixture(root);shape['name']='test:other';shapes.write_bytes(b.encoded(shape));out=root/'output'
            result=b.build(assets,states,shapes,out,extension=extension);self.assertEqual(result['mappedStates'],0);self.assertIn('native_shape_identity_mismatch',result['remainingReasons'])

    def test_block_item_requires_identical_mesh_and_preserves_world_variant(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);assets,states,shapes,extension,_,_=self.fixture(root)
            manifest=json.loads((assets/'native-assets.json').read_bytes())
            for key,value in {'assets/minecraft/models/block/block.json':{},'assets/test/models/item/cube.json':{'parent':'test:block/cube'}}.items():
                raw=b.encoded(value);p=assets/key;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);manifest['assets'][key]={'bytes':len(raw),'sha256':b.sha(raw)}
            (assets/'native-assets.json').write_bytes(b.encoded(manifest));out=root/'world';b.build(assets,states,shapes,out,extension=extension)
            items=root/'items.tsv';items.write_text('minecraft:stone\t1\ntest:cube\t50000\n',encoding='utf-8')
            idmap=root/'idmap.json';idmap.write_bytes(b.encoded({'items':{'50000':1},'reverseVanillaItems':{'1':1}}));projection=root/'projection.json';projection.write_bytes(b.encoded({'items':[{'nativeItem':'test:cube','displayName':'测试方块'}]}))
            target=root/'combined';result=b.add_block_items(out,target,assets,items,idmap,projection,extension);self.assertEqual(result['count'],1)
            catalog=json.loads((target/b.CATALOG).read_bytes());self.assertEqual(catalog['blockItems'][0]['customModelData'],8050000);self.assertEqual(catalog['blockItems'][0]['block'],catalog['states'][0]['block']);self.assertEqual(catalog['states'][0]['variant'],0)
            self.assertEqual(contract.validate(target)['blockItemCount'],1)

if __name__=='__main__':unittest.main()
