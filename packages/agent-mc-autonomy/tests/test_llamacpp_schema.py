"""Provider grammar compatibility must never weaken native dispatch validation."""
import copy
from dataclasses import replace

import pytest

from agent_mc_autonomy.local_counter import render_input
from agent_mc_autonomy.model_config import HttpPlannerConfig
from agent_mc_autonomy.model_protocols import request
from agent_mc_autonomy.tool_schema import argument_error, provider_schema


def sample():
    return {'type': 'object', 'properties': {'library': {'type': 'object', 'properties': {
        'code': {'type': 'string', 'minLength': 1, 'maxLength': 12000, 'description': 'Source code'},
        'reason': {'type': 'string', 'maxLength': 1600},
        'short': {'type': 'string', 'maxLength': 24},
        'data': {'enum': [{'maxLength': 9000}], 'default': {'maxLength': 8000}},
    }, 'required': ['code'], 'additionalProperties': False}}, 'additionalProperties': False}


def config(**extra):
    return HttpPlannerConfig.parse({'base_url': 'http://127.0.0.1:8000/v1', 'model': 'selected',
        'auth': {'mode': 'none'}, **extra})


def test_opt_in_projection_preserves_contract_text_and_original_data():
    original = sample()
    before = copy.deepcopy(original)
    result = provider_schema(original, profile='llamacpp')
    fields = result['properties']['library']['properties']
    assert 'maxLength' not in fields['code'] and 'maxLength=12000' in fields['code']['description']
    assert 'maxLength' not in fields['reason'] and 'maxLength=1600' in fields['reason']['description']
    assert fields['code']['minLength'] == 1 and fields['short']['maxLength'] == 24
    assert fields['data'] == before['properties']['library']['properties']['data']
    assert original == before


def test_native_validation_still_rejects_oversized_arguments():
    original = sample()
    projected = provider_schema(original, profile='llamacpp')
    assert 'maxLength' not in projected['properties']['library']['properties']['code']
    catalogue = [{'name': 'mc_script', 'inputSchema': original}]
    assert argument_error(catalogue, 'mc_script', {'library': {'code': 'x' * 12001}}) is not None
    assert argument_error(catalogue, 'mc_script', {'library': {'code': 'x' * 12000}}) is None


def test_chat_projection_is_explicit_and_cpu_counter_uses_the_wire_tools():
    tools = [{'type': 'function', 'function': {'name': 'mc_script', 'description': 'run', 'parameters': sample()}}]
    before = copy.deepcopy(tools)
    messages = [{'role': 'user', 'content': 'public fixture'}]
    _, default = request(config(), messages, tools, 100)
    assert default['tools'] == before
    cfg = config(tool_schema_profile='llamacpp')
    _, body = request(cfg, messages, tools, 100)
    assert 'maxLength' not in body['tools'][0]['function']['parameters']['properties']['library']['properties']['code']
    _, declared, _ = render_input(replace(cfg, context_counter={'mode': 'vllm_chat'}), messages, tools)
    assert declared == body['tools'] and tools == before


@pytest.mark.parametrize('extra', [{'tool_schema_profile': 'unknown'}, {'tool_schema_profile': None}, {'tool_schema_profile': []},
    {'tool_schema_profile': 'llamacpp', 'protocol': 'responses'}])
def test_invalid_or_non_chat_profile_is_rejected(extra):
    with pytest.raises(ValueError, match='brain_tool_schema_profile_invalid'):
        config(**extra)
