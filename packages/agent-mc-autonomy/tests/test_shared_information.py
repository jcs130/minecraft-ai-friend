import json

import pytest

from agent_mc_autonomy.controller import model_tools, observation_call
from agent_mc_autonomy.tool_schema import provider_schema
from test_controller import setup


HELP = {'name': 'mc_tool_help', 'description': 'Shared core progressive schema discovery',
        'inputSchema': {'type': 'object', 'additionalProperties': False, 'properties': {
            'name': {'type': 'string', 'minLength': 1}, 'path': {'type': 'string'}, 'full': {'type': 'boolean'}}},
        '_meta': {'agent-mc/v1': {'tags': ['read']}}}
MESSAGES = {'name': 'mc_messages', 'description': 'Shared received message history',
            'inputSchema': {'type': 'object', 'properties': {'action': {'enum': ['list', 'search', 'read', 'review']}}},
            '_meta': {'agent-mc/v1': {'tags': ['read', 'write']}}}


def test_uses_shared_help_contract_instead_of_shadowing_it():
    tools = model_tools([HELP, MESSAGES])
    help_tools = [t['function'] for t in tools if t['function']['name'] == 'mc_tool_help']
    assert len(help_tools) == 1
    assert help_tools[0]['parameters'] == provider_schema(HELP['inputSchema'])
    assert any(t['function']['name'] == 'mc_messages' for t in tools)


def test_shared_help_is_dispatched_to_the_core_with_original_arguments(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.extend([HELP, MESSAGES])
    original_call = bridge.call
    received = []
    reply = {'protocol': 'agent-mc-tool-help/v1', 'name': 'mc_messages', 'path': '',
             'schema': MESSAGES['inputSchema'], 'complete': True}

    async def call(name, arguments, **kwargs):
        if name == 'mc_tool_help':
            received.append((name, arguments))
            return {'structuredContent': {'protocol': 'agent-mc/v1', 'text': json.dumps(reply)}}
        return await original_call(name, arguments, **kwargs)

    bridge.call = call
    arguments = {'name': 'mc_messages', 'full': True}
    result, _ = run_async(controller.dispatch('mc_tool_help', arguments, 'request-help'))
    assert received == [('mc_tool_help', arguments)]
    assert json.loads(result['text']) == reply
    assert controller.inflight_request is None and not controller.pending


@pytest.mark.parametrize('action', ['list', 'search', 'read', 'review'])
def test_message_queries_and_consideration_are_not_body_progress(action):
    assert observation_call('mc_messages', {'action': action})


def test_message_read_preserves_read_activity_and_does_not_claim_body_progress(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append(MESSAGES)
    original_call = bridge.call
    controller.read_activity = {'mc_scout': 3}

    async def call(name, arguments, **kwargs):
        if name == 'mc_messages':
            return {'structuredContent': {'protocol': 'agent-mc/v1', 'text': 'historical server denial, not current permission'}}
        return await original_call(name, arguments, **kwargs)

    bridge.call = call
    run_async(controller.execute_model_call('mc_messages', {'action': 'list'}))
    assert controller.read_activity == {'mc_scout': 3, 'mc_messages': 1}
    assert not controller.native_outcomes and not controller.pending


@pytest.mark.parametrize('shared, expected', [(True, '/properties/steps'), (False, '/inputSchema/properties/steps')])
def test_failure_recovery_uses_the_advertised_help_pointer_root(shared, expected):
    from agent_mc_autonomy.controller import failure_context
    catalogue = [{'name': 'mc_do', 'inputSchema': {'type': 'object', 'properties': {
        'steps': {'type': 'array', 'items': {'type': 'object'}}}}}]
    if shared:
        catalogue.append(HELP)
    notice = failure_context(catalogue, 'mc_do', {'steps': '[]'}, {'failed': True, 'text': 'invalid steps'})
    assert notice['parameter_help']['steps']['schema']['arguments']['path'] == expected


def test_review_counts_shared_message_queries_as_reads():
    from agent_mc_autonomy.review import review_observation, summary
    from test_review import snapshot
    evidence = review_observation(snapshot(10000, read_activity={'mc_messages': 4}), 10000)['evidence']
    assert evidence['read_activity']['mc_messages'] == 4
    assert '连续查询4次' in summary(evidence)


def test_shared_help_does_not_expose_coordinator_controls(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.extend([HELP, {'name': 'mc_control', 'inputSchema': {'type': 'object'}}])
    result, _ = run_async(controller.dispatch('mc_tool_help', {'name': 'mc_control', 'full': True}, 'hidden-help'))
    assert result['failed'] and result['dispatched'] is False
    assert not controller.pending and not controller.inflight_request
    assert not any(name == 'mc_tool_help' for name, _, _ in bridge.calls)


def test_consideration_acknowledges_native_barrier_without_claiming_body_progress(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append(MESSAGES)
    controller.turn = 'current-turn'
    controller.read_activity = {'mc_scout': 3}
    original_call = bridge.call

    async def call(name, arguments, **kwargs):
        if name == 'mc_messages':
            return {'structuredContent': {'protocol': 'agent-mc/v1', 'text': 'marked considered, no action or goal completion',
                    'control': {'requestId': kwargs['request_id'], 'barrierAfter': True, 'endTurnRequested': False}}}
        return await original_call(name, arguments, **kwargs)

    bridge.call = call
    run_async(controller.execute_model_call('mc_messages', {'action': 'review', 'ids': ['message-1']}))
    assert controller.read_activity == {'mc_scout': 3, 'mc_messages': 1}
    assert not controller.native_outcomes and not controller.pending and not controller.inflight_request
    assert any(name == 'mc_protocol' and arguments['action'] == 'ack_barrier'
               for name, arguments, _ in bridge.calls)


def test_shared_message_index_is_at_dynamic_tail_and_visible_to_review():
    from agent_mc_autonomy.context import assemble
    from agent_mc_autonomy.review import review_observation
    from test_review import snapshot
    index = {'key': 'messages', 'text': '[received] historical server message-7; mc_messages read by id',
             'original': 'log:messages'}
    facts = {'parts': [{'key': 'body', 'text': 'health=20 food=18'}, index,
                      {'key': 'gear', 'text': 'wooden_pickaxe=1'},
                      {'key': 'lastTask', 'text': 'observed voxels ' * 4000, 'original': 'log:scout'}]}
    messages, budget = assemble('stable personality and rules', [], 'survive', facts, [], [],
                                context_tokens=16000, reserved_output=2048)
    assert 'message-7' not in messages[0]['content']
    assert index in json.loads(messages[-1]['content'])['current_facts']
    assert budget['total'] <= 16000
    first = review_observation(snapshot(10000, facts=facts), 10000)
    facts['parts'][1] = {**index, 'text': '[received] message-8; mc_messages read by id'}
    second = review_observation(snapshot(10000, facts=facts), 10000)
    assert 'message-7' in first['evidence']['facts']['messages']
    assert first['evidence']['fact_originals']['messages'] == 'log:messages'
    assert first['material'] == second['material'], 'ordinary chat must not manufacture a material body change'
