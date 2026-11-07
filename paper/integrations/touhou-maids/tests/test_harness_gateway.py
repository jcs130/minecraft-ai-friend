import asyncio
import copy
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec=importlib.util.spec_from_file_location('maid_gateway',Path(__file__).parents[1]/'harness/gateway.py')
gateway=importlib.util.module_from_spec(spec);spec.loader.exec_module(gateway)
MAID='bc53b8c1-1fe8-4789-8515-8c90d4dde9d0';OWNER='b48b22fb-2a30-4236-9336-6e9debe5c46d'
CONFIG={'schema':1,'host':'127.0.0.1','port':19087,'token':'test-only-isolated-token-00000000000000',
    'maidId':MAID,'ownerId':OWNER,'hub':{'base_url':'http://127.0.0.1:29150/api/harness'},
    'choices':{'dsh':{'harness_id':'dsh','model':'qa-chat'},'codex':{'harness_id':'codex','model':'qa-responses'}}}
BODY={'model':'qa-chat','messages':[{'role':'system','content':'A synthetic maid.'},{'role':'user','content':'Follow me.'}],
      'tools':[{'type':'function','function':{'name':'switch_follow_state','parameters':{'type':'object','properties':{'follow':{'type':'boolean'}}}}}]}

class HarnessFramesTest(unittest.TestCase):
    def payload(self,texts):
        return {'status':'completed','id':'resp_test','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':text}]} for text in texts]}
    def test_codex_identical_complete_json_frames_are_one_plan_without_reinference(self):
        text='{"content":null,"tool_calls":[{"id":"one","type":"function","function":{"name":"switch_follow_state","arguments":"{\\"follow\\":true}"}}]}'
        original=self.payload([text,text]);normal=gateway.native_plan_payload(original)
        self.assertEqual(len(normal['output']),1);self.assertEqual(len(original['output']),2)
        self.assertEqual(normal['id'],original['id'])
    def test_different_plans_are_never_arbitrarily_selected(self):
        original=self.payload(['{"content":"one","tool_calls":[]}','{"content":"two","tool_calls":[]}'])
        self.assertEqual(gateway.native_plan_payload(original),original)
    def test_fragmented_or_invalid_json_retains_original_strict_decoder(self):
        for texts in [['{"content":','"reply","tool_calls":[]}'],['not json','not json']]:
            original=self.payload(texts);self.assertEqual(gateway.native_plan_payload(original),original)


class GatewayTest(unittest.TestCase):
    def setUp(self):
        self.seen=[];self.answer={'content':None,'tool_calls':[{'id':'call_qa','type':'function','function':{'name':'switch_follow_state','arguments':'{"follow":true}'}}],
            'model_status':{'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}}}
        async def planner(choice,messages,tools):
            self.seen.append((choice,copy.deepcopy(messages),copy.deepcopy(tools)))
            return copy.deepcopy(self.answer)
        self.app=gateway.Gateway(copy.deepcopy(CONFIG),planner)
    def call(self,body=None,maid=MAID,choice='dsh'):
        return asyncio.run(self.app.completion(maid,choice,copy.deepcopy(body or BODY)))
    def test_native_tool_exchange_is_preserved_but_not_executed(self):
        result=self.call();message=result['choices'][0]['message']
        self.assertEqual(message['tool_calls'],self.answer['tool_calls']);self.assertEqual(result['choices'][0]['finish_reason'],'tool_calls')
        self.assertEqual(self.seen[0][1],BODY['messages']);self.assertEqual(self.seen[0][2],BODY['tools'])
        self.assertFalse(self.app.catalogue()['last']['gameActionsExecutedByGateway'])
    def test_native_tool_result_can_continue_to_final_dialogue(self):
        self.call();body=copy.deepcopy(BODY)
        body['messages'] += [{'role':'assistant','content':None,'tool_calls':self.answer['tool_calls']},{'role':'tool','tool_call_id':'call_qa','content':'Native mode changed; movement still needs observation.'}]
        self.answer={'content':'好的，我会跟着你。','tool_calls':[]}
        result=self.call(body);self.assertEqual(result['choices'][0]['message']['content'],'好的，我会跟着你。')
        self.assertEqual(self.seen[-1][1][:-1],body['messages'])
        self.assertEqual(self.seen[-1][1][-1]['role'],'system')
        self.assertIn('Native mode changed',self.seen[-1][1][-1]['content'])
        self.assertIn('not repeat',self.seen[-1][1][-1]['content'])
    def test_returned_native_action_cannot_be_proposed_again_in_same_turn(self):
        body=copy.deepcopy(BODY)
        body['messages'] += [{'role':'assistant','tool_calls':copy.deepcopy(self.answer['tool_calls'])},
            {'role':'tool','tool_call_id':'call_qa','content':'Follow mode enabled'}]
        self.answer['tool_calls'][0]['id']='a_different_id'
        with self.assertRaisesRegex(gateway.Refused,'NATIVE_TOOL_ALREADY_RETURNED_QUERY_STATE'):self.call(body)
        self.assertEqual(len(self.seen),1);self.assertFalse(self.app.active.locked())
    def test_a_new_user_turn_can_request_the_same_native_action(self):
        body=copy.deepcopy(BODY)
        body['messages'] += [{'role':'assistant','tool_calls':copy.deepcopy(self.answer['tool_calls'])},
            {'role':'tool','tool_call_id':'call_qa','content':'Follow mode enabled'},
            {'role':'user','content':'Please follow again after I changed the mode manually.'}]
        self.assertEqual(self.call(body)['choices'][0]['finish_reason'],'tool_calls')
    def test_each_choice_has_its_own_reviewed_model(self):
        body=copy.deepcopy(BODY);body['model']='qa-responses';result=self.call(body,choice='codex')
        self.assertEqual(result['model'],'qa-responses');self.assertEqual(self.seen[0][0]['harness_id'],'codex')
    def test_other_maids_cannot_consume_shared_inference(self):
        with self.assertRaisesRegex(gateway.Refused,'SHARED_MODEL_NOT_ENABLED'):self.call(maid=OWNER)
        self.assertEqual(self.seen,[])
    def test_unknown_choice_and_wrong_model_do_not_call_planner(self):
        with self.assertRaisesRegex(gateway.Refused,'HARNESS_NOT_CONFIGURED'):self.call(choice='invented')
        body=copy.deepcopy(BODY);body['model']='other-model'
        with self.assertRaisesRegex(gateway.Refused,'MODEL_MISMATCH'):self.call(body)
        self.assertEqual(self.seen,[])
    def test_gateway_refuses_a_tool_not_in_native_catalogue(self):
        self.answer['tool_calls'][0]['function']['name']='shell'
        with self.assertRaisesRegex(gateway.Refused,'TOOL_NOT_ADVERTISED'):self.call()
        self.assertFalse(self.app.active.locked())
    def test_duplicate_call_ids_are_refused(self):
        self.answer['tool_calls']*=2
        with self.assertRaisesRegex(gateway.Refused,'CALL_ID_INVALID'):self.call()
    def test_nonfinite_or_nonobject_tool_arguments_are_refused(self):
        for bad in ['[]','{"x":NaN}']:
            self.answer['tool_calls'][0]['function']['arguments']=bad
            with self.assertRaises((ValueError,gateway.Refused)):self.call()
            self.assertFalse(self.app.active.locked())
    def test_bounded_grammar_rejects_streaming_and_bad_catalogue(self):
        for update in [{'stream':True},{'messages':[]},{'messages':[{'role':'operator','content':'x'}]},{'tools':['not-a-tool']}]:
            body={**copy.deepcopy(BODY),**update}
            with self.assertRaises(gateway.Refused):self.call(body)
        self.assertEqual(self.seen,[])
    def test_same_maid_concurrent_request_is_not_queued(self):
        self.app.active.acquire()
        try:
            with self.assertRaisesRegex(gateway.Refused,'BRAIN_BUSY'):self.call()
            self.assertEqual(self.seen,[])
        finally:self.app.active.release()
    def test_exception_releases_transport_without_automatic_retry(self):
        async def failing(*args):self.seen.append('once');raise RuntimeError('provider credential must not leave process')
        self.app.planner=failing
        with self.assertRaises(RuntimeError):self.call()
        self.assertEqual(self.seen,['once']);self.assertFalse(self.app.active.locked())
    def test_catalogue_does_not_publish_private_transport_configuration(self):
        self.call();text=json.dumps(self.app.catalogue())
        for secret in [CONFIG['token'],CONFIG['hub']['base_url'],MAID,OWNER]:self.assertNotIn(secret,text)
    def test_configuration_is_loopback_and_original_identity_only(self):
        for update in [{'host':'0.0.0.0'},{'token':'short'},{'maidId':'feiyu'},{'hub':{'base_url':'https://example.com/api'}}]:
            with self.assertRaises(ValueError):gateway.validate_config({**copy.deepcopy(CONFIG),**update})


class HttpIsolationTest(unittest.TestCase):
    def setUp(self):
        self.count=0
        async def planner(*args):self.count+=1;return {'content':'Synthetic reply','tool_calls':[]}
        self.app=gateway.Gateway(copy.deepcopy(CONFIG),planner)
        config={**CONFIG,'port':0};self.server=gateway.server_for(config,self.app)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(2)
    def request(self,path,body=None,headers=None):
        req=Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization':'Bearer '+CONFIG['token'],'Content-Type':'application/json',**(headers or {})})
        try:
            with urlopen(req,timeout=3) as response:return response.status,json.load(response)
        except HTTPError as error:return error.code,json.load(error)
    def test_real_http_completion_and_catalogue(self):
        status,body=self.request(f'/v1/{MAID}/dsh/chat/completions',BODY)
        self.assertEqual(status,200);self.assertEqual(body['choices'][0]['message']['content'],'Synthetic reply')
        status,body=self.request('/v1/catalogue');self.assertEqual(status,200);self.assertFalse(body['executesGameActions'])
    def test_browser_and_wrong_key_are_refused_before_model(self):
        for header in [{'Authorization':'Bearer wrong'},{'Origin':'http://example.com'},{'Cookie':'website-session=x'},{'Host':'localhost:'+str(self.server.server_port)}]:
            status,_=self.request(f'/v1/{MAID}/dsh/chat/completions',BODY,header)
            self.assertIn(status,[401,403])
        self.assertEqual(self.count,0)
    def test_error_does_not_leak_underlying_provider_text(self):
        async def failing(*args):raise RuntimeError('private-token-never-publish')
        self.app.planner=failing;status,body=self.request(f'/v1/{MAID}/dsh/chat/completions',BODY)
        self.assertEqual(status,502);self.assertNotIn('private-token',json.dumps(body))


if __name__=='__main__':unittest.main()
