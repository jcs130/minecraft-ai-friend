from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch,Mock
import hashlib,json,tempfile,time,unittest
import fom_numen as numen
import fom_service

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.server=Path(self.tmp.name)
        self.private=self.server/'config/maw-numen-private';self.private.mkdir(parents=True)
        for name in ('accounts.json','bridge.json'):(self.private/name).write_text('{}')
        self.file=self.server/'config/maw-numen-server.json'
        self.config={'enabled':True,'bind':'127.0.0.1','port':39464,'allowedHosts':['127.0.0.1:39464'],'publicEndpoint':'http://127.0.0.1:39464/mcp','allowedModelHosts':[]}
        self.save();self.selected={'enabled':True,'port':39464};self.mods=dict(numen.FILES)
    def tearDown(self):self.tmp.cleanup()
    def save(self):self.file.write_text(json.dumps(self.config))
    def policy(self):return numen.policy(self.server,self.selected,self.mods,production=False)
    def test_existing_fom_without_headless_selection_is_unchanged(self):
        self.assertIsNone(numen.policy(self.server,None,{},production=True))
    def test_selected_official_core_and_private_endpoint(self):
        p=self.policy();self.assertEqual(p['version'],'0.1.4.1');numen.check_unchanged(p)
    def test_modified_policy_requires_normal_owner_restart(self):
        p=self.policy();self.config['allowedModelHosts']=['example.com'];self.save()
        with self.assertRaisesRegex(ValueError,'changed while running'):numen.check_unchanged(p)
    def test_mismatched_core_duplicate_api_and_missing_adapter_refused(self):
        for mods in ({**self.mods,'numen-neoforge-1.21.1-0.1.4.1.jar':'bad'},
                     {**self.mods,'numen_api.jar':'duplicate'},
                     {n:h for n,h in self.mods.items() if not n.startswith('maw_numen_compat')}):
            self.mods=mods
            with self.assertRaises(ValueError):self.policy()
    def test_public_bind_remote_endpoint_and_loopback_models_refused(self):
        for key,value in [('bind','0.0.0.0'),('publicEndpoint','http://192.168.3.163:39464/mcp'),('testOnlyAllowLoopbackModels',True)]:
            previous=dict(self.config);self.config[key]=value;self.save()
            with self.assertRaisesRegex(ValueError,'loopback-only'):self.policy()
            self.config=previous;self.save()
    def test_authentication_files_and_explicit_port_required(self):
        (self.private/'accounts.json').unlink()
        with self.assertRaisesRegex(ValueError,'authentication'):self.policy()
        self.selected['port']=28989
        with self.assertRaisesRegex(ValueError,'private port'):self.policy()
    def test_production_cannot_expose_arbitrary_admin_port(self):
        with self.assertRaisesRegex(ValueError,'private port'):numen.policy(self.server,self.selected,self.mods,production=True)
    def test_exactly_one_pinned_host_supports_reviewed_upgrade_and_rollback(self):
        core={n:h for n,h in numen.FILES.items() if not n.startswith('maw_numen_server-')}
        for name,digest in numen.HOSTS.items():
            self.mods={**core,name:digest};self.policy()
        self.mods={**core,**numen.HOSTS}
        with self.assertRaises(ValueError):self.policy()
        self.mods={**core,'maw_numen_server-0.2.1.jar':'modified'}
        with self.assertRaises(ValueError):self.policy()

class GameplayReadinessTests(unittest.TestCase):
    def test_unselected_extension_does_not_impose_gameplay_catalog(self):
        self.assertEqual(numen.gameplay_checks(numen.FILES,{}),{})
    def test_installed_extension_must_be_detected_and_expose_its_base_actions(self):
        files={**numen.FILES,'maw_numen_mods-0.1.0.jar':'locked'}
        self.assertFalse(all(numen.gameplay_checks(files,{}).values()))
        self.assertFalse(all(numen.gameplay_checks(files,{'nativeModAccess':True,'nativeModOperationCount':17}).values()))
        self.assertTrue(all(numen.gameplay_checks(files,{'nativeModAccess':True,'nativeModOperationCount':17,'managedBodyChunkLoading':True}).values()))
    def test_colony_installation_cannot_pass_with_only_the_base_catalog(self):
        files={'maw_numen_mods-0.1.0.jar':'locked','minecolonies-1.1.1319-1.21.1.jar':'locked'}
        self.assertFalse(all(numen.gameplay_checks(files,{'nativeModAccess':True,'nativeModOperationCount':17}).values()))
        self.assertTrue(all(numen.gameplay_checks(files,{'nativeModAccess':True,'nativeModOperationCount':35}).values()))

class OwnedReadinessTests(unittest.TestCase):
    def child(self,age=400):
        c=object.__new__(fom_service.FomChild);c.spec={'numenServer':{'port':39464},'startupTimeoutSeconds':300};c.started=time.monotonic()-age;c.process=SimpleNamespace(pid=123);c.metrics={};c.ready=True;c.stop=Mock();return c
    def test_persistent_numen_failure_restarts_only_its_owned_jvm_after_three_checks(self):
        c=self.child()
        with patch.object(fom_service.Child,'tick',lambda x:setattr(x,'ready',True)),patch.object(numen,'health',side_effect=ValueError('not ready')):
            c.tick();self.assertFalse(c.ready);c.stop.assert_not_called()
            c.tick();c.stop.assert_not_called()
            c.tick();c.stop.assert_called_once()
    def test_startup_budget_and_success_reset_failure_count(self):
        c=self.child(age=10)
        with patch.object(fom_service.Child,'tick',lambda x:setattr(x,'ready',True)),patch.object(numen,'health',side_effect=ValueError('starting')):
            for _ in range(4):c.tick()
        c.stop.assert_not_called()
        with patch.object(fom_service.Child,'tick'),patch.object(numen,'health',return_value={'ready':True}):
            c.ready=True;c.tick();self.assertEqual(c.numen_failures,0)
    def test_declared_endpoint_must_belong_to_the_owned_jvm(self):
        with patch('maw_service.check_owned_listener',side_effect=ValueError('wrong owner')):
            with self.assertRaisesRegex(ValueError,'wrong owner'):numen.health(39464,123)

if __name__=='__main__':unittest.main()
