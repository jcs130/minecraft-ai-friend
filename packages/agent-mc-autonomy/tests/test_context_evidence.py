"""Lossless evidence reuse at the actual full-context controller seam."""
import copy
import dataclasses
import json

import pytest

from agent_mc_autonomy.context import assemble,encode
from agent_mc_autonomy.context_evidence import outcome_message,project_values
from test_controller import action,setup


def outcome(identifier='body-1'):
    return {'tool':'mc_do','execution_id':identifier,'phase':'completed','terminal':True,
            'goal_verified':False,'observation_only':False,'receipt':'唯一完整动作回执。'*300,
            'original_event':{'run':'native-run','cursor':4 if identifier=='body-1' else 5}}


def test_completed_outcome_becomes_immutable_history_once(framework_module,tmp_path,run_async):
    captured=[];published=[]
    async def decide(messages,_):
        captured.append(copy.deepcopy(messages))
        return {'content':'Wait for meaningful evidence','tool_calls':[]}
    module,_,controller=setup(framework_module,tmp_path,decide)
    controller.publish=lambda **value:published.append(value)
    controller.settings=dataclasses.replace(controller.settings,context_mode='full',context_tokens=131072)
    row=outcome();controller.native_outcomes.append(copy.deepcopy(row))
    tools=module.model_tools(controller.bridge.tools,context_mode='full')
    for _ in range(2):run_async(controller.turn_once('survive','stable environment',tools))
    first,second=captured
    # The complete terminal evidence precedes the changing current-state tail.
    sources=[json.loads(m['content']) for m in first[2:-1] if m['role']=='user']
    assert len(sources)==1
    assert sources[0]['native_outcome']==row
    tail=json.loads(first[-1]['content'])
    assert tail['recent_native_outcomes']==[{'context_ref':sources[0]['context_id']}]
    assert next(v['context'] for v in published if 'context' in v)['evidence_reuse']['referenced']==1
    assert second[:len(first)-1]==first[:-1]
    assert len([m for g in controller.groups for m in g if m['role']=='user'])==1
    assert controller.native_outcomes==[row]


def test_distinct_terminal_receipts_keep_both_original_events(framework_module,tmp_path,run_async):
    captured=[]
    async def decide(messages,_):
        captured.append(copy.deepcopy(messages))
        return {'content':'Wait','tool_calls':[]}
    module,_,controller=setup(framework_module,tmp_path,decide)
    controller.settings=dataclasses.replace(controller.settings,context_mode='full',context_tokens=131072)
    controller.native_outcomes.extend([outcome(),outcome('body-2')])
    run_async(controller.turn_once('survive','stable',module.model_tools(controller.bridge.tools)))
    sources=[json.loads(m['content']) for m in captured[0][2:-1] if m['role']=='user']
    assert [m['native_outcome']['execution_id'] for m in sources]==['body-1','body-2']
    assert len({m['context_id'] for m in sources})==2


def test_missing_history_source_keeps_full_outcome_without_dangling_reference():
    row=outcome()
    messages,budget=assemble('stable',[],'survive',{'parts':[]},[],[],
        context_tokens=131072,reserved_output=1024,context_mode='full',native_outcomes=[row])
    assert json.loads(messages[-1]['content'])['recent_native_outcomes']==[row]
    assert budget['history']['included']==0


def test_tool_receipt_duplicates_reuse_exact_text_but_journal_stays_original(framework_module,tmp_path,run_async):
    _,_,controller=setup(framework_module,tmp_path,None)
    controller.settings=dataclasses.replace(controller.settings,context_mode='full')
    text='一条完整中文回执，包含服务端保护原文。'*100
    result={'text':text,'execution':{**action(True),'evidence':{'receipt':text}}}
    original=copy.deepcopy(result)
    view=json.loads(run_async(controller.archive_receipt('request','mc_do',result)))
    assert view['text']==text
    assert view['execution']['id']==result['execution']['id']
    assert view['execution']['evidence']['receipt']=={'context_same_as':'/text'}
    assert view['context_value_refs']=={'/execution/evidence/receipt':'/text'}
    assert len(encode(view).encode())<len(encode(result).encode())*.6
    assert json.loads((tmp_path/'receipts.jsonl').read_text().splitlines()[-1])['result']==original
    assert result==original


def test_window_eviction_restores_original_instead_of_leaving_a_reference():
    row={**outcome(),'receipt':'A short original terminal receipt'}
    source=[outcome_message(row)]
    exchange=[{'role':'assistant','content':'Separate later reasoning with opaque state',
               '_provider_state':{'encrypted':'preserve exactly'}}]
    original=copy.deepcopy([source,exchange])
    _,full=assemble('stable',[],'survive',{'parts':[]},[],original,
        context_tokens=131072,reserved_output=1024,context_mode='full',native_outcomes=[row])
    messages,budget=assemble('stable',[],'survive',{'parts':[]},[],original,
        context_tokens=full['total']-30,reserved_output=1024,context_mode='full',native_outcomes=[row])
    assert budget['history']=={'available':2,'included':1}
    assert json.loads(messages[-1]['content'])['recent_native_outcomes']==[row]
    assert messages[2:-1]==exchange
    assert original==[source,exchange]


def test_unverified_history_marker_never_hides_native_evidence():
    row=outcome()
    message=outcome_message(row)
    marker=json.loads(message['content']);marker['native_outcome']['receipt']='Tampered receipt'
    message['content']=encode(marker)
    messages,_=assemble('stable',[],'survive',{'parts':[]},[],[[message]],
        context_tokens=131072,reserved_output=1024,context_mode='full',native_outcomes=[row])
    assert json.loads(messages[-1]['content'])['recent_native_outcomes']==[row]


@pytest.mark.parametrize('change',['near_match','short','marker_collision','separate_messages'])
def test_only_exact_long_wrapper_copy_is_projected(change):
    text='Complete attributed native evidence. '*40
    value={'text':text,'execution':{'id':'original-id','evidence':{'receipt':text}}}
    if change=='near_match':value['execution']['evidence']['receipt']+=' Different rejection.'
    elif change=='short':value['text']=value['execution']['evidence']['receipt']='short'
    elif change=='marker_collision':value['context_value_refs']={'untrusted':'literal'}
    else:value={'text':text,'events':[{'sender':'A','text':text},{'sender':'B','text':text}]}
    original=copy.deepcopy(value)
    assert project_values(value)==original
    assert value==original


def test_evicted_evidence_is_not_reinserted_every_round(framework_module,tmp_path):
    _,_,controller=setup(framework_module,tmp_path,None)
    controller.settings=dataclasses.replace(controller.settings,context_mode='full',context_tokens=131072)
    controller.native_outcomes=[outcome()]
    controller.freeze_native_history()
    controller.groups=[]  # Actual window retirement does not reset the session.
    controller.freeze_native_history()
    assert controller.groups==[]
    controller.native_outcomes.append(outcome('body-2'))
    controller.freeze_native_history()
    assert len(controller.groups)==1
    assert json.loads(controller.groups[0][0]['content'])['native_outcome']['execution_id']=='body-2'


def test_compact_mode_keeps_existing_projection(framework_module,tmp_path,run_async):
    _,_,controller=setup(framework_module,tmp_path,None)
    controller.native_outcomes=[outcome()]
    controller.freeze_native_history()
    assert controller.groups==[]
    text='Original receipt. '*40
    value={'text':text,'execution':{**action(True),'evidence':{'receipt':text}}}
    view=json.loads(run_async(controller.archive_receipt('request','mc_do',value)))
    assert 'context_value_refs' not in view


def test_full_current_goal_changes_only_the_dynamic_tail():
    history=[[{'role':'assistant','content':'Original complete historical exchange'}]]
    one='Standing goal: 生存\nCurrent user goal (priority over proposed stages): 建家\nHost review proposed stage: 先吃饭'
    two=one.replace('先吃饭','制作工具，再检查实际回执')
    requests=[];budgets=[]
    for goal in (one,two):
        messages,budget=assemble('stable',[],'Goal: '+goal,{'parts':[]},[],history,
            context_tokens=131072,reserved_output=1024,context_mode='full')
        requests.append(messages);budgets.append(budget)
    assert requests[0][:-1]==requests[1][:-1]
    assert json.loads(requests[0][-1]['content'])['current_goal']=='Goal: '+one
    assert json.loads(requests[1][-1]['content'])['current_goal']=='Goal: '+two
    assert budgets[0]['layout']==budgets[1]['layout']
