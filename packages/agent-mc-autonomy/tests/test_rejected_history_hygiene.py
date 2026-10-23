"""Malformed argument originals are evidence, never valid assistant examples."""
import dataclasses
import json

import pytest
from test_controller import setup
from test_json_correction_handoff import BAD, tool


@pytest.mark.parametrize('mode', ['compact', 'full'])
def test_rejected_json_never_reenters_the_model_as_an_assistant_tool_example(
        framework_module, tmp_path, run_async, mode):
    seen = []

    async def decide(messages, _):
        seen.append(messages)
        if len(seen) == 1:
            return tool(BAD)
        for message in messages:
            if message['role'] == 'assistant':
                for call in message.get('tool_calls', []):
                    assert isinstance(json.loads(call['function']['arguments']), dict), (
                        'Rejected JSON was promoted back into assistant tool-call history'
                    )
        assert BAD not in json.dumps(messages, ensure_ascii=False)
        assert 'Original proposed narration' not in json.dumps(messages, ensure_ascii=False)
        assert 'column' in messages[-1]['content'] and 'No tool was dispatched' in messages[-1]['content']
        return tool('{"steps":[{"skill":"goto","at":[1,65,1]}],"queue":"append"}', 2)

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode=mode, max_tool_rounds=1)
    tools = module.model_tools(bridge.tools, context_mode=mode)
    run_async(controller.turn_once('survive', 'body', tools))
    run_async(controller.turn_once('survive', 'body', tools))
    assert sum(name == 'mc_do' for name, _, _ in bridge.calls) == 1
    original = [json.loads(line) for line in (tmp_path/'decisions.jsonl').read_text(encoding='utf-8').splitlines()]
    assert original[0]['response']['tool_calls'][0]['function']['arguments'] == BAD
    assert any(row.get('dispatched') is False for row in original)
