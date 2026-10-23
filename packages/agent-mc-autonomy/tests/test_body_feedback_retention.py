"""Spatial query traffic must not erase the body's last real receipts."""
import dataclasses
import json

import pytest
from test_controller import action
from test_observation_reuse import PLAN, observed, prepare

from agent_mc_autonomy.context import assemble


@pytest.mark.parametrize('mode', ['compact', 'full'])
def test_body_receipt_survives_repeated_spatial_observations(framework_module, tmp_path, run_async, mode):
    _, controller = prepare(framework_module, tmp_path)
    controller.settings = dataclasses.replace(controller.settings, context_mode=mode, context_tokens=8000)
    run_async(controller.execute_model_call('mc_do', {'steps': [{'skill': 'stow', 'item': 'cobblestone', 'count': 64}]}))
    controller.receipt({'execution': {**action(terminal=True), 'evidence': {
        'receipt': 'Stored cobblestone x64; inventory readback changed from 128 to 64.',
        'steps': [{'step': 1, 'outcome': 'ok'}]}}})
    for index in range(12):
        plan = json.loads(json.dumps(PLAN))
        plan['steps'][0]['bounds'][0] -= index
        observed(controller, run_async, arguments=plan)
    body = [row for row in controller.native_outcomes if row['tool'] == 'mc_do' and not row['observation_only']]
    assert len(body) == 1, 'Read receipts evicted the only real body feedback'
    assert 'Stored cobblestone x64' in body[0]['receipt']
    assert body[0]['goal_verified'] is False


def test_full_window_evicts_whole_observations_before_body_feedback_and_host_memory():
    body = {'tool': 'mc_do', 'execution_id': 'stored-64', 'phase': 'completed', 'observation_only': False,
            'goal_verified': False, 'receipt': 'Stored cobblestone x64; freed an inventory slot.',
            'original_event': {'run': 'run-1', 'cursor': 4}}
    scans = [{'tool': 'mc_scout', 'execution_id': f'scan-{i}', 'phase': 'completed', 'observation_only': True,
              'receipt': 'voxel observation; ' * 1500, 'original_event': {'run': 'run-1', 'cursor': i + 5}}
             for i in range(3)]
    host = {'stable': {'agent_name': 'TestRole', 'persona': 'Careful explorer'},
            'dynamic': {'memories': [{'id': 'host-selected', 'text': 'I chose to prepare tools after sorting stock.'}]}}
    messages, budget = assemble('native contract', [], 'survive', {}, [], [], context_tokens=9000,
        reserved_output=1024, context_mode='full', native_outcomes=[body, *scans], host_context=host)
    tail = json.loads(messages[-1]['content'])
    assert tail.get('recent_native_outcomes') == [body], 'The whole feedback section disappeared with the large scans'
    assert tail['host_context'] == host['dynamic']
    assert tail['context_omissions']['native_outcomes'] == 3
    assert 'recent_native_outcomes' not in budget['omitted_sections']
    assert budget['total'] <= budget['limit']
