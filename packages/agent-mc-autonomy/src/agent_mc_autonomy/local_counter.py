"""Explicit, CPU-only counting for an operator-bound NInfer Chat template.

Resources belong to the selected model deployment, not the game or host SDK.
Unsupported input raises into context.assemble's existing conservative fallback.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from collections import OrderedDict
from pathlib import Path

from .model_protocols import request

TEMPLATE_PARAMETERS = {'enable_thinking', 'preserve_thinking', 'reasoning_effort', 'add_vision_id'}


def validate_configuration(value, *, model, base_url, protocol):
    if value == {}:
        return {}
    fields = {'mode', 'model', 'base_url', 'tokenizer', 'template', 'template_parameters'}
    if (not isinstance(value, dict) or set(value) - fields or value.get('mode') != 'ninfer_chat'
            or protocol != 'chat' or value.get('model') != model
            or not isinstance(value.get('base_url'), str)
            or value['base_url'].rstrip('/') != base_url.rstrip('/')):
        raise ValueError('brain_context_counter_binding_invalid')
    for kind in ('tokenizer', 'template'):
        resource = value.get(kind)
        if (not isinstance(resource, dict) or set(resource) != {'path', 'sha256'}
                or not isinstance(resource['path'], str) or not Path(resource['path']).is_absolute()
                or not isinstance(resource['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', resource['sha256'])):
            raise ValueError('brain_context_counter_resource_invalid')
    params = value.get('template_parameters', {})
    if not isinstance(params, dict) or set(params) - TEMPLATE_PARAMETERS:
        raise ValueError('brain_context_counter_template_parameters_invalid')
    for key, item in params.items():
        if (key == 'reasoning_effort' and (not isinstance(item, str) or item not in {'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'})
                or key != 'reasoning_effort' and type(item) is not bool):
            raise ValueError('brain_context_counter_template_parameters_invalid')
    return copy.deepcopy(value)


def render_input(config, messages, tools):
    """Use the real wire projection, then NInfer's documented normalization."""
    _, body = request(config, messages, tools, 1)
    params = copy.deepcopy(config.context_counter.get('template_parameters', {}))
    kwargs = body.get('chat_template_kwargs', {})
    if set(kwargs) - TEMPLATE_PARAMETERS:
        raise ValueError('counter_template_semantics_unsupported')
    params.update(kwargs)
    for key in TEMPLATE_PARAMETERS:
        if key in body:
            params[key] = body[key]
    if 'reasoning_effort' in params:
        effort = params['reasoning_effort']
        params['reasoning_effort'] = {'minimal': 'low', 'high': 'xhigh', 'max': 'xhigh'}.get(effort, effort)
        if effort == 'none':
            params['enable_thinking'] = False
    params.update(add_generation_prompt=True, continue_final_message=False)
    rows = body['messages']
    for row in rows:
        content = row.get('content')
        if isinstance(content, list):
            if any(part.get('type') != 'text' for part in content):
                raise ValueError('counter_media_not_supported')
            row['content'] = ''.join(part['text'] for part in content)
        elif content is None:
            row['content'] = ''
        for call in row.get('tool_calls', []):
            function = call['function']
            function['arguments'] = json.loads(function['arguments']) if function['arguments'] else {}
    declared = []
    for tool in tools:
        if tool.get('type') != 'function':
            raise ValueError('counter_tool_kind_not_supported')
        value = tool['function']
        function = {'name': value['name'], 'parameters': copy.deepcopy(value.get('parameters', {})),
                    'strict': value.get('strict', False)}
        for key in ('description', 'input_examples'):
            if value.get(key):
                function[key] = copy.deepcopy(value[key])
        declared.append({'type': 'function', 'function': function})
    return rows, declared, params


def _json(value, *, ensure_ascii=False, indent=None, separators=None, sort_keys=False):
    # NInfer's llama-jinja filter uses Python-style spaces, UTF-8 and insertion
    # order. Jinja's default HTML-safe/sorted filter changes the token stream.
    return json.dumps(value, ensure_ascii=ensure_ascii, indent=indent, separators=separators, sort_keys=sort_keys)


def _reject(_message):
    raise ValueError('counter_template_rejected')


def _fingerprint(stat):
    return stat.st_mtime_ns, stat.st_size, stat.st_ino


class LocalChatCounter:
    def __init__(self, config):
        self.config = config
        self.resources = copy.deepcopy(config.context_counter)
        self.name = 'ninfer-chat-local/' + self.resources['tokenizer']['sha256'][:12] + '/' + self.resources['template']['sha256'][:12]
        self._loaded = False
        self._counts = OrderedDict()

    def _load(self):
        from jinja2.sandbox import ImmutableSandboxedEnvironment
        from tokenizers import Tokenizer

        content, self._files = {}, {}
        for key, limit in (('tokenizer', 64 * 1024 * 1024), ('template', 64 * 1024)):
            spec = self.resources[key]
            path = Path(spec['path'])
            before = path.stat()
            if before.st_size > limit:
                raise ValueError('counter_resource_size_invalid')
            data = path.read_bytes()
            after = path.stat()
            if (_fingerprint(before) != _fingerprint(after)
                    or hashlib.sha256(data).hexdigest() != spec['sha256']):
                raise ValueError('counter_resource_binding_changed')
            content[key] = data.decode('utf-8')
            self._files[path] = _fingerprint(after)
        self._special = tuple(row['content'] for row in json.loads(content['tokenizer']).get('added_tokens', []) if row.get('special'))
        self._tokenizer = Tokenizer.from_str(content['tokenizer'])
        self._tokenizer.no_truncation()
        self._tokenizer.no_padding()
        env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)
        env.filters['tojson'] = _json
        env.globals['raise_exception'] = _reject
        self._template = env.from_string(content['template'])
        self._loaded = True

    def __call__(self, messages, tools):
        if not self._loaded:
            self._load()
        for path, expected in self._files.items():
            stat = path.stat()
            if _fingerprint(stat) != expected:
                raise ValueError('counter_resource_binding_changed')
        rows, declared, params = render_input(self.config, messages, tools)
        # NInfer treats tokens inside data as literal, unlike a flat HF encode.
        # Refuse that case rather than undercounting an untrusted special token.
        data = json.dumps([rows, declared], ensure_ascii=False)
        if any(token in data for token in self._special):
            raise ValueError('counter_literal_special_token_unsupported')
        rendered = self._template.render(messages=rows, tools=declared, **params)
        if len(rendered.encode('utf-8')) > 8 * 1024 * 1024:
            raise ValueError('counter_input_too_large')
        key = hashlib.sha256(rendered.encode('utf-8')).digest()
        if key not in self._counts:
            self._counts[key] = len(self._tokenizer.encode(rendered, add_special_tokens=False).ids)
            if len(self._counts) > 8:
                self._counts.popitem(last=False)
        return self._counts[key]


def configured_counter(config):
    return LocalChatCounter(config) if config.context_counter else None
