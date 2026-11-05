import importlib.util,json,subprocess,tempfile,unittest
from unittest.mock import Mock,patch
from pathlib import Path
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('supervisor',Path(__file__).with_name('native-camera-supervisor.py'))
supervisor=importlib.util.module_from_spec(spec);spec.loader.exec_module(supervisor)

class CameraGpuTest(unittest.TestCase):
    def test_login_keeps_guards_active_and_stops_only_its_helper(self):
        helper=Mock();helper.poll.return_value=None
        with patch.object(supervisor.subprocess,'Popen',return_value=helper),self.assertRaisesRegex(RuntimeError,'CAMERA_GPU_MEMORY_BUDGET'):
            supervisor.guarded_login(['private-helper'],lambda:'CAMERA_GPU_MEMORY_BUDGET')
        helper.terminate.assert_called_once();helper.wait.assert_called_once()

    def test_login_timeout_and_guard_failure_always_reap_helper(self):
        for guard,timeout,expected in ((lambda:None,-1,'CAMERA_AUTHENTICATION_TIMEOUT'),
                (Mock(side_effect=RuntimeError('READ_FAILURE')),140,'READ_FAILURE')):
            helper=Mock();helper.poll.return_value=None
            with patch.object(supervisor.subprocess,'Popen',return_value=helper),self.assertRaisesRegex(RuntimeError,expected):
                supervisor.guarded_login(['private-helper'],guard,timeout)
            helper.terminate.assert_called_once();helper.wait.assert_called_once()

    def test_login_result_is_preserved_without_restarting_service(self):
        for code in (0,1):
            helper=Mock();helper.poll.return_value=code;helper.returncode=code
            with patch.object(supervisor.subprocess,'Popen',return_value=helper):
                self.assertEqual(supervisor.guarded_login(['private-helper'],lambda:None),code)
            helper.terminate.assert_not_called()

    def test_intel_remains_default_and_shader_off(self):
        state={'renderer':'D3D12 (Intel(R) UHD Graphics 770)','shadersEnabled':False}
        self.assertTrue(supervisor.renderer_matches(state,{}))
        self.assertFalse(supervisor.renderer_matches({**state,'shadersEnabled':True},{}))
        self.assertFalse(supervisor.renderer_matches({'renderer':'NVIDIA GeForce RTX 3080 Ti','shadersEnabled':False},{}))

    def test_rtx_requires_actual_adapter_and_native_policy(self):
        state={'renderer':'NVIDIA GeForce RTX 3080 Ti/PCIe/SSE2','vendor':'NVIDIA Corporation','expectedGpu':'rtx3080ti','shadersEnabled':True}
        cfg={'expectedGpu':'rtx3080ti'}
        self.assertTrue(supervisor.renderer_matches(state,cfg))
        for change in ({'renderer':'NVIDIA RTX PRO 5000'},{'vendor':'Microsoft Corporation'},{'shadersEnabled':False},{'expectedGpu':'intel'}):
            with self.subTest(change=change):self.assertFalse(supervisor.renderer_matches({**state,**change},cfg))

    def test_vram_is_read_from_exact_adapter_and_bad_readings_fail_closed(self):
        cfg={'gpuUuid':'GPU-00000000-0000-0000-0000-000000000001'}
        def run(args,**kwargs):
            self.assertEqual(args[1:3],['-i',cfg['gpuUuid']]);self.assertTrue(kwargs['check'])
            return SimpleNamespace(stdout=cfg['gpuUuid']+', NVIDIA GeForce RTX 3080 Ti, 1100\n')
        self.assertEqual(supervisor.gpu_free_mib(cfg,run),1100)
        for output in ('',cfg['gpuUuid']+', NVIDIA RTX PRO 5000, 9000',cfg['gpuUuid']+', NVIDIA GeForce RTX 3080 Ti, N/A',cfg['gpuUuid']+', NVIDIA GeForce RTX 3080 Ti, -1'):
            with self.subTest(output=output),self.assertRaises(ValueError):supervisor.gpu_free_mib(cfg,lambda *a,**k:SimpleNamespace(stdout=output))
        def timeout(*a,**k):raise subprocess.TimeoutExpired('nvidia-smi',5)
        with self.assertRaises(subprocess.TimeoutExpired):supervisor.gpu_free_mib(cfg,timeout)

    def test_configuration_preserves_identity_and_explicit_gpu_limits(self):
        with tempfile.TemporaryDirectory() as temp:
            cfg={key:str(Path(temp).resolve()) for key in ('gameDir','java','launcher','python','node','loginHelper','stateDir','pauseFile','authHeartbeat')}
            cfg.update(server='192.168.3.163:25565',expectedUuid='ff58a81b-f033-3b74-a7cf-58ac4e798bb0',maximumPrivateGiB=8,shadersEnabled=False)
            file=Path(temp)/'config.json'
            def load(value):file.write_text(json.dumps(value));return supervisor.configuration(file)
            self.assertEqual(load(cfg),cfg)
            rtx={**cfg,'expectedGpu':'rtx3080ti','shadersEnabled':True,'maximumPrivateGiB':6,'gpuUuid':'GPU-00000000-0000-0000-0000-000000000001'}
            self.assertEqual(load(rtx),rtx)
            for change in ({'expectedGpu':'nvidia'},{'maximumPrivateGiB':16},{'gpuUuid':''},{'expectedUuid':'some-player'},{'shadersEnabled':False}):
                with self.subTest(change=change),self.assertRaises(ValueError):load({**rtx,**change})
            with self.assertRaises(ValueError):load({**cfg,'shadersEnabled':True})

if __name__=='__main__':unittest.main()
