"""A known no-dispatch JSON error must not lose its corrective evidence."""
import dataclasses
import json

import pytest

from test_controller import setup


BAD = '{"steps":[{"skill":"goto","at":[1,65,1]}],"queue"::"Original proposed narration"}'


def tool(arguments, index=1):
    return {'tool_calls': [{'id': f'call-{index}', 'type': 'function',
                           'function': {'name': 'mc_do', 'arguments': arguments}}]}


@pytest.mark.parametrize('fence', ['pending', 'inflight', 'stop'])
def test_json_correction_preserves_existing_native_and_stop_fences(
        framework_module, tmp_path, fence):
    module, _, controller = setup(framework_module, tmp_path, None)
    if fence == 'pending':
        controller.pending[('task', 'running')] = {'terminal': False}
    elif fence == 'inflight':
        controller.inflight_request = {'id': 'unknown-original'}
    else:
        controller.stop_requested = lambda: True
    original = (dict(controller.pending), controller.inflight_request)
    controller.reject_model_call(module.ToolJSONRejected('Known JSON syntax rejection'))
    assert not controller.continuation_ready
    assert (controller.pending, controller.inflight_request) == original


def test_json_syntax_error_gets_one_immediate_correction_then_normal_backoff(
        framework_module, tmp_path, run_async, monkeypatch):
    import agent_mc_autonomy.controller as module
    monkeypatch.setattr(module.time, 'monotonic', lambda: 1000)

    async def decide(*_):
        return tool(BAD)

    _, bridge, controller = setup(framework_module, tmp_path, decide)
    tools = module.model_tools(bridge.tools)
    for index, delay in enumerate((0, 20, 40, 60)):
        run_async(controller.turn_once('survive', 'body', tools))
        assert controller.planner_retry_at == 1000 + delay
        assert controller.continuation_ready is (index == 0)
    assert not any(row[0] == 'mc_do' for row in bridge.calls)
    assert not controller.pending and controller.inflight_request is None


def test_error_location_survives_eviction_without_replaying_the_bad_example(
        framework_module, tmp_path, run_async):
    captured = []

    async def decide(messages, _):
        captured.append(messages)
        if len(captured) == 1:
            return tool(BAD)
        notice = json.loads(messages[-1]['content'])['planner_notice']
        assert 'column' in notice and 'offset' in notice and 'mc_do' in notice
        assert '::' not in notice and 'No tool was dispatched' in notice
        return tool('{"steps":[{"skill":"goto","at":[1,65,1]}],"queue":"append"}', 2)

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode='full', context_tokens=16384,
                                             max_output_tokens=512, max_tool_rounds=1)
    tools = module.model_tools(bridge.tools, context_mode='full')
    run_async(controller.turn_once('survive', 'body', tools))
    assert not any(row[0] == 'mc_do' for row in bridge.calls)
    controller.groups = [[{'role': 'user', 'content': 'old observation ' * 2000}]]
    run_async(controller.turn_once('survive', 'body', tools))
    native = [row for row in bridge.calls if row[0] == 'mc_do']
    assert len(native) == 1 and native[0][1]['queue'] == 'append'
    assert controller.pending and controller.invalid_tool_calls == 0
    journal = [json.loads(line) for line in (tmp_path / 'decisions.jsonl').read_text(encoding='utf-8').splitlines()]
    assert journal[0]['response']['tool_calls'][0]['function']['arguments'] == BAD
    assert '::' in next(row['json_diagnostic']['rejected_raw_excerpt'] for row in journal if 'json_diagnostic' in row)
