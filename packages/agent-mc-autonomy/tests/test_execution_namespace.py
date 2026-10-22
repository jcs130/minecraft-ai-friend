import dataclasses
import hashlib
import json

import pytest

from test_controller import action, setup
from test_recovery import fixture


@pytest.mark.parametrize('mode', ['compact', 'full'])
def test_task_terminal_does_not_hide_same_number_method(framework_module, tmp_path, run_async, mode):
    from agent_mc_autonomy.observations import native_outcome_view
    _, _, controller = setup(framework_module, tmp_path, None)
    controller.settings = dataclasses.replace(controller.settings, context_mode=mode)
    run_async(controller.execute_model_call('mc_do', {'steps': []}))
    controller.receipt({'execution': action(terminal=True)})
    controller.receipt({'execution': {**action(), 'kind': 'method'}})
    assert ('method', 'body-1') in controller.pending
    assert native_outcome_view(controller.native_outcomes[-1])['execution_kind'] == 'task'
    controller.receipt({'execution': action()})
    assert ('task', 'body-1') not in controller.pending  # Same-kind late acceptance stays suppressed.
    assert [row['kind'] for row in json.loads(controller.state_path.read_text())['pending']] == ['method']


def test_terminal_original_reference_matches_kind_as_well_as_id(framework_module, tmp_path, run_async):
    _, _, controller = setup(framework_module, tmp_path, None)
    run_async(controller.execute_model_call('mc_do', {'steps': []}))
    controller.receipt({'execution': action(terminal=True), 'events': [
        {'run': 'run-1', 'cursor': 10, 'execution': {**action(terminal=True), 'kind': 'method'}},
        {'run': 'run-1', 'cursor': 11, 'execution': action(terminal=True)}]})
    assert controller.native_outcomes[-1]['original_event']['cursor'] == 11


def test_viewer_does_not_apply_method_terminal_to_task(framework_module):
    from agent_mc_autonomy.viewer_public import record_playback, tool_receipt, viewer_projection
    receipt = tool_receipt('mc_do', {'steps': [{'skill': 'craft'}]}, {'execution': action()})
    state = {'viewer_action': receipt, 'pending': [{**action(), 'kind': 'method'}]}
    record_playback(state, {'viewer_action': receipt})
    terminal = {**action(terminal=True), 'kind': 'method', 'phase': 'validated'}
    record_playback(state, {'viewer_terminal': terminal})
    state['viewer_terminal'] = terminal
    view = viewer_projection(state, 'Player', 'session')
    assert view['receipts'][0]['result']['code'] == 'queued'
    assert view['receipts'][0]['execution_kind'] == 'task'
    assert len(view['playback']['timeline']) == 1
    assert 'operation' not in view['playback']['queue'][0]
    state['viewer_terminal'] = action(terminal=True)
    assert viewer_projection(state, 'Player', 'session')['receipts'][0]['result']['code'] == 'completed'


def test_legacy_kindless_viewer_terminal_does_not_establish_completion(framework_module):
    from agent_mc_autonomy.viewer_public import tool_receipt, viewer_projection
    receipt = tool_receipt('mc_do', {}, {'execution': action()})
    terminal = {key: value for key, value in action(terminal=True).items() if key != 'kind'}
    assert viewer_projection({'viewer_action': receipt, 'viewer_terminal': terminal}, 'Player', 'session')['receipts'][0]['result']['code'] == 'queued'


def test_legacy_kindless_controller_terminal_keeps_conservative_late_acceptance_guard(framework_module, tmp_path):
    _, _, controller = setup(framework_module, tmp_path, None)
    controller.native_outcomes.append({'execution_id': 'body-1', 'terminal': True})
    controller.receipt({'execution': action()})
    assert not controller.pending


def recovery_case(tmp_path, framework_module, terminal_kind):
    settings, host, _, _, options = fixture(tmp_path, framework_module)
    request = options['native_request_ids'][0]
    path = host.parent / 'client/requests' / (hashlib.sha256(request.encode()).hexdigest() + '.json')
    record = json.loads(path.read_text())
    record['outcome']['execution']['kind'] = 'task'
    path.write_text(json.dumps(record), encoding='utf-8')
    execution = {'id': record['outcome']['execution']['id'], 'terminal': True, 'phase': 'validated'}
    if terminal_kind is not None:
        execution['kind'] = terminal_kind
    archive = host.parent / 'client' / f"events-{options['expected_run']}.jsonl"
    with archive.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'run': options['expected_run'], 'cursor': 2, 'execution': execution}) + '\n')
    return settings, host, options


@pytest.mark.parametrize('terminal_kind', ['method', None])
def test_recovery_requires_same_kind_terminal_without_mutating_barrier(tmp_path, framework_module, terminal_kind):
    from agent_mc_autonomy.recovery import assess
    settings, host, options = recovery_case(tmp_path, framework_module, terminal_kind)
    before = {name: (host / name).read_bytes() for name in ['host-state.json', 'status.json']}
    result = assess(settings, tmp_path, native_request_ids=options['native_request_ids'])
    assert result['old_work'][0]['classification'] == 'accepted_only_unknown'
    assert result['old_work'][0]['execution_kind'] == 'task'
    assert all((host / name).read_bytes() == raw for name, raw in before.items())
    assert result['classification'] == 'unknown' and result['verified'] is False


def test_recovery_keeps_unlinked_other_kind_with_same_id(tmp_path, framework_module):
    from agent_mc_autonomy.recovery import assess
    settings, host, options = recovery_case(tmp_path, framework_module, 'method')
    path = host / 'status.json'
    status = json.loads(path.read_text())
    status['pending'].append({**status['pending'][0], 'kind': 'method'})
    path.write_text(json.dumps(status), encoding='utf-8')
    result = assess(settings, tmp_path, native_request_ids=options['native_request_ids'])
    assert {(row['execution_kind'], row['classification']) for row in result['old_work']} == {
        ('task', 'accepted_only_unknown'), ('method', 'unlinked_unknown')}
