"""Indefinite native work must not strand the one autonomous planner."""
import asyncio
import dataclasses
import json
from types import SimpleNamespace

import pytest
from test_controller import action, packed, setup
from test_native_lookahead import plan


def test_follow_is_reviewed_at_idle_intervals_without_automatic_cancellation(
        framework_module, tmp_path, run_async, monkeypatch):
    clock, calls = [1000], []

    async def decide(messages, tools):
        calls.append((clock[0], messages))
        return plan('follow', name='Companion') if len(calls) == 1 else {
            'content': 'The companion is still leading us safely; keep following.', 'tool_calls': []}

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1130)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, idle_decision_seconds=60)
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    run_async(controller.run('survive'))
    assert [row[0] for row in calls] == [1000, 1060, 1120]
    assert 'Periodic review' in json.dumps(calls[1][1])
    assert sum(name == 'mc_do' for name, _, _ in bridge.calls) == 1
    assert not any(name == 'mc_stop' for name, _, _ in bridge.calls)
    journal = [json.loads(line) for line in (tmp_path / 'decisions.jsonl').read_text().splitlines()]
    assert [row['planning_mode'] for row in journal] == ['ordinary', 'persistent_review', 'persistent_review']
    assert journal[-1]['native_pending'] == ['body-1']


def test_review_allows_model_to_stop_follow_through_the_original_queue(
        framework_module, tmp_path, run_async, monkeypatch):
    clock, calls = [1000], []

    async def decide(*_):
        calls.append(clock[0])
        if len(calls) == 1:
            return plan('follow', name='Companion')
        return {'content': None, 'tool_calls': [{'id': 'stop-follow', 'type': 'function',
            'function': {'name': 'mc_stop', 'arguments': '{}'}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({'name': 'mc_stop', 'inputSchema': {'type': 'object'}})
    original_call, original_sleep = bridge.call, asyncio.sleep

    async def call(name, args, **metadata):
        if name == 'mc_stop':
            bridge.calls.append((name, args, metadata))
            bridge.event_pages.append([{'cursor': 1, 'execution': {
                **action(True), 'phase': 'cancelled', 'goalCompleted': False}}])
            return packed({'text': 'Cancelled the original follow task'})
        return await original_call(name, args, **metadata)

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    bridge.call = call
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    run_async(controller.run('survive'))
    assert calls == [1000, 1060]
    assert sum(name == 'mc_stop' for name, _, _ in bridge.calls) == 1
    assert sum(name == 'mc_do' for name, _, _ in bridge.calls) == 1


@pytest.mark.parametrize('condition', ['finite', 'early', 'unknown_scope', 'unknown_request',
    'foreign_goal', 'death', 'inflight', 'feedback', 'stop'])
def test_review_does_not_bypass_ownership_or_other_work_boundaries(
        framework_module, tmp_path, run_async, monkeypatch, condition):
    stopped = [False]
    module, _, controller = setup(framework_module, tmp_path, None, lambda: stopped[0])
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: 1000))
    run_async(controller.execute_model_call('mc_do', {'steps': [{'skill': 'follow', 'name': 'Companion'}]}))
    assert controller.persistent_review_candidate() == ('task', 'body-1')
    if condition == 'finite':
        controller.action_requests[('task', 'body-1')][1]['steps'][0]['skill'] = 'collect'
    elif condition == 'early':
        controller.last_decision = 950
    elif condition == 'unknown_scope':
        controller.action_scopes[('task', 'body-1')] = 'another-world'
    elif condition == 'unknown_request':
        controller.action_requests.clear()
    elif condition == 'foreign_goal':
        controller.active_goal = {'id': 'another-goal'}
    elif condition == 'death':
        controller.death_waiting = True
    elif condition == 'inflight':
        controller.inflight_request = {'request_id': 'unknown-delivery'}
    elif condition == 'feedback':
        controller.feedback_pending = True
    elif condition == 'stop':
        stopped[0] = True
    assert controller.persistent_review_candidate() is None


def test_queued_successors_do_not_hide_a_persistent_follow(
        framework_module, tmp_path, run_async, monkeypatch):
    module, _, controller = setup(framework_module, tmp_path, None)
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: 1000))
    run_async(controller.execute_model_call('mc_do', {'steps': [{'skill': 'follow', 'name': 'Companion'}]}))
    controller.pending[('task', 'queued-successor')] = {
        **action(), 'id': 'queued-successor'}
    assert controller.persistent_review_candidate() == ('task', 'body-1')


def test_terminal_during_review_discards_the_stale_model_stop(
        framework_module, tmp_path, run_async):
    async def decide(*_):
        controller.receipt({'execution': action(True)})
        return {'content': None, 'tool_calls': [{'id': 'stale-stop', 'type': 'function',
            'function': {'name': 'mc_stop', 'arguments': '{}'}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({'name': 'mc_stop', 'inputSchema': {'type': 'object'}})
    run_async(controller.execute_model_call('mc_do', {'steps': [{'skill': 'follow', 'name': 'Companion'}]}))
    controller.persistent_review_anchor = ('task', 'body-1')
    run_async(controller.turn_once('survive', 'body contract', module.model_tools(bridge.tools)))
    assert controller.preempted and controller.persistent_review_invalidated
    assert not any(name == 'mc_stop' for name, _, _ in bridge.calls)


def test_review_respects_planner_backoff(
        framework_module, tmp_path, run_async, monkeypatch):
    clock, calls, held = [1000], [], [False]

    async def decide(*_):
        calls.append(clock[0])
        if len(calls) == 1:
            return plan('follow', name='Companion')
        return {'content': 'Continue useful work.', 'tool_calls': []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    def hold():
        if controller.pending and not held[0]:
            held[0] = True
            controller.planner_retry_at = 1080

    bridge.on_poll = hold
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    run_async(controller.run('survive'))
    assert calls == [1000, 1080]
