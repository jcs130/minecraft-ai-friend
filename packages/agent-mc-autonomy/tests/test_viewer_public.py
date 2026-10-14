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
