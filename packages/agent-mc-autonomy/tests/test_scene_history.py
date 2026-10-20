"""Complete input/reply exchanges keep an append-only, lossless cache prefix."""
import copy
import dataclasses
import json

import pytest
from test_controller import setup

from agent_mc_autonomy.context import assemble


def test_dated_read_answers_reuse_exact_values_and_rebase_after_eviction():
    from agent_mc_autonomy.scene_history import capture_scene
    answers = [{'tool': 'mc_bag', 'arguments': {}, 'fresh': False,
                'answer': {'text': 'Original full inventory. ' * 50}, 'request_id': 'original-read'}]
    options = dict(context_tokens=131072, reserved_output=8192, context_mode='full', answered_reads=answers)
    first, _ = assemble('rules', [], 'survive', {'parts': []}, [], [], **options)
    previous = capture_scene(first)
    second, _ = assemble('rules', [], 'survive', {'parts': []}, [], [[previous]], **options)
    assert json.loads(second[-1]['content'])['answered_reads']['pointer'] == '/answered_reads'
    restored = capture_scene(second)
    assert json.loads(restored['content'])['answered_reads'] == answers
    retired, _ = assemble('rules', [], 'survive', {'parts': []}, [], [[restored]], **options)
    assert json.loads(capture_scene(retired)['content'])['answered_reads'] == answers
    assert answers[0]['fresh'] is False


def test_full_controller_preserves_the_actual_input_scene(framework_module, tmp_path, run_async):
    captured = []

    async def decide(messages, _):
        captured.append(copy.deepcopy(messages))
        return {'content': 'A bounded next plan', 'tool_calls': []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode='full', context_tokens=131072)
    for _ in range(2):
        run_async(controller.turn_once('survive', 'body', module.model_tools(bridge.tools)))
    assert captured[1][:len(captured[0])] == captured[0]
    first = json.loads(controller.groups[0][0]['content'])
    assert first['kind'] == 'agent_mc_scene/v1' and first['current_facts']
    assert controller.groups[0][1]['role'] == 'assistant'


def test_unchanged_values_are_reused_without_dangling_after_retirement():
    from agent_mc_autonomy.scene_history import capture_scene
    facts = {'parts': [{'key':'inventoryIds', 'text':'原始背包资料' * 500, 'original':'immutable:inventory'},
                       {'key':'body', 'text':'health 20 ' * 100}]}
    opts = dict(context_tokens=131072, reserved_output=8192, context_mode='full')
    first, _ = assemble('rules', [], 'survive', facts, [], [], **opts)
    original = capture_scene(first)
    second, budget = assemble('rules', [], 'survive', facts, [], [[original]], **opts)
    tail = json.loads(second[-1]['content'])
    assert tail['current_facts'][0]['context_ref'] == json.loads(original['content'])['context_id']
    assert tail['current_facts'][1] == facts['parts'][1]
    assert budget['scene_reuse']['reused_fields'] >= 1
    restored = capture_scene(second)
    assert json.loads(restored['content'])['current_facts'] == facts['parts']
    # The source was retired. Re-projecting from the complete retained snapshot
    # must materialize it, not emit a reference to the vanished first scene.
    third, _ = assemble('rules', [], 'survive', facts, [], [[restored]], **opts)
    prior = json.loads(third[2]['content'])
    assert prior['current_facts'][0] == facts['parts'][0]


def test_chat_actor_metadata_and_changed_facts_remain_literal():
    from agent_mc_autonomy.scene_history import capture_scene
    events = [{'run':'r', 'cursor':i, 'senderKey':who, 'text':'相同的私聊内容'} for i,who in [(1,'A'),(2,'B')]]
    opts = dict(context_tokens=131072, reserved_output=8192, context_mode='full')
    first, _ = assemble('rules', [], 'survive', {'parts':[{'key':'inventoryIds','text':'old' * 1000}]}, events, [], **opts)
    second, _ = assemble('rules', [], 'survive', {'parts':[{'key':'inventoryIds','text':'new' * 1000}]}, events, [[capture_scene(first)]], **opts)
    value=json.loads(capture_scene(second)['content'])
    assert value['events'] == events and value['current_facts'][0]['text'] == 'new' * 1000


def test_image_parts_stay_intact_but_are_not_replayed_as_current_frames():
    from agent_mc_autonomy.scene_history import (
        capture_scene,
        make_scene,
        project_messages,
    )
    scene=make_scene({'current_facts':[], 'events':[]})
    image={'type':'image_url','image_url':{'url':'data:image/png;base64,YQ=='}}
    messages=[{'role':'user','content':[{'type':'text','text':json.dumps(scene)},image]}]
    projected,_=project_messages(messages)
    assert projected[0]['content'][1] == image
    captured=capture_scene(projected)
    assert isinstance(captured['content'], str) and json.loads(captured['content']) == scene


def test_ninfer_full_scene_routes_retain_real_prompt_end_anchors():
    from agent_mc_autonomy.model_config import HttpPlannerConfig
    from agent_mc_autonomy.model_protocols import request
    opts=dict(context_tokens=131072,reserved_output=8192,context_mode='full')
    messages,_=assemble('rules',[],'survive',{'parts':[]},[],[],**opts)
    config=HttpPlannerConfig.parse({'model':'chosen','base_url':'http://127.0.0.1:8000/v1',
                                   'auth':{'mode':'none'},'cache_strategy':'ninfer'})
    wire=request(config,messages,[],2048)[1]
    assert wire['prompt_cache_options'] == {'mode':'implicit'} and wire['prompt_cache_key']


def test_persona_switch_retires_selected_private_memory_without_touching_native_work(framework_module, tmp_path):
    _,_,controller=setup(framework_module,tmp_path,None)
    controller.settings=dataclasses.replace(controller.settings,context_mode='full')
    old={'stable':{'agent_name':'first','persona':'first private identity'},'dynamic':{}}
    controller.synchronize_host_history(old)
    controller.groups=[[{'role':'user','content':'selected private memory'}]]
    controller.pending={('task','owned'): {'id':'owned','phase':'running'}}
    controller.synchronize_host_history({'stable':{'agent_name':'second','persona':'second identity'},'dynamic':{}})
    assert controller.groups == []
    assert controller.pending == {('task','owned'): {'id':'owned','phase':'running'}}


@pytest.mark.parametrize('rejected', [False, True])
def test_native_action_and_validation_rejection_keep_their_input_exchange(framework_module, tmp_path, run_async, rejected):
    from test_controller import choose

    async def decide(*_):
        response=choose()
        if rejected:
            response['tool_calls'][0]['function']['name']='not_a_tool'
        return response

    module,bridge,controller=setup(framework_module,tmp_path,decide)
    controller.settings=dataclasses.replace(controller.settings,context_mode='full')
    run_async(controller.turn_once('survive','body',module.model_tools(bridge.tools)))
    group=controller.groups[-1]
    assert json.loads(group[0]['content'])['kind']=='agent_mc_scene/v1'
    assert group[1]['role']=='assistant' and group[-1]['role']=='tool'
    if rejected:
        assert json.loads(group[-1]['content'])['dispatched'] is False
