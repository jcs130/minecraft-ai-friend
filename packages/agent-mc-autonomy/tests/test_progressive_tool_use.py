"""Successful reads must not inherit stale validation failures or hidden schemas."""
import copy
import dataclasses
import json

import pytest

from test_controller import Bridge, setup


API = {
    'name': 'mc_world_api', 'description': 'Inspect own world progress on demand.',
    'inputSchema': {'type': 'object', 'additionalProperties': False,
                    'properties': {'operation': {'enum': ['status', 'quest.show', 'claim']},
                                   'id': {'type': 'string'}}, 'required': ['operation'],
                    'allOf': [{'if': {'properties': {'operation': {'const': 'quest.show'}}},
                               'then': {'required': ['id']}}]},
    '_meta': {'agent-mc/v1': {'tags': ['read', 'act']}},
}


def call(operation, **arguments):
    return [{'id': 'model-call', 'type': 'function', 'function': {
        'name': 'mc_invoke', 'arguments': json.dumps({'name': API['name'], 'arguments': {
            'operation': operation, **arguments}})}}]


def fixture(module, tmp_path):
    runtime, bridge, controller = setup(module, tmp_path, None)
    bridge.tools += [copy.deepcopy(API), {'name': 'mc_tool_help', 'inputSchema': {
        'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']}}]
    original = bridge.call

    async def perform(name, args, **kwargs):
        if name == 'mc_tool_help':
            bridge.calls.append((name, args, kwargs))
            tool = next(t for t in bridge.tools if t['name'] == args['name'])
            return {'structuredContent': {'protocol': 'agent-mc/v1', 'text': json.dumps(tool)}}
        if name == API['name']:
            bridge.calls.append((name, args, kwargs))
            return {'structuredContent': {'protocol': 'agent-mc/v1', 'failed': False,
                'text': 'status: ok', 'data': {'response': {'status': 'ok', 'level': 1}},
                'meta': {'readAccess': {'protocol': 'agent-mc-read-access/v1', 'readOnly': True}}}}
        return await original(name, args, **kwargs)

    bridge.call = perform
    controller.turn = 'turn-1'
    return runtime, bridge, controller


def test_corrected_synchronous_query_resolves_only_its_schema_rejection(framework_module, tmp_path, run_async):
    module, bridge, controller = fixture(framework_module, tmp_path)
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_calls(call('status.get'), module.model_tools(bridge.tools))
    assert controller.tool_failure and not bridge.calls
    result, _, _ = run_async(controller.execute_model_call(API['name'], {'operation': 'status'}))
    assert result['failed'] is False
    assert controller.tool_failure is None, 'A successful native read must not remain labelled as the previous invalid operation'


def test_another_valid_operation_does_not_resolve_a_specific_invalid_quest(framework_module, tmp_path, run_async):
    module, bridge, controller = fixture(framework_module, tmp_path)
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_calls(call('quest.show'), module.model_tools(bridge.tools))
    failure = copy.deepcopy(controller.tool_failure)
    run_async(controller.execute_model_call(API['name'], {'operation': 'status'}))
    assert controller.tool_failure == failure
    run_async(controller.execute_model_call(API['name'], {'operation': 'quest.show', 'id': 'observed-id'}))
    assert controller.tool_failure is None


def test_schema_repair_does_not_erase_an_unresolved_body_failure(framework_module, tmp_path, run_async):
    module, bridge, controller = fixture(framework_module, tmp_path)
    body = {'tool': 'mc_do', 'error': 'Protected target was not changed', 'observation_only': False,
            'native_execution': {'kind': 'task', 'id': 'body:1', 'phase': 'blocked'},
            'receipt': {'request_id': 'original-body-request', 'archive': 'receipts.jsonl'}}
    controller.tool_failure = copy.deepcopy(body)
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_calls(call('status.get'), module.model_tools(bridge.tools))
    assert controller.tool_failure.get('native_execution') == body['native_execution']
    run_async(controller.execute_model_call(API['name'], {'operation': 'status'}))
    assert controller.tool_failure['native_execution'] == body['native_execution']
    assert controller.tool_failure['receipt'] == body['receipt']


def test_help_exposes_only_the_requested_native_tool_across_rounds(framework_module, tmp_path, run_async):
    module, bridge, controller = fixture(framework_module, tmp_path)
    unseen = {**copy.deepcopy(API), 'name': 'mc_unrequested_api'}
    bridge.tools.append(unseen)
    observed = []

    async def decide(messages, tools):
        observed.append({t['function']['name'] for t in tools})
        if len(observed) == 1:
            return {'content': '', 'tool_calls': [{'id': 'help', 'type': 'function', 'function': {
                'name': 'mc_tool_help', 'arguments': json.dumps({'name': API['name']})}}]}
        return {'content': 'The requested schema is now available.', 'tool_calls': []}

    controller.decide = decide
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=2)
    controller.turn = None
    run_async(controller.turn_once('Read a quest', 'short world entry', module.model_tools(bridge.tools)))
    assert API['name'] not in observed[0]
    assert API['name'] in observed[1]
    assert unseen['name'] not in observed[1]
    assert 'mc_invoke' in observed[1], 'Previously returned invocation links remain compatible'


def test_large_typed_receipt_keeps_result_and_native_identity_instead_of_only_chat_text(framework_module, tmp_path, run_async):
    _, bridge, controller = fixture(framework_module, tmp_path)
    original = {'failed': False, 'text': 'Command sent; this is only queue acceptance.' * 250,
        'execution': {'kind': 'task', 'id': 'body:1', 'phase': 'accepted', 'terminal': False, 'goalCompleted': False},
        'data': {'status': 'accepted', 'serverReceipt': {'schemaVersion': 1, 'requestId': 'native-original',
            'bodyId': 'own-body', 'observedAt': '2026-10-30T00:00:00Z', 'status': 'completed',
            'ok': True, 'outcomeKnown': True, 'goalCompleted': False,
            'data': {'items': [{'id': str(i), 'description': 'Long optional item description ' * 100} for i in range(20)]}}}}
    preview = json.loads(run_async(controller.archive_receipt('outer-original', API['name'], original)))
    result = preview['data']['serverReceipt']
    assert result['ok'] is True and result['status'] == 'completed'
    assert result['requestId'] == 'native-original' and result['outcomeKnown'] is True
    assert preview['execution'] == original['execution']
    assert preview['preview']['complete'] is False and preview['preview']['omitted']
    assert len(json.dumps(preview, ensure_ascii=False).encode()) < 6500
    assert json.loads(''.join(bridge.artifacts)) == original


def test_unknown_typed_write_is_not_projected_into_success(framework_module, tmp_path, run_async):
    _, _, controller = fixture(framework_module, tmp_path)
    original = {'failed': True, 'text': 'large ' * 2000,
        'data': {'status': 'unknown', 'serverReceipt': {'requestId': 'original', 'outcomeKnown': False,
            'status': 'unknown', 'changed': None, 'details': 'many ' * 2000}}}
    preview = json.loads(run_async(controller.archive_receipt('req', API['name'], original)))
    assert preview['data']['status'] == 'unknown'
    assert preview['data']['serverReceipt']['outcomeKnown'] is False
    assert preview['data']['serverReceipt']['changed'] is None
    assert preview['failed'] is True


def test_runtime_efficiency_counts_attempts_and_reads_without_certifying_a_goal(framework_module, tmp_path, run_async):
    module, bridge, controller = fixture(framework_module, tmp_path)
    replies = iter([call('status.get'), call('status')])

    async def decide(*_):
        return {'content': '', 'tool_calls': next(replies)}

    controller.decide = decide
    controller.turn = None
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once('Inspect the real status', 'short entry', tools))
    run_async(controller.turn_once('Inspect the real status', 'short entry', tools))
    counter = controller.efficiency
    assert counter['model_requests'] == counter['proposed_tool_calls'] == 2
    assert counter['executed_tool_calls'] == counter['validation_rejections'] == 1
    assert counter['successful_read_calls'] == counter['resolved_schema_failures'] == 1
    assert counter['accepted_native_tasks'] == counter['observed_body_change_samples'] == 0
    assert counter['goal_verified'] is False


def test_requested_schema_set_is_bounded_and_reset_with_body_identity(framework_module, tmp_path):
    _, bridge, controller = fixture(framework_module, tmp_path)
    for i in range(6):
        name = f'mc_api_{i}'
        bridge.tools.append({**copy.deepcopy(API), 'name': name})
        controller.discover_requested_tool('mc_tool_help', {'name': name}, {'failed': False})
    assert controller.discovered_tools == [f'mc_api_{i}' for i in range(2, 6)]
    controller.discover_requested_tool('mc_tool_help', {'name': 'mc_connection'}, {'failed': False})
    assert 'mc_connection' not in controller.discovered_tools
    controller.game_scope = 'previous-world'
    controller.observe_game_facts({'parts': []})
    assert controller.discovered_tools == []


def test_successful_explicit_invoke_read_discovers_the_same_native_schema(framework_module, tmp_path, run_async):
    module, bridge, controller = fixture(framework_module, tmp_path)
    tools = module.model_tools(bridge.tools)
    _, name, args = controller.prepare_call(call('status'), tools)
    run_async(controller.execute_model_call(name, args))
    assert controller.discovered_tools == [API['name']]
    exposed = module.model_tools(bridge.tools, exposed_tools=controller.discovered_tools)
    direct = [{'id': 'next', 'type': 'function', 'function': {
        'name': API['name'], 'arguments': json.dumps({'operation': 'status'})}}]
    assert controller.prepare_call(direct, exposed)[1] == API['name']
    controller.discover_requested_tool(API['name'], {'operation': 'status'}, {'failed': True})
    assert controller.discovered_tools == [API['name']]


def test_valid_read_does_not_claim_a_native_business_refusal_was_repaired(framework_module, tmp_path, run_async):
    _, _, controller = fixture(framework_module, tmp_path)
    controller.record_tool_failure(API['name'], {'operation': 'claim'}, {
        'failed': True, 'text': 'Reward unavailable until the quest is completed.'}, 'original-refusal')
    before = copy.deepcopy(controller.tool_failure)
    run_async(controller.execute_model_call(API['name'], {'operation': 'status'}))
    assert controller.tool_failure == before


def test_compact_schema_retains_native_coordinate_semantics_without_rewriting_arguments(framework_module, tmp_path):
    module, bridge, controller = fixture(framework_module, tmp_path)
    coordinate_doc = ('Applicable native action parameters. ' * 9
                      + 'Coordinates are absolute; relative components require ~offset. Never change a supplied coordinate.')
    bridge.tools[0]['inputSchema'] = {'type': 'object', 'properties': {'steps': {
        'type': 'array', 'items': {'type': 'object', 'properties': {
            'skill': {'enum': ['goto']}, 'at': {'type': ['array', 'string'],
                'items': {'type': ['number', 'string']}, 'description': coordinate_doc}}}}}}
    tools = module.model_tools(bridge.tools)
    declaration = next(t['function'] for t in tools if t['function']['name'] == 'mc_do')
    assert declaration['parameters']['properties']['steps']['items']['properties']['at']['description'] == coordinate_doc
    assert 'bare -64 is absolute' in declaration['description']
    assert 'initial match can return without walking' in declaration['description']
    arguments = {'steps': [{'skill': 'goto', 'at': ['~', '~', '-64']}]}
    calls = [{'id': 'exact-coordinate', 'type': 'function', 'function': {
        'name': 'mc_do', 'arguments': json.dumps(arguments)}}]
    assert controller.prepare_call(calls, tools)[2] == arguments
    assert not bridge.calls, 'Projection must neither execute a move nor guess ~-64'
