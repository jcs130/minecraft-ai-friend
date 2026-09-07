import hashlib
from contextlib import ExitStack
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('management_health',Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py')
health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)

class ManagementHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        registry=self.root/'server/world-data/block-registry.json';registry.parent.mkdir(parents=True);registry.write_bytes(b'current-server-registry')
        summary={'schema':1,'registry':{'sha256':hashlib.sha256(registry.read_bytes()).hexdigest()},'ysmWebPlayback':False}
        target=self.root/'vendor/modern-viewer/mod-assets/compatibility-summary.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(summary))
        mapping={'registrySha256':summary['registry']['sha256'],'canonicalBlocksSha256':'fixture-canonical','mappings':[[0,0]]}
        mapping_path=target.parent/'vanilla-state-map.json';mapping_path.write_text(json.dumps(mapping),encoding='utf-8')
        jar=self.root/'server/mc/mods/test.jar';jar.parent.mkdir(parents=True);jar.write_bytes(b'fixture-jar-identity')
        (target.parent/'compatibility-report.json').write_text(json.dumps({'jars':[{'sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'paths':['server/mc/mods/test.jar']}]}))
        self.routes={
            '/api/manage/session':{'configured':True,'authenticated':False,'csrf':None},
            '/api/manage/services':{'services':[{'id':name,'state':'running','health':'healthy'} for name in health.MANIFEST]},
            '/api/eye/state':{'observer':{'online':True},'limits':{'remoteInventoryAvailable':False}},
            '/api/eye/renderer':{'ok':True,'observerOnline':True,'worldAvailable':True,'blockStates':{
                'ready':True,'registrySha256':mapping['registrySha256'],'canonicalBlocksSha256':mapping['canonicalBlocksSha256'],
                'mappingSha256':hashlib.sha256(mapping_path.read_bytes()).hexdigest(),'vanillaStates':1}},
            '/api/eye/compatibility':summary,
        }
    def probe(self,behavior=True):
        def request(url,**kwargs):return io.BytesIO(json.dumps(self.routes[url.removeprefix('http://127.0.0.1:19091')]).encode())
        with patch.object(health,'PROJECT',self.root),patch.object(health.urllib.request,'urlopen',request),patch.object(health,'probe_recorded_behavior',return_value={'ok':behavior}):return health.probe_management()
    def test_current_protocol_and_recorded_behavior_both_required(self):
        self.assertTrue(self.probe()['ok']);self.assertFalse(self.probe(False)['ok'])
        self.routes['/api/eye/renderer']['worldAvailable']=False
        self.assertFalse(self.probe()['ok'])
    def test_old_mod_registry_cannot_hide_behind_live_viewer(self):
        self.routes['/api/eye/compatibility']['registry']['sha256']='old-registry'
        result=self.probe();self.assertFalse(result['ok']);self.assertFalse(result['checks']['current_mod_assets'])
    def test_missing_service_and_public_auth_fail_closed(self):
        self.routes['/api/manage/services']['services'].pop()
        self.assertFalse(self.probe()['checks']['current_services_ready'])
        self.routes['/api/manage/session']['authenticated']=True
        self.assertFalse(self.probe()['checks']['public_session_locked'])
    def test_added_or_changed_mod_requires_asset_refresh(self):
        jar=self.root/'server/mc/mods/test.jar';jar.write_bytes(b'updated-mod')
        self.assertFalse(self.probe()['checks']['current_mod_jars'])
        jar.write_bytes(b'fixture-jar-identity');(jar.parent/'new-mod.jar').write_bytes(b'new')
        self.assertFalse(self.probe()['checks']['current_mod_jars'])

    def test_management_failure_cannot_hide_behind_other_green_panel_probes(self):
        other_probes = (
            'probe_panel_http', 'probe_recorded_behavior', 'probe_source_record',
            'probe_player_commands', 'probe_voice_commands', 'probe_chanting_staff',
            'probe_voice_recording', 'probe_voice_boundary_deployment',
            'probe_skillbar_editor', 'probe_chanting_client', 'probe_operations_team',
        )
        with ExitStack() as stack:
            no_http = stack.enter_context(patch.object(
                health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP')))
            no_process = stack.enter_context(patch.object(
                health.subprocess, 'run', side_effect=AssertionError('No process')))
            for name in other_probes:
                stack.enter_context(patch.object(health, name, return_value={'ok': True}))
            management = stack.enter_context(patch.object(health, 'probe_management', return_value={'ok': True}))
            self.assertTrue(health.probe_panel_smoke()['ok'])
            management.return_value = {'ok': False, 'checks': {'current_services_ready': False}}
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertEqual(result['management'], management.return_value)
            self.assertTrue(all(result[name]['ok'] for name in (
                'runtime', 'visual', 'sources', 'player_commands', 'voice_commands',
                'chanting_staff', 'voice_recording', 'voice_boundary_deployment',
                'skillbar_editor', 'chanting_client')))
            self.assertEqual(management.call_count, 2)
            no_http.assert_not_called()
            no_process.assert_not_called()

if __name__=='__main__':unittest.main()
