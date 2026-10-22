from pathlib import Path
import hashlib,json,tempfile,unittest
from prepare_fom_bedrock import reused_asset_manifest

class ReusedNativeAssetsTest(unittest.TestCase):
    def test_standard_exporter_sources_bind_actual_jars_without_sibling_bridge_metadata(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);jar=root/'twilightforest.jar';jar.write_bytes(b'locked original')
            source={'name':jar.name,'sha256':hashlib.sha256(jar.read_bytes()).hexdigest()}
            manifest={'assetIntegrityVerified':True,'sources':[source,{'name':'platform.jar','sha256':'a'*64}],'assets':{}}
            p=root/'native-assets.json';p.write_text(json.dumps(manifest))
            self.assertEqual(reused_asset_manifest(root,[jar]),{})
            jar.write_bytes(b'updated mod, stale textures')
            with self.assertRaisesRegex(ValueError,'different exact mod set'):reused_asset_manifest(root,[jar])
            jar.write_bytes(b'locked original');manifest['sources'].append(source);p.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'different exact mod set'):reused_asset_manifest(root,[jar])
            manifest['sources']=[source];manifest['assetIntegrityVerified']=False;p.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'Unverified'):reused_asset_manifest(root,[jar])

if __name__=='__main__':unittest.main()
