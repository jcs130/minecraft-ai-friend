"""Credential/config isolation tests; no real credentials, model calls, or world mutations."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch
import maw_numen_server as service

class PrivateConfigurationTests(unittest.TestCase):
    def test_configuration_keeps_http_loopback_and_reuses_existing_lan_gateway(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);result=service.initialize(root)
            config=json.loads((root/'server/config/maw-numen-server.json').read_text())
            self.assertEqual(config['bind'],'127.0.0.1');self.assertEqual(result['newPublicPorts'],0)
            self.assertEqual(config['publicEndpoint'],'http://192.168.3.163:28984/numen/mcp')
            self.assertNotIn('testOnlyAllowLoopbackModels',config)
            a=json.loads((root/'server/config/maw-numen-private/bridge.json').read_text())
            b=json.loads((root/'bedrock/plugins/Geyser/maw-agents-private.json').read_text())
            self.assertEqual(a['secret'],b['secret']);self.assertEqual(len(a['secret']),64)
            self.assertNotIn(a['secret'],json.dumps(result));self.assertNotIn(a['secret'],json.dumps(config))

    def test_existing_private_bridge_is_never_replaced_by_initialization(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bridge=root/'bedrock/plugins/Geyser/maw-agents-private.json';bridge.parent.mkdir(parents=True);bridge.write_text('original private bytes')
            with self.assertRaises(ValueError):service.initialize(root)
            self.assertEqual(bridge.read_text(),'original private bytes')
            self.assertFalse((root/'server/config/maw-numen-server.json').exists())

    def test_credentials_are_owner_scoped_hash_only_account_list_and_not_printed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);service.initialize(root);owner=str(uuid.uuid4());second=str(uuid.uuid4())
            capture=io.StringIO()
            with contextlib.redirect_stdout(capture):result=service.provision(owner,'first',root)
            credential=json.loads(Path(result['credentialsFile']).read_text());token=credential['token']
            self.assertEqual(len(token),64);self.assertEqual(credential['ownerUuid'],owner)
            self.assertNotIn(token,json.dumps(result));self.assertEqual(capture.getvalue(),'')
            account_file=root/'server/config/maw-numen-private/accounts.json';accounts=json.loads(account_file.read_text())
            self.assertNotIn(token,account_file.read_text());self.assertEqual(accounts['accounts'][0]['ownerUuid'],owner)
            first=Path(result['credentialsFile']).read_bytes()
            with self.assertRaises(ValueError):service.provision(owner,'overwrite',root)
            self.assertEqual(Path(result['credentialsFile']).read_bytes(),first)
            service.provision(second,'second',root)
            self.assertEqual(Path(result['credentialsFile']).read_bytes(),first)
            with self.assertRaises(ValueError):service.provision('../traversal','unsafe',root)

if __name__=='__main__':unittest.main()
