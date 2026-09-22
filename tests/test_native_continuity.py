import io
import json
from pathlib import Path
import sys
import unittest
import urllib.error
from unittest.mock import Mock
import httpx

sys.path[:0]=[str(Path(__file__).resolve().parents[1]/'world/survival'),str(Path(__file__).parent)]
from controller import QwenBackend
import test_survival_controller as fixture
import test_sidecar_qwen_tasks as sidecar
from numen_gateway import read_json


class NativeMissingTests(unittest.TestCase):
    def test_missing_handle_requires_exact_native_404_and_idle_tracker(self):
        task='task-012345abcdef';backend=QwenBackend.__new__(QwenBackend);backend.agent_id='qd-survivor'
        for detail,idle,expected in [({'detail':'Task not found: '+task},{'status':'idle','running_task_count':0},True),
                                    ({'detail':'proxy not found'},{'status':'idle','running_task_count':0},False),
                                    ({'detail':'Task not found: '+task},{'status':'running','running_task_count':1},False)]:
            request=httpx.Request('GET','http://fixture/task')
            error=httpx.HTTPStatusError('missing',request=request,response=httpx.Response(404,json=detail,request=request))
            backend.api=Mock(side_effect=[error,idle])
            if expected:
                result=backend.poll(task);self.assertEqual(result['status'],'failed')
                self.assertFalse(result['reconciliation']['resultVerified'])
            else:
                with self.assertRaises(httpx.HTTPStatusError):backend.poll(task)
            self.assertTrue(all(c.args[0]=='GET' for c in backend.api.call_args_list))


class YuiMissingTests(unittest.TestCase):
    setUp=sidecar.NativeTaskTests.setUp
    def test_lost_native_task_frees_next_round_without_replaying_original(self):
        self.client.submit('maid_dialogue','old','old input')
        def transport(method,path,role,payload=None):
            if path.endswith('/agent-status'):return {'status':'idle','running_task_count':0}
            if method=='GET':raise urllib.error.HTTPError(path,404,'missing',{},io.BytesIO(json.dumps({'detail':'Task not found: task-012345abcdef'}).encode()))
            return {'task_id':'task-abcdef012345'}
        self.client.transport=Mock(side_effect=transport)
        result=self.client.poll('maid_dialogue','old')
        self.assertEqual(result['status'],'failed');self.assertFalse(result['resultVerified'])
        self.assertEqual(self.client.submit('maid_dialogue','old','old input')['status'],'failed')
        self.assertEqual(self.client.submit('maid_dialogue','fresh','fresh observation')['status'],'submitted')
        self.assertEqual(sum(c.args[0]=='POST' for c in self.client.transport.call_args_list),1)


class RecoveryTests(unittest.TestCase):
    setUp=fixture.ControllerTests.setUp
    create=fixture.ControllerTests.create
    write=fixture.ControllerTests.write
    def test_runtime_pause_recovers_but_operator_and_unknown_never_do(self):
        self.backend.idle=lambda:True
        self.controller.data['actionExecution']={'ok':True,'inFlight':False}
        for reason,unknown,enabled in [('model_result_unknown',False,True),('operator_pause',False,False),('model_result_unknown',True,False)]:
            self.write('control.json',{'enabled':False,'pauseReason':reason})
            if unknown:self.write('unknown.json',{'fixture':True})
            self.controller.recover_runtime_pause(self.gateway.body)
            self.assertEqual(read_json(self.state/'control.json')['enabled'],enabled)

    def test_poll_transport_error_never_settles_cancellation(self):
        self.controller.tick();self.controller.data['cancellationStatus']='waiting_for_native_terminal'
        self.backend.reply=TimeoutError('fixture')
        self.assertEqual(self.controller.settle_cancellation(),'waiting')
        self.clock.now+=10000
        self.assertEqual(self.controller.settle_cancellation(),'waiting')
        self.assertIsNotNone(self.controller.data['active'])
