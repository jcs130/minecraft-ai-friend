import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT/'world/ops'))
from world_team_hosts import ENGINEER, MIGRATION, SOURCE, TARGET
from operations_team_mcp import OperationsTools, operation_arguments
import operations_team_mcp as mcp_module
if os.name != 'nt':
    import operations_native_tasks as native


class HostedOperationsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = self.root/'host.json'
        self.value = {'schema':1, 'migration':MIGRATION, 'phase':'active',
                      'logicalActor':ENGINEER, 'source':SOURCE, 'target':TARGET}
        self.manifest.write_text(json.dumps(self.value))
        p = patch.dict(os.environ, {'TEAM_RUNTIME_HOSTS_FILE':str(self.manifest)})
        p.start(); self.addCleanup(p.stop)

    def test_skills_follow_native_workspace_and_reports_keep_original_attribution(self):
        for role, content in [('mc-god','GODDESS'), ('qd-engineer','ENGINEER')]:
            folder = self.root/'workspaces'/role
            (folder/'skills/own-skill').mkdir(parents=True)
            (folder/'skill.json').write_text(json.dumps({'skills':{'own-skill':{'enabled':True}}}))
            (folder/'skills/own-skill/SKILL.md').write_text(content)
        service = OperationsTools('mc-god', state=self.root/'shared-operations',
            native_role='qd-engineer', native_runtime='game', workspace_root=self.root/'workspaces')
        self.assertEqual(service.reference('my-skills')['skills'][0]['content'], 'ENGINEER')
        result = service.submit('hosted-report-001', 'observed', [], [])
        self.assertEqual(result['role'], 'mc-god')
        self.assertTrue((self.root/'shared-operations/reports/mc-god/hosted-report-001.json').is_file())
        self.assertFalse((self.root/'workspaces/mc-god/reports').exists())

    def test_inactive_or_wrong_host_cannot_use_operations_identity(self):
        with self.assertRaises(ValueError): operation_arguments('mc-god','mc-god','game')
        self.value['phase']='prepared'; self.manifest.write_text(json.dumps(self.value))
        with self.assertRaises(ValueError):
            OperationsTools('mc-god', native_role='qd-engineer', native_runtime='game')

    def test_hosted_storage_uses_exact_native_identity_without_inherited_environment(self):
        from operations_state import state_root
        with patch.dict(os.environ, {}, clear=True):
            os.environ['TEAM_RUNTIME_HOSTS_FILE'] = str(self.manifest)
            service = OperationsTools('mc-god', native_role='qd-engineer', native_runtime='game')
            self.assertEqual(service.state, Path('/operations-state/work/operations'))
            self.assertEqual(state_root('mc-god', native_role='qd-engineer', native_runtime='game'),
                             Path('/operations-state'))
            self.assertEqual(state_root('default'), Path('/state'))
            with self.assertRaises(ValueError): state_root('mc-god')
            with self.assertRaises(ValueError):
                state_root('mc-god', native_role='mc-god', native_runtime='game')
        with patch.dict(os.environ, {'QIANDENG_OPERATIONS_STATE_DIR':'/wrong-legacy-storage'}):
            self.assertEqual(OperationsTools('mc-god',native_role='qd-engineer',native_runtime='game').state,
                             Path('/operations-state/work/operations'))

    @unittest.skipIf(os.name=='nt','native module uses Linux fcntl')
    def test_coordinator_binds_reports_planning_and_delegation_to_same_shared_state(self):
        import types
        from world_team_hosts import MIGRATIONS
        from world_operations import WorldPlanning
        self.manifest.write_text(json.dumps({'schema':2,
            'phases':{name:'active' for name in MIGRATIONS},
            'retired':['qd-diagnostics','mc-priest','mc-guard-kirito'],'dormant':['mc-guard-naruto']}))
        registered = {}
        class App:
            def __init__(self, name): pass
            def tool(self):
                def register(fn): registered[fn.__name__] = fn; return fn
                return register
            def run(self, **kwargs): pass
        with patch.dict(os.environ, {'QIANDENG_OPERATIONS_STATE_DIR':'/wrong-filtered-value'}), \
                patch.object(native,'STATE',Path('/state')), \
                patch.dict(sys.modules, {'mcp.server.fastmcp':types.SimpleNamespace(FastMCP=App)}), \
                patch.object(sys,'argv',['operations_team_mcp.py','--role','default',
                    '--native-role','qd-steward','--native-runtime','game']), \
                patch('world_operations.WorldPlanning', wraps=WorldPlanning) as planning:
            mcp_module.main()
            self.assertEqual(native.STATE, Path('/operations-state'))
            self.assertEqual(planning.call_args.kwargs['state'], Path('/operations-state/work/operations'))
            snapshot = registered['operations_snapshot']()
            self.assertEqual(snapshot['operationsStateDirectory'], '/operations-state/work/operations')

    @unittest.skipIf(os.name=='nt','real fcntl ledger is tested in Linux image')
    def test_new_requests_use_game_host_and_legacy_pending_stays_at_original_host(self):
        with patch.object(native,'STATE',self.root), patch.object(native,'api',return_value={'task_id':'task-new'}) as api:
            result=native.delegate('default','mc-god','inspect current source')
            self.assertEqual(result['nativeHost'],TARGET)
            self.assertEqual(api.call_args.kwargs['recorded_host'],TARGET)
        with patch.object(native,'STATE',self.root):
            with native.ledger() as rows:
                rows[0].pop('nativeHost'); rows[0]['taskId']='task-legacy'
            with patch.object(native,'api',side_effect=TimeoutError) as api:
                self.assertEqual(native.reconcile_pending()['reconciled'],[])
                self.assertEqual(api.call_args.kwargs['recorded_host'],SOURCE)
            with native.ledger() as rows: self.assertEqual(rows[0]['status'],'submitted')

    @unittest.skipIf(os.name=='nt','native module uses Linux fcntl')
    def test_transport_uses_game_native_header_without_forwarding_ops_token(self):
        response=MagicMock(); response.content=b'{}'; response.json.return_value={}
        client=MagicMock(); client.request.return_value=response
        with patch.object(native.httpx,'Client') as factory:
            factory.return_value.__enter__.return_value=client
            native.api('GET','/agents/mc-god/agent-status','mc-god')
            self.assertEqual(factory.call_args.kwargs['base_url'],'http://qwenpaw:8088/api')
            self.assertEqual(factory.call_args.kwargs['headers'],{'X-Agent-Id':'qd-engineer'})
            self.assertEqual(client.request.call_args.args,('GET','/agents/qd-engineer/agent-status'))
        with self.assertRaises(ValueError):
            native.target_host('mc-god',{'runtime':'game','agentId':'mc-god'})

    @unittest.skipIf(os.name=='nt','native module uses Linux fcntl')
    def test_consolidated_roles_keep_native_coordinator_and_archived_task_hosts(self):
        from world_team_hosts import MIGRATIONS
        self.manifest.write_text(json.dumps({'schema':2,
            'phases':{name:'active' for name in MIGRATIONS},
            'retired':['qd-diagnostics','mc-priest','mc-guard-kirito'], 'dormant':['mc-guard-naruto']}))
        with patch.object(native,'STATE',self.root), patch.object(native,'api',return_value={'task_id':'task-new'}) as api:
            result = native.delegate('default','mc-god','inspect current source')
            payload = api.call_args.kwargs['json']
            self.assertEqual(result['role'], 'mc-god')
            self.assertEqual(result['nativeHost'], TARGET)
            self.assertEqual(payload['request_context']['root_agent_id'], 'qd-steward')
        for role, target in [('mc-herald','qd-diagnostics'), ('mc-priest','mc-priest'),
                             ('mc-guard-kirito','mc-guard-kirito'), ('mc-guard-naruto','mc-guard-naruto')]:
            with self.assertRaisesRegex(ValueError,'team_native_host_inactive'):
                native.target_host(role)
            original = {'runtime':'operations','agentId':role}
            migrated = {'runtime':'game','agentId':target}
            self.assertEqual(native.target_host(role, original), original)
            self.assertEqual(native.target_host(role, migrated), migrated)

    def test_existing_stdio_engineer_tools_recheck_host_after_cutover(self):
        import types
        registered = {}
        class App:
            def __init__(self, name): pass
            def tool(self):
                def register(fn): registered[fn.__name__] = fn; return fn
                return register
            def run(self, **kwargs): pass
        self.value['phase']='prepared'; self.manifest.write_text(json.dumps(self.value))
        with patch.dict(sys.modules, {'mcp.server.fastmcp': types.SimpleNamespace(FastMCP=App)}), \
                patch.object(sys,'argv',['operations_team_mcp.py','--role','mc-god']):
            mcp_module.main()
        self.assertEqual(set(registered),set(mcp_module.TOOLS))
        with patch.object(OperationsTools,'snapshot',return_value={'ok':True}) as snapshot:
            self.assertTrue(registered['operations_snapshot']()['ok'])
            self.value['phase']='active'; self.manifest.write_text(json.dumps(self.value))
            with self.assertRaisesRegex(ValueError,'team_native_host_inactive'):
                registered['operations_snapshot']()
            self.assertEqual(snapshot.call_count,1)


if __name__ == '__main__': unittest.main()
