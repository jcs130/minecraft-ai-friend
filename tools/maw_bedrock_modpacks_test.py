import copy
import datetime
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from PIL import Image
import maw_bedrock_modpacks as models


class ModelPackTests(unittest.TestCase):
    def fixture(self, root):
        assets = root/'assets'; assets.mkdir()
        manifest = {'assetIntegrityVerified': True, 'assets': {}, 'sources': [
            {'sha256': models.TLM_SHA}, {'sha256': models.YSM_SHA}]}
        def put(key, value):
            raw = value if isinstance(value, bytes) else json.dumps(value).encode()
            path = assets/key; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
            manifest['assets'][key] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        bones = [{'name': 'root', 'pivot': [0, 0, 0], 'cubes': [{'origin': [0, 1, 2], 'size': [0, 3, 4],
            'rotation': [0, 12, 0], 'inflate': .2, 'uv': {'north': {'uv': [1, 2], 'uv_size': [3, 4]}}}]}]
        geometry = {'format_version': '1.10.0', 'geometry.model': {'texturewidth': 16, 'textureheight': 16, 'bones': bones}}
        prefix = 'assets/touhou_little_maid/tlm_custom_pack/locked/assets/test/'
        put(prefix+'maid_model.json', {'model_list': [{'model_id': 'test:maid', 'extra_textures': ['test:textures/entity/other.png']}]})
        put(prefix+'models/entity/maid.json', geometry)
        png = io.BytesIO(); Image.new('RGBA', (16, 16), (70, 120, 210, 255)).save(png, 'PNG')
        for name in ['maid','other']: put(prefix+'textures/entity/'+name+'.png', png.getvalue())
        (assets/'native-assets.json').write_text(json.dumps(manifest),'utf-8')
        extension = root/'MawModels.jar'; extension.write_bytes(b'precompiled test fixture')
        geyser = root/'Geyser.jar'; geyser.write_bytes(b'pinned runtime fixture')
        return assets, extension, geyser, bones, png.getvalue()

    def test_conversion_preserves_zero_faces_per_face_uv_rotation_inflation_and_original_png(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); assets, extension, geyser, bones, png = self.fixture(root)
            out = root/'out'; contract = models.build(assets,out,extension=extension,geyser=geyser)
            rows = json.loads((out/models.CATALOG).read_bytes())['models']; self.assertEqual(len(rows),2)
            self.assertEqual(rows[1]['modelId'], 'test:maid_'+hashlib.md5(b'textures/entity/other.png').hexdigest())
            with zipfile.ZipFile(out/rows[0]['pack']) as z:
                self.assertTrue(all(len(name)<80 for name in z.namelist()))
                geo = json.loads(z.read(rows[0]['geometry']))['minecraft:geometry'][0]
                self.assertEqual(geo['bones'],bones); self.assertEqual(z.read(rows[0]['texture']),png)
            self.assertFalse(contract['actualBedrockVisualVerified'])
            self.assertFalse(rows[0]['javaAnimationControllersAdapted'])

    def test_reproducible_pack_and_deployed_integrity_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); assets, extension, geyser, *_ = self.fixture(root)
            a,b=root/'a',root/'b'
            contract=models.build(assets,a,extension=extension,geyser=geyser)
            models.build(assets,b,extension=extension,geyser=geyser)
            for file,meta in contract['files'].items():
                self.assertEqual((a/file).read_bytes(),(b/file).read_bytes())
                if meta['directory']:
                    (a/meta['directory']).mkdir(exist_ok=True);(a/file).rename(a/meta['directory']/file)
            self.assertEqual(models.validate(a,deployed=True)['modelCount'],2)
            (a/models.CATALOG).write_bytes(b'{}')
            with self.assertRaisesRegex(ValueError,'integrity mismatch'):models.validate(a,deployed=True)

    def test_resource_paths_and_conflicting_bones_cannot_be_silently_approximated(self):
        for path in ['../secret','/absolute','a\\b']:
            with self.assertRaises(ValueError):models.relative(path)
        malformed={'format_version':'1.12.0','minecraft:geometry':[{'description':{'texture_width':16,'texture_height':16},'bones':[{'name':'a'},{'name':'a'}]}]}
        with self.assertRaisesRegex(ValueError,'duplicate'):models.geometry(json.dumps(malformed).encode(),'geometry.test')

    def test_registration_and_download_stack_both_must_be_current_and_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'log';now=datetime.datetime.now();stamp=now.strftime('%Y-%m-%d %H:%M:%S,000')
            path.write_text(stamp+' INFO MAW_MODELS registered=2 ysmSkins=0\n'+stamp+' INFO MAW_MODELS packsLoaded=1\n')
            contract={'modelCount':2,'packs':[{}]}
            self.assertEqual(models.registered_models(path,contract,now.timestamp()-2)['packsLoaded'],1)
            with self.assertRaisesRegex(ValueError,'Stale'):models.registered_models(path,contract,now.timestamp()+2)
            with self.assertRaisesRegex(ValueError,'incomplete'):models.registered_models(path,{'modelCount':3,'packs':[{}]},now.timestamp()-2)


if __name__=='__main__':unittest.main()
