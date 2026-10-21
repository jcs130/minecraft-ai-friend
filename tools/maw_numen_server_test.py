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
    def test_provision_uses_the_selected_fom_endpoint_without_reviving_old_lan_proxy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);service.initialize(root)
            path=root/'server/config/maw-numen-server.json';config=json.loads(path.read_text())
            config['publicEndpoint']='http://127.0.0.1:28989/mcp';path.write_text(json.dumps(config))
            result=service.provision(str(uuid.uuid4()),'fom-owner',root)
            self.assertEqual(json.loads(Path(result['credentialsFile']).read_text())['endpoint'],config['publicEndpoint'])

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

    def test_revoke_affects_one_owner_and_preserves_credentials_body_and_ledger(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);service.initialize(root);one=str(uuid.uuid4());two=str(uuid.uuid4())
            a=service.provision(one,'first',root);service.provision(two,'other',root)
            credentials=Path(a['credentialsFile']).read_bytes()
            body=root/'server/world/maw-numen-server/bodies/original.json';body.parent.mkdir(parents=True);body.write_bytes(b'original-body-and-actions')
            account_path=root/'server/config/maw-numen-private/accounts.json'
            survivor=json.loads(account_path.read_text())['accounts'][1]
            result=service.revoke(one,root)
            self.assertTrue(result['revoked']);self.assertFalse(result['acceptedActionsAutomaticallyCancelled'])
            self.assertEqual(json.loads(account_path.read_text())['accounts'],[survivor])
            self.assertEqual(Path(a['credentialsFile']).read_bytes(),credentials);self.assertEqual(body.read_bytes(),b'original-body-and-actions')
            before=account_path.read_bytes();self.assertFalse(service.revoke(one,root)['revoked']);self.assertEqual(account_path.read_bytes(),before)

if __name__=='__main__':unittest.main()
