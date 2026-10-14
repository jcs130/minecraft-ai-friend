import importlib
import json


def test_public_projection_excludes_private_inputs_and_distinguishes_queued_effects(framework_module):
    public = importlib.import_module('agent_mc_autonomy.viewer_public')
    receipt = public.tool_receipt('mc_do', {'steps': [{'skill': 'collect', 'secret': 'private'}]},
                                  {'execution': {'id': 'task:1', 'terminal': False}, 'failed': False})
    value = public.viewer_projection({'game_connected': True, 'phase': 'running', 'standing_goal': 'Survive',
                                      'current_goal': {'goal': 'Find food'}, 'pending': [{'id': 'task:1'}],
                                      'viewer_action': receipt, 'private_prompt': 'do not publish'}, 'Player', 'session')
    assert value['goal'] == 'Find food' and value['mode'] == 'acting'
    assert value['receipts'][-1]['result']['code'] == 'queued'
    assert value['receipts'][-1]['result']['effectVerified'] is False
    assert 'private' not in json.dumps(value)
    assert value['action'] == 'mc_do / collect'


def test_terminal_blocked_and_rejected_are_never_completed_success(framework_module):
    public = importlib.import_module('agent_mc_autonomy.viewer_public')
    receipt = public.tool_receipt('mc_do', {}, {'failed': True})
    assert receipt['result']['ok'] is False and receipt['result']['code'] == 'rejected'
    state = {'viewer_action': public.tool_receipt('mc_do', {}, {'execution': {'id': 'one', 'terminal': False}}),
             'viewer_terminal': {'id': 'one', 'terminal': True, 'phase': 'blocked'}}
    value = public.viewer_projection(state, 'Player', 'session')
    assert value['receipts'][-1]['result']['ok'] is False
    assert value['receipts'][-1]['result']['code'] == 'blocked'
    state['viewer_terminal']['id'] = 'other'
    assert public.viewer_projection(state, 'Player', 'session')['receipts'][-1]['result']['code'] == 'queued'


def test_public_timeline_keeps_matching_terminal_and_queue_without_private_payloads(framework_module):
    public = importlib.import_module('agent_mc_autonomy.viewer_public')
    state = {'game_connected': True, 'pending': [{'id': 'task:1', 'kind': 'act', 'phase': 'running', 'arguments': 'api_key=private'}]}
    receipt = public.tool_receipt('mc_do', {'steps': [{'skill': 'craft'}]}, {'execution': {'id': 'task:1', 'terminal': False}})
    public.record_playback(state, {'viewer_action': receipt})
    public.record_playback(state, {'viewer_terminal': {'id': 'other', 'terminal': True, 'phase': 'blocked'}})
    assert len(state['viewer_history']) == 1
    public.record_playback(state, {'viewer_terminal': {'id': 'task:1', 'terminal': True, 'phase': 'blocked'}})
    value = public.viewer_projection(state, 'Player', 'session')
    assert value['playback']['timeline'][-1]['result']['code'] == 'blocked'
    assert value['playback']['queue'][0]['phase'] == 'running'
    assert 'private' not in json.dumps(value) and 'arguments' not in json.dumps(value)


def test_public_history_is_bounded_and_schema_failure_does_not_expose_error_arguments(framework_module):
    public = importlib.import_module('agent_mc_autonomy.viewer_public')
    state = {}
    for n in range(60):
        public.record_playback(state, {'viewer_action': public.tool_receipt('mc_do', {}, {'execution': {'id': str(n), 'terminal': False}})})
    public.record_playback(state, {'tool_failure': {'tool': 'mc_scout', 'error': 'Invalid arguments: api_key=private', 'receipt': {}}})
    value = public.viewer_projection(state, 'Player', 'session')
    assert len(value['playback']['timeline']) <= 20
    assert len(json.dumps(value, ensure_ascii=False).encode('utf-8')) <= 16384
    assert 'private' not in json.dumps(value)
    assert value['playback']['timeline'][-1]['result']['code'] == 'rejected'
