import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1]/'world/survival'), str(Path(__file__).parent)]
from system_one import SystemOne, validate_choice, OFFICIAL_ENDPOINT
from skill_library import _validate_result, SkillError
import test_survival_controller as fixture
from numen_gateway import read_json

PROPOSAL = {'question': 'Choose one bounded action.', 'candidates': [
    {'id':'advance','description':'Move to the observed reachable next waypoint.',
     'action':{'tool':'goto','args':{'x':105,'y':64,'z':100}}},
    {'id':'escalate','description':'Return to the slow planner if uncertain.', 'action':None}]}

def reply(p=.9):
    return {'model':'fixture-decider','answers':{'action':{'type':'choice','choice':'advance','confidence':p,
            'probabilities':{'advance':p,'escalate':1-p}}}}


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.now=100.; self.body={'ok':True,'observedAt':100000,'bodyUuid':'body','dimension':'overworld'}
        self.transport=Mock(return_value=reply())
        self.policy=SystemOne(transport=self.transport,clock=lambda:self.now)

    def test_typed_candidate_selection_keeps_parameters_and_excludes_history(self):
        self.body['history']='private reasoning'
        result=self.policy.choose(PROPOSAL,self.body,'reach waypoint')
        self.assertTrue(result['ok']);self.assertEqual(result['action'],PROPOSAL['candidates'][0]['action'])
        self.assertNotIn('history',self.transport.call_args.args[0]['state']['body'])

    def test_low_confidence_unknown_choices_and_failure_never_make_actions(self):
        for value in [reply(.55),reply()|{'answers':{}},reply()|{'answers':{'action':{'choice':'invented'}}}]:
            self.transport.return_value=value
            self.assertFalse(self.policy.choose(PROPOSAL,self.body)['ok'])
        self.transport.side_effect=TimeoutError('fixture')
        self.assertEqual(self.policy.choose(PROPOSAL,self.body)['code'],'policy_unavailable')

    def test_official_confidence_is_independent_of_selected_probability(self):
        value=reply(.9);value['answers']['action']['confidence']=.78
        value['usage']={'input_tokens':320,'output_tokens':34}
        self.transport.return_value=value
        result=self.policy.choose(PROPOSAL,self.body)
        self.assertTrue(result['ok']);self.assertEqual(result['selectedProbability'],.9)
        self.assertEqual(result['confidence'],.78);self.assertEqual(result['usage'],value['usage'])
        self.assertEqual(self.transport.call_args.args[0]['model'],'jev-latest')
        value['answers']['action']['confidence']=.6
        self.assertEqual(self.policy.choose(PROPOSAL,self.body)['code'],'policy_escalated')
        value['answers']['action'].update(confidence=.9,probabilities={'advance':.3,'escalate':.7})
        self.assertEqual(self.policy.choose(PROPOSAL,self.body)['code'],'policy_unavailable')

    def test_auth_is_file_backed_official_only_and_redirects_are_not_followed(self):
        import httpx
        with tempfile.TemporaryDirectory() as folder:
            key=Path(folder)/'key';key.write_text('fixture-key-never-a-real-credential','ascii')
            requests=[]
            def handle(request):
                requests.append(request)
                return httpx.Response(302,headers={'location':'https://outside.example/collect'})
            client_class=httpx.Client
            def client(**kwargs):
                self.assertIs(kwargs['trust_env'],False);self.assertIs(kwargs['follow_redirects'],False)
                return client_class(**kwargs,transport=httpx.MockTransport(handle))
            policy=SystemOne(api_key_file=key,clock=lambda:self.now)
            with patch('httpx.Client',side_effect=client):
                result=policy.choose(PROPOSAL,self.body)
            self.assertEqual(result['code'],'policy_unavailable');self.assertEqual(len(requests),1)
            self.assertEqual(str(requests[0].url),OFFICIAL_ENDPOINT)
            self.assertEqual(requests[0].headers['Authorization'],'Bearer '+key.read_text())
            self.assertNotIn(key.read_text(),str(result))
            local=SystemOne('http://127.0.0.1:8000/v1/systemone',api_key_file=key)
            self.assertEqual(local._headers(),{})
            for endpoint in ('http://api.typesafe.ai/v1/systemone',
                             'https://api.typesafe.ai.evil.example/v1/systemone',
                             OFFICIAL_ENDPOINT+'?forward=1'):
                with self.assertRaises(ValueError):SystemOne(endpoint,api_key_file=key)

    def test_http_auth_failure_rate_limit_oversize_and_missing_key_do_not_retry(self):
        import httpx
        with tempfile.TemporaryDirectory() as folder:
            key=Path(folder)/'key';key.write_text('fixture-key-never-a-real-credential','ascii')
            client_class=httpx.Client
            for status,body in ((401,b'private upstream error'),(429,b'rate limited'),(200,b'x'*32769)):
                requests=[]
                def handle(request):
                    requests.append(request);return httpx.Response(status,content=body)
                with patch('httpx.Client',side_effect=lambda **kw:client_class(**kw,transport=httpx.MockTransport(handle))):
                    result=SystemOne(api_key_file=key,clock=lambda:self.now).choose(PROPOSAL,self.body)
                self.assertEqual(result['code'],'policy_unavailable');self.assertEqual(len(requests),1)
                self.assertNotIn('private',str(result));self.assertNotIn(key.read_text(),str(result))
            key.unlink()
            with patch('httpx.Client') as client:
                result=SystemOne(api_key_file=key,clock=lambda:self.now).choose(PROPOSAL,self.body)
                self.assertEqual(result['code'],'policy_unavailable');client.assert_not_called()

    def test_official_health_lists_models_without_running_inference(self):
        policy=SystemOne()
        with patch.object(policy,'_request',return_value={'models':[{'name':'jev-latest'}]}) as request:
            health=policy.health()
        self.assertTrue(health['ok']);self.assertTrue(health['authenticationVerified'])
        self.assertEqual((health['modelCalls'],health['worldActions']),(0,0))
        request.assert_called_once_with('GET','https://api.typesafe.ai/v1/models')
        with patch.object(policy,'_request',side_effect=OSError('secret error must not be logged')):
            health=policy.health()
        self.assertFalse(health['ok']);self.assertNotIn('secret',str(health))

    def test_current_vitals_and_equipment_reach_policy_without_raw_inventory_or_reasoning(self):
        self.body.update(hp=8, maxHp=20, hunger=5, saturation=0, air=17, inWater=True,
            equipment={'mainhand':{'item':'minecraft:iron_sword','nbt':'private data'}},
            counts={'minecraft:apple':2}, inventory=[{'nbt':'private data'}])
        outcome={'status':'succeeded','completionConfirmed':True,'reasoning':'private reasoning',
                 'result':{'unbounded':'x'*20000}}
        self.assertTrue(self.policy.choose(PROPOSAL,self.body,execution=outcome)['ok'])
        state=self.transport.call_args.args[0]['state'];body=state['body']
        self.assertEqual((body['air'],body['maxHp'],body['saturation']),(17,20,0))
        self.assertEqual(body['equipment']['mainhand']['item'],'minecraft:iron_sword')
        self.assertEqual(body['counts'],{'minecraft:apple':2})
        self.assertIs(body['countsTruncated'],False)
        self.assertEqual(state['lastExecution']['status'],'succeeded')
        self.assertNotIn('private',str(state));self.assertNotIn('inventory',body)

    def test_unknown_inventory_and_partial_inventory_are_distinct_from_empty(self):
        self.policy.choose(PROPOSAL,self.body)
        self.assertIsNone(self.transport.call_args.args[0]['state']['body']['counts'])
        self.body['counts']={}
        self.policy.choose(PROPOSAL,self.body)
        self.assertIs(self.transport.call_args.args[0]['state']['body']['countsTruncated'],False)
        self.body['counts']={'minecraft:item_'+str(i):1 for i in range(80)}
        self.body['counts'].update({'minecraft:zz_apple':2,'invalid item':5,'minecraft:nan':float('nan')})
        proposal=copy.deepcopy(PROPOSAL)
        proposal['candidates'][0]['action']={'tool':'eat','args':{'item_id':'minecraft:zz_apple'}}
        self.assertTrue(self.policy.choose(proposal,self.body)['ok'])
        body=self.transport.call_args.args[0]['state']['body']
        self.assertEqual(body['counts']['minecraft:zz_apple'],2)
        self.assertEqual(len(body['counts']),32);self.assertIs(body['countsTruncated'],True)
        self.assertNotIn('invalid item',body['counts'])

    def test_stale_input_or_reply_is_not_executed(self):
        self.now=106
        self.assertFalse(self.policy.choose(PROPOSAL,self.body)['ok']);self.transport.assert_not_called()
        self.now=100
        def slow(payload):self.now=107;return reply()
        self.transport.side_effect=slow
        self.assertFalse(self.policy.choose(PROPOSAL,self.body)['ok'])

    def test_conflicting_outputs_duplicate_candidates_and_host_injection_fail(self):
        for change in [{'action':PROPOSAL['candidates'][0]['action']},{'done':True},{'waitSeconds':15}]:
            with self.assertRaises(SkillError):_validate_result({'memory':{},'choose':PROPOSAL,**change})
        bad=copy.deepcopy(PROPOSAL);bad['candidates'][1]['id']='advance'
        with self.assertRaises(ValueError):validate_choice(bad)
        with self.assertRaises(ValueError):SystemOne('http://outside.example/v1/systemone')


class PolicyControllerTests(unittest.TestCase):
    setUp=fixture.ControllerTests.setUp
    create=fixture.ControllerTests.create
    write=fixture.ControllerTests.write
    job=fixture.ControllerTests.job

    def test_policy_uses_original_lease_dispatch_and_crash_marker(self):
        self.job();self.gateway.body['observedAt']=self.clock()*1000
        self.skills.reply={'choose':PROPOSAL,'action':None,'memory':{},'done':False,'replan':False}
        with patch.object(SystemOne,'_post',return_value=reply()):
            self.assertTrue(self.controller.tick_skill(self.gateway.body))
        self.assertEqual(len(self.gateway.actions),1)
        self.assertEqual(self.gateway.actions[0]['tool'],'goto')
        self.assertTrue(self.gateway.actions[0]['turnId'].startswith('skill-'))
        job=read_json(self.state/'skill-job.json')
        self.assertEqual(job['lastPolicy']['model'],'fixture-decider')
        self.assertFalse(job['lastExecution']['completionConfirmed'])
        self.assertEqual(self.backend.submitted,[])

    def test_policy_outage_replans_without_touching_body_or_disabling_autonomy(self):
        self.job();self.gateway.body['observedAt']=self.clock()*1000
        self.skills.reply={'choose':PROPOSAL,'action':None,'memory':{},'done':False,'replan':False}
        with patch.object(SystemOne,'_post',side_effect=TimeoutError('fixture')):
            self.assertFalse(self.controller.tick_skill(self.gateway.body))
        self.assertEqual(self.gateway.actions,[])
        self.assertEqual(read_json(self.state/'skill-job.json')['status'],'replan')
        self.assertTrue(read_json(self.state/'control.json')['enabled'])
