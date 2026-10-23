import copy
import json

import pytest
from jsonschema import Draft202012Validator
from test_model_providers import config

from agent_mc_autonomy.controller import model_tools
from agent_mc_autonomy.model_protocols import request


def catalogue():
    fields = {'skill': {'enum': ['harvest', 'surface']}, 'block': {'type': 'string'},
              'at': {'type': 'array', 'items': {'type': 'number'}, 'minItems': 3, 'maxItems': 3},
              'text': {'type': 'string'}, 'tolerance': {'type': 'number'}}
    contracts = {'harvest': [{'type': 'object', 'properties': {k: fields[k] for k in ['block', 'at']},
                 'required': ['skill', 'block', 'at'], 'additionalProperties': False}],
                 'surface': [{'type': 'object', 'properties': {}, 'required': ['skill'], 'additionalProperties': False}]}
    for skill, variants in contracts.items():
        for variant in variants:
            variant['properties']['skill'] = {'type': 'string', 'const': skill}
    return [{'name': 'mc_do', 'inputSchema': {'type': 'object', 'properties': {'steps': {
        'type': 'array', 'items': {'type': 'object', 'properties': fields, 'required': ['skill'],
                                 'x-agent-mc-skill-contracts': contracts}}}, 'required': ['steps']}}]


def wire(profile):
    import dataclasses
    cfg = dataclasses.replace(config('openai'), protocol='chat', tool_schema_profile=profile)
    native = catalogue()
    original = copy.deepcopy(native)
    _, body = request(cfg, [{'role': 'user', 'content': 'Choose your own next action'}],
                      model_tools(native, context_mode='full', tool_schema_profile=profile), 512)
    assert native == original
    return body['tools'][0]['function']['parameters']


def test_explicit_llamacpp_profile_enforces_skill_specific_fields():
    schema = wire('llamacpp')
    valid = Draft202012Validator(schema)
    assert not valid.is_valid({'steps': [{'skill': 'harvest', 'block': 'wheat', 'text': 'at', 'tolerance': 1}]})
    assert valid.is_valid({'steps': [{'skill': 'harvest', 'block': 'wheat', 'at': [1, 64, 0]}]})
    assert valid.is_valid({'steps': [{'skill': 'surface'}]})
    assert not valid.is_valid({'steps': [{'skill': 'surface', 'at': [1, 64, 0]}]})
    assert 'x-agent-mc-skill-contracts' not in json.dumps(schema)


def test_default_profile_keeps_flat_compatibility_and_strips_native_annotation():
    schema = wire('default')
    assert Draft202012Validator(schema).is_valid({'steps': [{'skill': 'harvest', 'text': 'at'}]})
    assert 'x-agent-mc-skill-contracts' not in json.dumps(schema)


@pytest.mark.parametrize('profile', ['default', 'llamacpp'])
def test_context_tools_contain_only_the_selected_wire_contract(profile):
    tools = model_tools(catalogue(), context_mode='full', tool_schema_profile=profile)
    assert 'x-agent-mc-skill-contracts' not in json.dumps(tools)
    import dataclasses
    cfg = dataclasses.replace(config('openai'), protocol='chat', tool_schema_profile=profile)
    _, body = request(cfg, [{'role': 'user', 'content': 'Choose your activity'}], tools, 512)
    assert body['tools'] == tools


@pytest.mark.parametrize('profile', ['default', 'llamacpp'])
def test_projection_is_stable_and_preserves_unannotated_native_tools(profile):
    assert wire(profile) == wire(profile)


def test_malformed_or_expanded_native_generation_annotation_fails_closed():
    from agent_mc_autonomy.tool_schema import provider_schema
    for mutation in [None, [], {'unknown_skill': []}, {'harvest': [True], 'surface': [True]}]:
        schema = catalogue()[0]['inputSchema']['properties']['steps']['items']
        if mutation is None:
            mutation = {'harvest': [{'properties': {'skill': {'const': 'surface'}}, 'required': ['skill']}],
                        'surface': [{'properties': {'skill': {'const': 'surface'}}, 'required': ['skill']}]}
        schema['x-agent-mc-skill-contracts'] = mutation
        with pytest.raises(ValueError, match='brain_skill_generation_contract_invalid'):
            provider_schema(schema, profile='llamacpp', wire=True)


def test_runner_forwards_explicit_schema_profile_without_inference(framework_module, tmp_path, run_async, monkeypatch):
    import dataclasses
    from types import SimpleNamespace

    from agent_mc_autonomy import runner
    seen = []
    class Planner:
        config = SimpleNamespace(tool_schema_profile='llamacpp')
        async def decide(self, *_):
            pytest.fail('no inference')
        async def aclose(self):
            pass
    class Controller:
        def __init__(self, *_, **kwargs):
            seen.append(kwargs)
        async def run(self, _):
            pass
    monkeypatch.setattr(runner, 'Controller', Controller)
    settings = dataclasses.replace(framework_module.Settings(), enabled=True, host='example.test',
                                   username='OfflineProfile', viewer_auto_open=False)
    run_async(runner.run_session(settings, tmp_path / 'fake.mjs', tmp_path, Planner(), 'survive',
        lambda **_: None, lambda: False, bridge_factory=lambda *_: object()))
    assert seen[0]['tool_schema_profile'] == 'llamacpp'
