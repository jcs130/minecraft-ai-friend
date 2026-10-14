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
