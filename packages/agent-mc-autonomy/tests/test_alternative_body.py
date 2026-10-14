import dataclasses
import json
from types import SimpleNamespace

import pytest

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.controller import Controller, fact_fingerprint, hidden_tools, model_tools
from agent_mc_autonomy.fast import focus_state, rule_focus

PROTOCOL='agent-mc/v1'

def catalogue():
    return [
        {'name':'mc_do','description':'One operation with its stable action_id, operation and args.',
         'inputSchema':{'type':'object','properties':{'action_id':{'type':'string'},'operation':{'type':'string'},'args':{'type':'object'}},'required':['action_id','operation'],'additionalProperties':False},
         '_meta':{PROTOCOL:{'tags':['act']}}},
        {'name':'mc_state','inputSchema':{'type':'object','properties':{},'additionalProperties':False},'_meta':{PROTOCOL:{'tags':['read','snapshot']}}},
    ]

def test_operation_schema_keeps_its_real_envelope_without_steps_or_queue():
    tool=next(t['function'] for t in model_tools(catalogue()) if t['function']['name']=='mc_do')
    assert set(tool['parameters']['properties'])=={'action_id','operation','args'}
    assert tool['parameters']['required']==['action_id','operation']
    assert 'action_id' in tool['description'] and 'Steps run' not in tool['description']


def test_operation_context_cannot_instruct_an_unavailable_vanilla_queue():
    from agent_mc_autonomy.context import assemble
    messages,_=assemble('native host',model_tools(catalogue()),'craft',{'parts':[]},[],[],context_tokens=32768,reserved_output=1024)
    rules=messages[0]['content']
    assert 'mc_do {action_id,operation,args}' in rules
    assert 'prefer skill:craft' not in rules and 'default to queue:append' not in rules
    assert 'headless build' not in rules
    steps=[{'name':'mc_do','inputSchema':{'type':'object','properties':{'steps':{'type':'array'}},'required':['steps']}}]
    messages,_=assemble('vanilla host',model_tools(steps),'craft',{'parts':[]},[],[],context_tokens=32768,reserved_output=1024)
    assert 'prefer skill:craft' in messages[0]['content'] and 'default to queue:append' in messages[0]['content']


def test_operation_reads_and_receipts_are_direct_with_original_validation(tmp_path):
    reads=[{'name':name,'inputSchema':{'type':'object','properties':{'action_id':{'type':'string'}},'required':['action_id'],'additionalProperties':False},
            '_meta':{PROTOCOL:{'tags':['read']}}} for name in ('mc_read','mc_result','mc_wait')]
    tools=model_tools([*catalogue(),*reads])
    visible={t['function']['name'] for t in tools}
    assert {'mc_read','mc_result','mc_wait'}<=visible
    advanced=next(t for t in tools if t['function']['name']=='mc_invoke')['function']['parameters']['properties']['name']['enum']
    assert not {'mc_read','mc_result','mc_wait'} & set(advanced)
    controller=Controller(SimpleNamespace(tools=[*catalogue(),*reads]),None,Settings(),tmp_path,lambda **_:None,lambda:False)
    assert controller.immediate_read('mc_wait') is False
    call={'id':'receipt','function':{'name':'mc_result','arguments':json.dumps({'action_id':'original'})}}
    _,name,args=controller.prepare_call([call],tools)
    assert name=='mc_result' and args=={'action_id':'original'}
    from agent_mc_autonomy.controller import ModelCallRejected
    call['function']['arguments']=json.dumps({'wrong':'original'})
    with pytest.raises(ModelCallRejected,match='Invalid arguments'):
        controller.prepare_call([call],tools)

def test_operation_dispatch_does_not_inject_a_vanilla_queue(tmp_path,run_async):
    calls=[]
    class Bridge:
        tools=catalogue()
        async def call(self,name,args,**context):
            calls.append((name,args))
            return {'structuredContent':{'protocol':PROTOCOL,'text':'observed','execution':{'kind':'task','id':args['action_id'],'phase':'completed','terminal':True,'goalCompleted':False}}}
    settings=Settings()
    controller=Controller(Bridge(),None,settings,tmp_path,lambda **_:None,lambda:False)
    run_async(controller.execute_model_call('mc_do',{'action_id':'one','operation':'baritone.goto','args':{'position':{'x':8,'y':64,'z':0}}}))
    assert calls==[('mc_do',{'action_id':'one','operation':'baritone.goto','args':{'position':{'x':8,'y':64,'z':0}}})]

def test_insert_waits_for_original_operation_instead_of_assuming_a_native_checkpoint(tmp_path):
    controller=Controller(SimpleNamespace(tools=catalogue()),None,Settings(),tmp_path,lambda **_:None,lambda:False)
    controller.active_goal={'id':'inserted','mode':'insert'}
    controller.pending={('task','old'):{'kind':'task','id':'old'}}
    controller.action_owners={('task','old'):'previous'}
    assert controller.current_work() is True
    assert controller.immediate_read('mc_state') is True

def test_structured_body_focus_and_clock_independent_change_detection():
    def facts(at,health):return {'parts':[{'key':'native.body','text':json.dumps({'bodyId':'one','capturedAt':at,'health':health,'hunger':20,'position':{'x':0,'y':64,'z':0}})}]}
    before=facts('2026-10-14T00:00:00Z',20)
    assert fact_fingerprint(before)==fact_fingerprint(facts('2026-10-14T00:00:01Z',20))
    assert fact_fingerprint(before)!=fact_fingerprint(facts('2026-10-14T00:00:01Z',4))
    assert rule_focus(focus_state('survive',facts('2026-10-14T00:00:02Z',4),{}))=='survival'

def test_explicit_body_config_is_passed_unchanged_without_server_adapter_imports(tmp_path):
    file=tmp_path/'body.json';body={'provider':'java-client','expectedUuid':'body','dataDir':str(tmp_path/'harness'),'ledgerDir':str(tmp_path/'ledger'),'credentialsFile':str(tmp_path/'private.json')}
    file.write_text(json.dumps(body),encoding='utf-8')
    settings=dataclasses.replace(Settings(),host='server.example',username='Example',body_config_file=str(file))
    assert settings.client_config(tmp_path)==body
    assert settings.identity!=dataclasses.replace(settings,body_config_file='').identity
    with pytest.raises(ValueError,match='viewer'):
        dataclasses.replace(settings,viewer_renderer_directory=str(tmp_path)).client_config(tmp_path)

def test_control_is_claimed_only_when_discovered_and_exposes_expiry(tmp_path,run_async):
    calls=[]
    class Bridge:
        tools=[{'name':'mc_control','inputSchema':{'type':'object','properties':{'action':{'enum':['claim','stop','release']}},'required':['action']},'_meta':{PROTOCOL:{'tags':['act']}}}]
        async def call(self,name,args,**context):
            calls.append((name,args))
            return {'structuredContent':{'protocol':PROTOCOL,'text':json.dumps({'ok':True,'expiresAt':1900000000000})}}
    controller=Controller(Bridge(),None,Settings(),tmp_path,lambda **_:None,lambda:False)
    run_async(controller.claim_discovered_control())
    assert calls==[('mc_control',{'action':'claim'})]
    assert controller.control_expires_at==1900000000000


def test_long_inference_renews_discovered_lease_before_original_mutation(tmp_path,run_async):
    calls=[]
    class Bridge:
        tools=[*catalogue(),{'name':'mc_control','inputSchema':{'type':'object','properties':{'action':{'enum':['claim']}},'required':['action']}}]
        async def call(self,name,args,**kwargs):
            calls.append((name,args))
            return {'structuredContent':{'protocol':PROTOCOL,'text':json.dumps({'ok':True,'expiresAt':1900000000000})}}
    controller=Controller(Bridge(),None,Settings(),tmp_path,lambda **_:None,lambda:False)
    controller.control_expires_at=1
    action={'action_id':'original','operation':'body.move','args':{}}
    run_async(controller.execute_model_call('mc_do',action))
    assert calls==[('mc_control',{'action':'claim'}),('mc_do',action)]
    assert controller.control_expires_at==1900000000000


def test_operation_backend_observation_does_not_call_a_nonexistent_queue(tmp_path,run_async):
    calls=[]
    published=[]
    class Bridge:
        tools=catalogue()
        async def call(self,name,args,**context):
            calls.append(name)
            assert name=='mc_protocol'
            return {'content':[{'type':'text','text':json.dumps({'parts':[]})}]}
    controller=Controller(Bridge(),None,Settings(),tmp_path,lambda **value:published.append(value),lambda:False)
    async def refresh():calls.append('state_refresh')
    controller.refresh_discovered_state=refresh
    controller.pending={('task','original'):{'kind':'task','id':'original'}}
    run_async(controller.observe_queue())
    assert calls==['state_refresh','mc_protocol']
    assert published[0]['native_queue']=={'supported':False,'source':'original_action_receipts','pending':[{'kind':'task','id':'original'}]}


def test_visual_discovery_keeps_the_default_backend_policy():
    assert 'mc_visual' not in hidden_tools(catalogue())
    steps=[{'name':'mc_do','inputSchema':{'properties':{'steps':{'type':'array'}}}}]
    assert 'mc_visual' in hidden_tools(steps)


def test_operation_goal_prompt_preserves_authority_without_promising_a_queue(tmp_path):
    controller=Controller(SimpleNamespace(tools=catalogue()),None,Settings(),tmp_path,lambda **_:None,lambda:False)
    controller.active_goal={'id':'goal','goal':'reach home','origin':'user','mode':'insert'}
    controller.feedback_pending=True
    prompt=controller.goal_prompt('survive')
    assert 'Current user goal' in prompt
    assert 'original action terminal' in prompt
    assert 'native queue policy' not in prompt


def test_operation_shutdown_resolves_only_original_confirmed_terminal_receipts(tmp_path,run_async):
    calls=[]
    class Bridge:
        tools=[*catalogue(),{'name':'mc_stop'},{'name':'mc_result'}]
        async def call(self,name,args,**kwargs):
            calls.append((name,args))
            return {'structuredContent':{'protocol':PROTOCOL,'text':'receipt','execution':{'kind':'task','id':'original','terminal':True,'phase':'cancelled'}}}
    controller=Controller(Bridge(),None,Settings(),tmp_path,lambda **_:None,lambda:False)
    controller.pending={('task','original'):{'kind':'task','id':'original'}}
    run_async(controller.finish_operation_receipts())
    assert calls==[('mc_stop',{}),('mc_result',{'action_id':'original'})]
    assert not controller.pending
    assert json.loads(controller.state_path.read_text())['pending']==[]


def test_operation_disconnect_cannot_erase_unknown_or_still_running_action(tmp_path,run_async):
    calls=[]
    class Bridge:
        tools=[*catalogue(),{'name':'mc_stop'},{'name':'mc_result'}]
        async def call(self,name,args,**kwargs):
            calls.append((name,args))
            return {'structuredContent':{'protocol':PROTOCOL,'text':'still running','execution':{'kind':'task','id':'original','terminal':False,'phase':'accepted'}}}
    controller=Controller(Bridge(),None,Settings(),tmp_path,lambda **_:None,lambda:False)
    controller.pending={('task','original'):{'kind':'task','id':'original'}}
    run_async(controller.finish_operation_receipts())
    state=json.loads(controller.state_path.read_text())
    assert state['uncertain'] is True and state['pending'][0]['id']=='original'
    assert not any(name=='mc_do' for name,args in calls)
