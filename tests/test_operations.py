import io
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import tempfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('tested_operations',ROOT/'tools/operations.py')
ops=importlib.util.module_from_spec(spec);spec.loader.exec_module(ops)


class Response(io.BytesIO):
    def __init__(self,data,status=200):super().__init__(data);self.status=status


class OperationsTests(unittest.TestCase):
    def owned_states(self):
        return {'qiandengji-'+n+'-1':{'id':n,'state':'running','health':'healthy','project':'qiandengji','service':n} for n in ops.KNOWN}

    def test_unavailable_and_foreign_containers_block_all_mutations(self):
        for bad in [{'state':'unavailable'},{'id':'mc','project':'shadow','service':'mc','state':'running'}]:
            states=self.owned_states();states['qiandengji-mc-1']=bad
            with self.assertRaises(ValueError):ops.validate_lifecycle(ops.lifecycle_plan('restart',['mc'],states),states)

    def test_npc_requires_explicit_ready_dependencies(self):
        states=self.owned_states();plan=ops.lifecycle_plan('restart',['npc'],states)
        self.assertEqual(plan['requiredRunning'],['mc','world'])
        states['qiandengji-mc-1']['state']='exited'
        with self.assertRaises(ValueError):ops.validate_lifecycle(plan,states)

    def test_start_cannot_implicitly_touch_other_services(self):
        states=self.owned_states();plan=ops.lifecycle_plan('restart',['panel'],states)
        with patch.object(ops,'compose',return_value='') as run,patch.object(ops,'write_action_record'):
            self.assertTrue(ops.execute_lifecycle(plan,states)['ok'])
        self.assertEqual(run.call_args_list[-1].args,('up','-d','--no-deps','--no-recreate','--wait','--wait-timeout','180','panel'))

    def test_failed_save_records_consumers_needing_recovery_without_stopping_mc(self):
        states=self.owned_states();plan=ops.lifecycle_plan('restart',['mc'],states)
        after=self.owned_states()
        for n in ['world','gate','npc']:after['qiandengji-'+n+'-1']['state']='exited'
        with patch.object(ops,'compose',return_value='No save acknowledgement') as run,patch.object(ops,'inspect_containers',return_value=after),patch.object(ops,'write_action_record') as journal:
            with self.assertRaises(AssertionError):ops.execute_lifecycle(plan,states)
        self.assertNotIn(('stop','mc'),[c.args for c in run.call_args_list])
        self.assertEqual(set(journal.call_args.args[0]['pendingRecovery']),{'world','gate','npc'})
        self.assertFalse(journal.call_args.args[0]['ok'])

    def test_exclusive_lock_blocks_second_operation_and_releases(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(ops,'ROOT',Path(folder)):
            (Path(folder)/'server/world-data').mkdir(parents=True)
            with ops.lifecycle_lock():
                with self.assertRaises(FileExistsError):
                    with ops.lifecycle_lock():self.fail('Second lock was acquired')
            self.assertFalse((Path(folder)/'server/world-data/.qiandengji-smoke.lock').exists())

    def test_only_named_current_services_can_be_lifecycle_targets(self):
        registry=ops.read_registry()
        self.assertEqual(ops.select_services(['panel','panel'],None,registry),['panel'])
        self.assertEqual(ops.select_services([], 'dialogue',registry),['qwenpaw'])
        for bad in [['shadow-qwenpaw'],['--remove-orphans'],['../mc'],['mc','shadow-tts'],[]]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):ops.select_services(bad,None,registry)
        with self.assertRaises(ValueError):ops.select_services(['panel'],'game',registry)

    def test_archived_team_is_never_selected_or_restarted(self):
        registry=ops.read_registry()
        selected=ops.select_services([], 'all', registry)
        self.assertEqual(len(selected), 13)
        self.assertIn('inventory',selected)
        self.assertNotIn('qwenpaw-ops', selected)
        self.assertEqual(ops.select_services([], 'operations', registry), ['qwenpaw'])
        with self.assertRaises(ValueError):ops.select_services(['qwenpaw-ops'],None,registry)
        with self.assertRaises(ValueError):ops.lifecycle_plan('start',['qwenpaw-ops'],self.owned_states())

    def test_missing_container_is_distinct_from_unavailable_docker(self):
        for message,expected in [('Error: No such object: shadow-tts','absent'),
                                 ('Cannot connect to Docker daemon','unavailable')]:
            result=SimpleNamespace(returncode=1,stdout='',stderr=message)
            with patch.object(ops.subprocess,'run',return_value=result):
                self.assertEqual(ops.inspect_containers(['shadow-tts'])['shadow-tts']['state'],expected)

    def test_archive_absence_is_not_a_service_failure_but_active_failure_is(self):
        registry=ops.read_registry()
        states=self.owned_states()
        for state in states.values():state['restart']='unless-stopped'
        states['qiandengji-qwenpaw-ops-1']={'state':'absent','health':'not-applicable','restart':None}
        for row in registry['externalServices']:
            states.setdefault(row['container'],{'state':'absent','health':'not-applicable','restart':None})
        inventory=SimpleNamespace(collect_qwenpaw_inventory=lambda **_: {'runtimes':[],'agents':[],'issues':[]})
        with patch.object(ops,'inspect_containers',return_value=states),patch.object(ops,'probe_shared_tts',return_value={'ok':True}),patch.dict(sys.modules,{'qwenpaw_inventory':inventory}):
            result=ops.collect_snapshot()
            self.assertTrue(result['checks']['currentServices'])
            self.assertEqual(result['issues'],[])
            self.assertEqual(result['archivedServices'][0]['id'],'qwenpaw-ops')
            self.assertNotIn('qwenpaw-ops',{row['id'] for row in result['services']})
            states['qiandengji-asr-1']['health']='unhealthy'
            self.assertFalse(ops.collect_snapshot()['checks']['currentServices'])
            states['qiandengji-qwenpaw-ops-1']['state']='running'
            self.assertIn('archive-running:qwenpaw-ops',{row['code'] for row in ops.collect_snapshot()['issues']})

    def test_managed_refresh_verifies_identity_and_never_falls_back_to_host_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'config').mkdir();(root/'server/panel-state').mkdir(parents=True)
            (root/'config/operations-runtime.json').write_bytes((ROOT/'config/operations-runtime.json').read_bytes())
            source={'schema':1,'project':'qiandengji','generatedAt':ops.utc(),'checks':{'currentServices':True}}
            target=root/'server/panel-state/operations.json';target.write_text(json.dumps(source))
            original=target.read_bytes()
            state={'project':'qiandengji','service':'inventory','state':'running','restart':'unless-stopped','id':'a'*64}
            with patch.object(ops,'inspect_containers',return_value={'qiandengji-inventory-1':state}),\
                 patch.object(ops,'command',return_value='{}') as command:
                self.assertEqual(ops.managed_snapshot(root,refresh=True),source)
                self.assertEqual(command.call_args.args[0],['docker','exec','a'*64,'python3','/project/tools/inventory_service.py','--once'])
                command.side_effect=RuntimeError('not published')
                with self.assertRaises(RuntimeError):ops.managed_snapshot(root,refresh=True)
                state['project']='shadow'
                with self.assertRaises(ValueError):ops.managed_snapshot(root)
            with self.assertRaises(RuntimeError):ops.write_snapshot(source,root)
            self.assertEqual(target.read_bytes(),original)

    def test_mc_restart_stops_consumers_but_keeps_previously_disabled_npc_stopped(self):
        states={'qiandengji-'+n+'-1':{'state':'running' if n in ['mc','world','gate'] else 'exited'} for n in ops.KNOWN}
        plan=ops.lifecycle_plan('restart',['mc'],states)
        self.assertTrue(plan['saveMinecraft'])
        self.assertEqual(plan['stop'][-1],'mc')
        self.assertTrue({'world','npc','gate'}<=set(plan['stop']))
        self.assertEqual(set(plan['start']),{'mc','world','gate'})

    def test_dialogue_restart_does_not_stop_player_command_service(self):
        states={'qiandengji-qwenpaw-1':{'state':'running'}}
        plan=ops.lifecycle_plan('restart',['qwenpaw'],states)
        self.assertEqual(plan['stop'],['survivor','qwenpaw'])
        self.assertEqual(plan['start'],['qwenpaw'])
        self.assertFalse(plan['saveMinecraft'])
        states['qiandengji-survivor-1']={'state':'running'}
        plan=ops.lifecycle_plan('restart',['qwenpaw'],states)
        self.assertEqual(plan['stop'],['survivor','qwenpaw'])
        self.assertEqual(plan['start'],['qwenpaw','survivor'])
        self.assertNotIn('world',plan['stop'])

    def test_tts_requires_successful_health_and_explicit_boolean(self):
        for payload,expected in [(b'{"ok":true}',True),(b'{"ok":1}',False),(b'{"ok":"true"}',False),
                                 (b'{"ok":false}',False),(b'{}',False),(b'[]',False),(b'broken',False)]:
            def open_fixture(url,timeout):
                self.assertEqual(url,'http://127.0.0.1:8100/health');self.assertLessEqual(timeout,4)
                return Response(payload)
            with self.subTest(payload=payload):self.assertIs(ops.probe_shared_tts(open_fixture)['ok'],expected)
        self.assertFalse(ops.probe_shared_tts(lambda *a,**kw:Response(b'{"ok":true}',503))['ok'])
        self.assertFalse(ops.probe_shared_tts(lambda *a,**kw:Response(b' '*16385))['ok'])

    def test_tts_connection_failure_exposes_type_not_private_exception_content(self):
        def failing(*args,**kwargs):raise OSError('SECRET_SENTINEL')
        result=ops.probe_shared_tts(failing)
        self.assertFalse(result['ok']);self.assertEqual(result['errorType'],'OSError')
        self.assertNotIn('SECRET_SENTINEL',json.dumps(result))


if __name__=='__main__':unittest.main()
