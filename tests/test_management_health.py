import hashlib
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
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
            '/api/manage/session':{'configured':True,'authMode':'local','authenticated':True,
                                  'csrf':'a'*48,'expiresAt':(time.time()+3600)*1000},
            '/api/manage/services':{'services':[{'id':name,'state':'running','health':'healthy'} for name in health.MANIFEST]},
            '/api/eye/state':{'observer':{'online':True},'limits':{'remoteInventoryAvailable':False}},
            '/api/eye/renderer':{'ok':True,'observerOnline':True,'worldAvailable':True,'blockStates':{
                'ready':True,'registrySha256':mapping['registrySha256'],'canonicalBlocksSha256':mapping['canonicalBlocksSha256'],
                'mappingSha256':hashlib.sha256(mapping_path.read_bytes()).hexdigest(),'vanillaStates':1}},
            '/api/eye/compatibility':summary,
        }
    def probe(self,behavior=True,recovery=True):
        def request(url,**kwargs):return io.BytesIO(json.dumps(self.routes[url.removeprefix('http://127.0.0.1:19091')]).encode())
        def evidence(filename,*args,**kwargs):
            return {'ok':recovery if filename=='management-recovery-smoke.json' else behavior}
        with patch.object(health,'PROJECT',self.root),patch.object(health.urllib.request,'urlopen',request),patch.object(health,'probe_recorded_behavior',side_effect=evidence),patch.object(health,'probe_passwordless_consoles',return_value={'ok':behavior}):return health.probe_management()
    def test_current_protocol_and_recorded_behavior_both_required(self):
        self.assertTrue(self.probe()['ok']);self.assertFalse(self.probe(False)['ok'])
        self.routes['/api/eye/renderer']['worldAvailable']=False
        self.assertFalse(self.probe()['ok'])
    def test_session_and_pending_recovery_evidence_cannot_be_replaced_by_live_health(self):
        value=self.probe(recovery=False)
        self.assertFalse(value['ok']);self.assertFalse(value['recovery']['ok'])
        self.assertTrue(all(value['checks'].values()));self.assertTrue(value['passwordless']['ok'])
    def test_old_mod_registry_cannot_hide_behind_live_viewer(self):
        self.routes['/api/eye/compatibility']['registry']['sha256']='old-registry'
        result=self.probe();self.assertFalse(result['ok']);self.assertFalse(result['checks']['current_mod_assets'])
    def test_missing_service_and_passwordless_session_fail_closed(self):
        self.routes['/api/manage/services']['services'].pop()
        self.assertFalse(self.probe()['checks']['current_services_ready'])
        initial = deepcopy(self.routes['/api/manage/session'])
        for key, value in [('authenticated',False),('authenticated',1),('authMode','password'),
                           ('csrf',None),('csrf','a'*47),('csrf','G'*48),('expiresAt',True),
                           ('expiresAt',float('inf')),('expiresAt',0),('expiresAt',(time.time()+7200)*1000)]:
            with self.subTest(key=key,value=value):
                self.routes['/api/manage/session']={**initial,key:value}
                self.assertFalse(self.probe()['checks']['local_passwordless_session'])
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
            'probe_skillbar_editor', 'probe_chanting_client', 'probe_operations_team', 'probe_game_qwenpaw', 'probe_survivor',
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

class PasswordlessConsoleHealth(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory(prefix='qd-passwordless-health-')
        self.root=Path(temporary.name).resolve()
        def cleanup():
            if not self.root.is_relative_to(Path(tempfile.gettempdir()).resolve()) or not self.root.name.startswith('qd-passwordless-health-'):
                raise AssertionError('Unsafe temporary cleanup target')
            temporary.cleanup()
        self.addCleanup(cleanup)
        self.path=self.root/'reports/passwordless-console-smoke.json';self.path.parent.mkdir()
        self.report={'schema':1,'project':'qiandengji','ok':True,
                     'finishedAt':datetime.now(timezone.utc).isoformat(),
                     'checks':[{'name':name,'ok':True} for name in health.PASSWORDLESS_CONSOLE_CHECKS]}
        self.path.write_text(json.dumps(self.report),encoding='utf-8')
        self.ports=[{internal:[{'HostIp':'127.0.0.1','HostPort':public}]} for _,internal,public in health.LOCAL_CONSOLE_PORTS]

    def probe(self,ports=None,*,output=None,returncode=0):
        output='\n'.join(map(json.dumps,self.ports if ports is None else ports)) if output is None else output
        with patch.object(health,'PROJECT',self.root),patch.object(health.subprocess,'run',return_value=SimpleNamespace(
                returncode=returncode,stdout=output,stderr='PRIVATE')) as run:
            result=health.probe_passwordless_consoles()
        self.assertNotIn('PRIVATE',json.dumps(result));return result,run

    def test_current_three_bindings_and_actual_report_both_required(self):
        value,run=self.probe();self.assertTrue(value['ok'])
        self.assertEqual(run.call_args.args[0],['docker','inspect','--format','{{json .NetworkSettings.Ports}}',
                         'qiandengji-panel-1','qiandengji-qwenpaw-1','qiandengji-qwenpaw-ops-1'])
        self.assertEqual(run.call_args.kwargs['creationflags'],getattr(health.subprocess,'CREATE_NO_WINDOW',0))
        self.path.unlink();value,_=self.probe();self.assertFalse(value['ok']);self.assertTrue(value['localhost_bindings'])

    def test_wildcard_extra_ports_missing_or_malformed_container_cannot_pass(self):
        cases=[self.ports[:-1],self.ports+[{}],[],[None,*self.ports[1:]]]
        for ip in ('0.0.0.0','::','localhost'):
            changed=deepcopy(self.ports);changed[0]['9090/tcp'][0]['HostIp']=ip;cases.append(changed)
        changed=deepcopy(self.ports);changed[1]['8088/tcp'].append({'HostIp':'0.0.0.0','HostPort':'8088'});cases.append(changed)
        changed=deepcopy(self.ports);changed[2]['9090/tcp']=[{'HostIp':'0.0.0.0','HostPort':'9090'}];cases.append(changed)
        changed=deepcopy(self.ports);changed[1]['8088/tcp'][0]['HostPort']='8088';cases.append(changed)
        for ports in cases:
            self.assertFalse(self.probe(ports)[0]['ok'])
        for kwargs in ({'output':'PRIVATE'},{'output':'x'*16385},{'returncode':1}):
            self.assertFalse(self.probe(**kwargs)[0]['ok'])

    def test_failed_old_partial_or_unbounded_behavior_is_not_accepted(self):
        changes=[{'schema':True},{'project':'shadow'},{'ok':False},{'finishedAt':'tomorrow'},
                 {'finishedAt':datetime.fromtimestamp(time.time()+60,timezone.utc).isoformat()},
                 {'checks':self.report['checks'][:-1]},{'checks':self.report['checks']+[self.report['checks'][0]]}]
        for bad in (False,1,'true',None):
            changes.append({'checks':[{**self.report['checks'][0],'ok':bad},*self.report['checks'][1:]]})
        for change in changes:
            self.path.write_text(json.dumps({**self.report,**change}),encoding='utf-8')
            value,_=self.probe();self.assertFalse(value['ok']);self.assertTrue(value['localhost_bindings'])
        for raw in ('[]','null','{partial','x'*(256*1024+1)):
            self.path.write_text(raw,encoding='utf-8');self.assertFalse(self.probe()[0]['ok'])

if __name__=='__main__':unittest.main()
