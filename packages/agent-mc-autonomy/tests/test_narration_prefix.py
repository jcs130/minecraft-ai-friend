"""Subscriber liveness is current policy, never a full-context prefix edit."""
import copy
import dataclasses
import json

import pytest
from test_controller import setup


def capture(framework_module, directory, run_async, monkeypatch, *, enabled, full=True, reply=None, expire=False):
    from agent_mc_autonomy.narration import NarrationPort

    live = [enabled]
    monkeypatch.setattr(NarrationPort, 'consumer', lambda *_: {'subscribed': True} if live[0] else None)
    seen = []

    async def decide(messages, tools):
        seen.append((copy.deepcopy(messages), copy.deepcopy(tools)))
        if expire:
            live[0] = False
        return reply or {'content': 'Waiting for changed evidence.', 'tool_calls': []}

    directory.mkdir()
    module, bridge, controller = setup(framework_module, directory, decide)
    controller.settings = dataclasses.replace(controller.settings,
        context_mode='full' if full else 'compact', context_tokens=131072)
    expected = {'identity': 'test-identity', 'actor': 'AnonymousTestRole', 'session': 'test-session',
                'run': 'test-run', 'scope': {'realm': 'test', 'account': 'test', 'agent': 'test'},
                'intent_revision': 0, 'death_episode_id': None, 'as_of': 0}
    controller.recent_request = lambda _: expected
    controller.recent_context_provider = lambda _: {'available': False, 'reason': 'not_configured'}
    run_async(controller.turn_once('survive', 'unchanged core contract',
                                   module.model_tools(bridge.tools, context_mode=controller.settings.context_mode)))
    return seen[0], bridge, controller


def test_full_wire_tool_schema_is_stable_when_voice_subscriber_expires(
        framework_module, tmp_path, run_async, monkeypatch):
    active, _, _ = capture(framework_module, tmp_path / 'active', run_async, monkeypatch, enabled=True)
    absent, _, _ = capture(framework_module, tmp_path / 'absent', run_async, monkeypatch, enabled=False)
    assert active[1] == absent[1], 'Voice lease expiry rewrites the provider tool-schema prefix'
    for captured, enabled in ((active, True), (absent, False)):
        policy = json.loads(captured[0][-1]['content'])['current_tool_policy']
        assert policy['host_voice_available'] is enabled


def test_full_system_prefix_is_stable_when_voice_subscriber_expires(
        framework_module, tmp_path, run_async, monkeypatch):
    active, _, _ = capture(framework_module, tmp_path / 'active', run_async, monkeypatch, enabled=True)
    absent, _, _ = capture(framework_module, tmp_path / 'absent', run_async, monkeypatch, enabled=False)
    assert active[0][:2] == absent[0][:2], 'Voice lease expiry rewrites the stable system instructions'


def speech_action():
    return {'content': None, 'tool_calls': [{'id': 'speech-metadata', 'type': 'function',
        'function': {'name': 'mc_do', 'arguments': json.dumps({'steps': [], '_spoken_text': '去山边走走。'})}}]}


def test_stable_declaration_does_not_authorize_speech_when_subscriber_absent(
        framework_module, tmp_path, run_async, monkeypatch):
    (_, tools), bridge, controller = capture(framework_module, tmp_path / 'closed', run_async, monkeypatch,
                                             enabled=False, reply=speech_action())
    declaration = next(t['function'] for t in tools if t['function']['name'] == 'mc_do')
    assert '_spoken_text' in declaration['parameters']['properties']
    assert controller.invalid_tool_calls == 1
    assert not any(name == 'mc_do' for name, _, _ in bridge.calls)
    assert not (tmp_path / 'closed/narration.sqlite3').exists()


def test_subscriber_expiry_during_inference_does_not_offer_stale_speech_or_cancel_native_action(
        framework_module, tmp_path, run_async, monkeypatch):
    _, bridge, controller = capture(framework_module, tmp_path / 'expires', run_async, monkeypatch,
                                    enabled=True, expire=True, reply=speech_action())
    calls = [args for name, args, _ in bridge.calls if name == 'mc_do']
    assert len(calls) == 1 and '_spoken_text' not in calls[0]
    assert controller.pending[('task', 'body-1')]['terminal'] is False
    assert not (tmp_path / 'expires/narration.sqlite3').exists()


@pytest.mark.parametrize('enabled', [True, False])
def test_compact_voice_contract_keeps_existing_subscriber_behavior(
        framework_module, tmp_path, run_async, monkeypatch, enabled):
    (_, tools), _, _ = capture(framework_module, tmp_path / 'compact', run_async, monkeypatch,
                               enabled=enabled, full=False)
    declaration = next(t['function'] for t in tools if t['function']['name'] == 'mc_do')
    assert ('_spoken_text' in declaration['parameters'].get('properties', {})) is enabled
