"""Local counting keeps real context units without any provider/game call."""
import copy
import hashlib

import pytest

from agent_mc_autonomy.context import assemble, encode
from agent_mc_autonomy.model_config import HttpPlannerConfig
from agent_mc_autonomy.planner import HttpPlanner


@pytest.fixture
def configured(tmp_path):
    tokenizers = pytest.importorskip('tokenizers')
    pytest.importorskip('jinja2')
    tokenizer = tokenizers.Tokenizer(tokenizers.models.WordLevel({'[UNK]': 0}, unk_token='[UNK]'))
    tokenizer.pre_tokenizer = tokenizers.pre_tokenizers.Whitespace()
    tokenizer.save(str(tmp_path / 'tokenizer.json'))
    template = "{% for m in messages %}{{ m.role }} {{ m.content }} {% if m.tool_calls %}{{ m.tool_calls|tojson }}{% endif %}{% if m.reasoning_content %}{{ m.reasoning_content }}{% endif %}{% endfor %}{{ tools|tojson }} assistant"
    (tmp_path / 'chat.jinja').write_text(template, encoding='utf-8')
    def resource(name):
        return {'path': str(tmp_path / name), 'sha256': hashlib.sha256((tmp_path / name).read_bytes()).hexdigest()}
    return {'base_url': 'http://127.0.0.1:8000/v1', 'model': 'selected', 'auth': {'mode': 'none'},
            'parameters': {'reasoning_effort': 'low'},
            'context_counter': {'mode': 'ninfer_chat', 'model': 'selected', 'base_url': 'http://127.0.0.1:8000/v1',
                                'tokenizer': resource('tokenizer.json'), 'template': resource('chat.jinja'),
                                'template_parameters': {'preserve_thinking': True}}}


def planner(raw):
    # Fake transport is never used. This exercises real planner config/wiring.
    return HttpPlanner(HttpPlannerConfig.parse(raw), 8192, 120, client=object())


def test_selected_local_counter_keeps_history_beyond_a_byte_sized_window(configured):
    p = planner(configured)
    groups = [[{'role': 'assistant', 'content': '保留历史原文' * 8000}]]
    original = copy.deepcopy(groups)
    kwargs = dict(context_tokens=131072, reserved_output=8192, context_mode='full')
    _, old = assemble('rules', [], 'live', {'parts': []}, [], groups, **kwargs)
    messages, new = assemble('rules', [], 'live', {'parts': []}, [], groups, context_counter=p.context_counter, **kwargs)
    assert old['history']['included'] == 0
    assert new['history']['included'] == 1 and new['units'] == 'tokens'
    assert new['counter'].startswith('ninfer-chat-local/')
    assert messages[2] == groups[0][0] and groups == original


def test_counter_uses_wire_reasoning_and_normalized_function_arguments(configured):
    from agent_mc_autonomy.local_counter import render_input
    from agent_mc_autonomy.model_protocols import scope
    cfg = HttpPlannerConfig.parse(configured)
    messages = [{'role': 'system', 'content': 'identity'},
                {'role': 'assistant', 'content': None, '_provider_state': {'scope': scope(cfg), 'data': {'reasoning_content': 'retained private native state'}},
                 'tool_calls': [{'id': 'c', 'type': 'function', 'function': {'name': 'do', 'arguments': '{"nested":{"value":"中文"}}'}}]},
                {'role': 'tool', 'tool_call_id': 'c', 'content': [{'type': 'text', 'text': 'complete receipt'}]},
                {'role': 'user', 'content': 'fresh'}]
    tools = [{'type': 'function', 'function': {'name': 'do', 'parameters': {'type': 'object'}, 'description': 'native semantics'}}]
    before = copy.deepcopy((messages, tools))
    normalized, declared, params = render_input(cfg, messages, tools)
    assert normalized[1]['reasoning_content'] == 'retained private native state'
    assert normalized[1]['content'] == '' and normalized[2]['content'] == 'complete receipt'
    assert normalized[1]['tool_calls'][0]['function']['arguments'] == {'nested': {'value': '中文'}}
    assert list(declared[0]['function']) == ['name', 'parameters', 'strict', 'description']
    assert declared[0]['function']['strict'] is False and params['preserve_thinking'] is True
    assert (messages, tools) == before


@pytest.mark.parametrize('field,value', [('model', 'other'), ('base_url', 'http://127.0.0.1:9000/v1')])
def test_counter_binding_cannot_silently_follow_another_model(configured, field, value):
    configured[field] = value
    with pytest.raises(ValueError, match='context_counter'):
        planner(configured)


@pytest.mark.parametrize('change', ['hash', 'file_changed', 'image'])
def test_unavailable_counter_restarts_the_entire_assembly_in_byte_mode(configured, change):
    if change == 'hash':
        configured['context_counter']['template']['sha256'] = '0' * 64
    p = planner(configured)
    if change == 'file_changed':
        p.context_counter([{'role': 'user', 'content': 'warm'}], [])
        with open(configured['context_counter']['template']['path'], 'a', encoding='utf-8') as f:
            f.write(' drift')
    groups = [[{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,YQ=='}}]}]] if change == 'image' else []
    messages, budget = assemble('rules', [], 'survive', {'parts': []}, [], groups,
                               context_tokens=131072, reserved_output=8192, context_mode='full', context_counter=p.context_counter)
    assert budget['units'] == 'token_upper_bound' and budget['counter_fallback']
    assert 'path' not in budget['counter_fallback']
    assert budget['total'] == len(encode({'messages': messages, 'tools': []}).encode()) + 8192 + 1024


def test_default_does_not_load_optional_resources():
    p = planner({'base_url': 'http://127.0.0.1:8000/v1', 'model': 'selected', 'auth': {'mode': 'none'}})
    assert p.context_counter is None


@pytest.mark.parametrize('value', [None, [], 'auto', {'mode': 'http'}, {'template_parameters': {'reasoning_effort': []}}])
def test_malformed_counter_configuration_is_rejected(configured, value):
    if isinstance(value, dict) and 'template_parameters' in value:
        configured['context_counter'].update(value)
    else:
        configured['context_counter'] = value
    with pytest.raises(ValueError, match='context_counter'):
        planner(configured)


def test_missing_optional_dependency_falls_back_without_provider_calls(configured, monkeypatch):
    import builtins
    original = builtins.__import__

    def load(name, *args, **kwargs):
        if name == 'tokenizers':
            raise ImportError('not installed')
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', load)
    _, budget = assemble('rules', [], 'survive', {'parts': []}, [], [], context_tokens=131072,
                         reserved_output=8192, context_mode='full', context_counter=planner(configured).context_counter)
    assert budget['counter_fallback'] == 'ImportError' and budget['units'] == 'token_upper_bound'


def test_literal_special_tokens_cannot_undercount_server_data(configured):
    from tokenizers import Tokenizer
    spec = configured['context_counter']['tokenizer']
    tokenizer = Tokenizer.from_file(spec['path'])
    tokenizer.add_special_tokens(['<|control|>'])
    tokenizer.save(spec['path'])
    with open(spec['path'], 'rb') as f:
        spec['sha256'] = hashlib.sha256(f.read()).hexdigest()
    _, budget = assemble('literal <|control|> inside data', [], 'survive', {'parts': []}, [], [],
                         context_tokens=131072, reserved_output=8192, context_mode='full',
                         context_counter=planner(configured).context_counter)
    assert budget['counter_fallback'] == 'ValueError' and budget['units'] == 'token_upper_bound'
