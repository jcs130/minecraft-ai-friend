import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import inventory_service as worker
sys.path.pop(0)


class InventoryServiceTests(unittest.TestCase):
    def inspector(self, status=200, payload=None):
        raw=payload or {'Id':'container','Image':'sha256:abc',
            'State':{'Status':'running','Running':True,'Health':{'Status':'healthy'}},
            'Config':{'Image':'qd:test','Env':['SECRET_SENTINEL'],'Labels':{
                'com.docker.compose.project':'qiandengji','com.docker.compose.service':'qwenpaw'}},
            'HostConfig':{'RestartPolicy':{'Name':'unless-stopped'}}}
        response=io.BytesIO(json.dumps(raw).encode());response.status=status
        connection=SimpleNamespace(request=lambda *args: calls.append(args),
                                   getresponse=lambda:response,close=lambda:None)
        calls=[]
        return worker.DockerInventory(['qiandengji-qwenpaw-1'],lambda:connection),calls

    def test_socket_adapter_only_allows_fixed_get_and_drops_private_inspect_fields(self):
        reader,calls=self.inspector()
        result=reader.inspect('qiandengji-qwenpaw-1')
        self.assertEqual(calls,[('GET','/containers/qiandengji-qwenpaw-1/json')])
        self.assertNotIn('SECRET_SENTINEL',json.dumps(reader.cache))
        self.assertNotIn('Env',result)
        reader.qwen_state('qiandengji-qwenpaw-1')
        self.assertEqual(len(calls),1)
        for name in ('../containers/create','qiandengji-qwenpaw-1/exec','unrelated-service'):
            with self.assertRaises(ValueError):reader.inspect(name)
        self.assertEqual(reader.qwen_state('shadow-qwenpaw'),{})
        self.assertEqual(len(calls),1)

    def test_absence_is_404_and_daemon_error_remains_unknown(self):
        for status,expected in [(404,'absent'),(500,'unavailable')]:
            reader,_=self.inspector(status=status)
            self.assertEqual(reader.operations_states(['qiandengji-qwenpaw-1'])['qiandengji-qwenpaw-1']['state'],expected)

    def test_health_tracks_publication_and_does_not_depend_on_monitored_readiness(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'health.json'
            worker.atomic_json(path,{'schema':1,'service':'inventory','ok':True,
                'updatedAt':1000,'currentServices':False})
            self.assertTrue(worker.healthy(path,now=1100))
            self.assertFalse(worker.healthy(path,now=1300))
            self.assertFalse(worker.healthy(path,now=999))

    def test_adapters_restore_functions_and_map_only_tts_health_endpoint(self):
        reader,_=self.inspector()
        old=worker.operations.inspect_containers
        old_qwen=worker.qwenpaw_inventory._container
        with patch.object(worker.urllib.request,'urlopen',return_value=io.BytesIO(b'{}')) as http:
            with worker.adapters(reader):
                worker.operations.probe_shared_tts()
                self.assertEqual(http.call_args.args,('http://tts:8100/health',))
                self.assertEqual(worker.qwenpaw_inventory._container('shadow-qwenpaw'),{})
            self.assertIs(worker.operations.inspect_containers,old)
            self.assertIs(worker.qwenpaw_inventory._container,old_qwen)

    def test_one_round_publishes_and_marks_collection_healthy_when_mc_is_down(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'config').mkdir()
            (root/'config/operations-runtime.json').write_bytes((ROOT/'config/operations-runtime.json').read_bytes())
            snapshot={'generatedAt':'2026-09-13T12:00:00+00:00','checks':{'currentServices':False}}
            with patch.object(worker.operations,'collect_snapshot',return_value=snapshot),\
                 patch.object(worker.operations,'write_snapshot') as publish:
                result=worker.collect_once(root)
            publish.assert_called_once_with(snapshot,root)
            self.assertEqual(result,snapshot)
            path=root/'server/panel-state/inventory-health.json'
            self.assertTrue(worker.healthy(path))
            self.assertFalse(json.loads(path.read_text('utf-8'))['currentServices'])
            self.assertTrue((root/'server/inventory-state/operations-inventory.lock').is_file())

    def test_project_filter_keeps_real_game_mapping_errors_and_ignores_unmounted_hosts(self):
        raw={'runtimes':[{'id':'qiandengji'},{'id':'host'},{'id':'shadow'}],
             'agents':[{'runtimeId':'qiandengji','id':'mc-god'},{'runtimeId':'host','id':'other'}],
             'issues':[{'code':name} for name in ('team_host_registry_unavailable','host_config_unavailable',
                                                 'shadow_config_unavailable','legacy_access_review')]}
        reader,_=self.inspector()
        with patch.object(worker.qwenpaw_inventory,'collect_qwenpaw_inventory',return_value=raw) as collect:
            with worker.adapters(reader):
                result=worker.qwenpaw_inventory.collect_qwenpaw_inventory(project_root=ROOT)
            self.assertEqual(collect.call_args.kwargs['user_home'],Path('/unmounted-non-game-home'))
        self.assertEqual(result['runtimes'],[{'id':'qiandengji'}])
        self.assertEqual(result['issues'],[{'code':'team_host_registry_unavailable'}])


if __name__=='__main__':unittest.main()
