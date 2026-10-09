"""SDK artifact readiness must not claim fake-player/gameplay support."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile
from tools import maw_native_sdk_health as health

class NativeSdkHealthTests(unittest.TestCase):
    def test_exact_bundle_compiled_bridge_and_fresh_owner_then_component_tamper(self):
        with tempfile.TemporaryDirectory(prefix='maw-sdk-health-') as temporary:
            root = Path(temporary); directory = root/'integrations/native-sdk/test'
            directory.mkdir(parents=True)
            catalog = {'operations': [{'id':f'op.{i}','parameters':{'type':'object'},'permission':'self','execution':'read','returns':'receipt'} for i in range(70)],
                       'numenFakePlayerControl':False,'numenRestoreExisting':False}
            (directory/'operations.json').write_text(json.dumps(catalog),encoding='utf-8')
            manifest = {'directory':str(directory),'operationCount':70,'files':{'operations.json':hashlib.sha256((directory/'operations.json').read_bytes()).hexdigest()}}
            (directory.parent/'installation.json').write_text(json.dumps(manifest),encoding='utf-8')
            jar = root/'server/mods/maw_agent_bridge-0.1.0.jar'; jar.parent.mkdir(parents=True)
            with zipfile.ZipFile(jar,'w') as archive: archive.writestr('dev/qiandeng/maw/PlayerBodyState.class',b'test-only')
            record = root/'build/society-bridge/build-record.json'; record.parent.mkdir(parents=True)
            record.write_text(json.dumps({'sha256':hashlib.sha256(jar.read_bytes()).hexdigest()}),encoding='utf-8')
            owner = {'healthy':True,'heartbeatEpoch':time.time(),'services':[{'id':'gate','port':28977,'ready':True}]}
            def probe():
                with patch.object(health,'urlopen',return_value=io.BytesIO(json.dumps(owner).encode())): return health.probe(root)
            self.assertTrue(probe()['ok'])
            catalog['numenRestoreExisting'] = True
            (directory/'operations.json').write_text(json.dumps(catalog),encoding='utf-8')
            value = probe(); self.assertFalse(value['ok']); self.assertFalse(value['checks']['exact-bundle-files']); self.assertFalse(value['checks']['no-fake-player-claim'])

    def test_missing_manifest_is_explicitly_unavailable(self):
        with tempfile.TemporaryDirectory(prefix='maw-sdk-unavailable-') as temporary:
            value = health.probe(Path(temporary))
            self.assertFalse(value['ok']); self.assertIn('error',value); self.assertEqual(value['worldActions'],0)

if __name__ == '__main__': unittest.main()
