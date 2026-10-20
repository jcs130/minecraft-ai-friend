"""Plan a bounded native continuation before the body queue drains."""
import asyncio
import copy
import dataclasses
import json
from types import SimpleNamespace

import pytest

from test_controller import action, choose, setup


def plan(skill='collect', **arguments):
    reply = choose()
    reply['tool_calls'][0]['function']['arguments'] = json.dumps(
        {'steps': [{'skill': skill, **arguments}]})
    return reply


def test_finite_native_work_can_receive_one_append_plan_before_its_terminal(
        framework_module, tmp_path, run_async, monkeypatch):
    clock, decisions, accepted = [1000], [], []

    async def decide(messages, tools):
        decisions.append((clock[0], messages, tools))
        return plan(block='oak_log', count=len(decisions))

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1024)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, min_decision_seconds=10)
    original_call, original_sleep = bridge.call, asyncio.sleep

    async def call(name, arguments, **metadata):
        result = await original_call(name, arguments, **metadata)
        if name == 'mc_do':
            result = copy.deepcopy(result)
            identifier = 'body-' + str(len(accepted) + 1)
            result['structuredContent']['execution']['id'] = identifier
            accepted.append((clock[0], identifier, arguments))
        return result

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    bridge.call = call
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    run_async(controller.run('survive'))
    assert [row[0] for row in decisions] == [1000, 1001], (
        'A finite running body task never gets a successor until after it stops'
    )
    assert len(accepted) == 2 and accepted[1][2]['queue'] == 'append'
    assert 'body-1' in json.dumps(decisions[1][1])
    ahead_tool = next(t['function'] for t in decisions[1][2] if t['function']['name'] == 'mc_do')
    assert ahead_tool['parameters']['properties']['queue']['enum'] == ['append']
    assert not any(name == 'mc_stop' for name, _, _ in bridge.calls)
    journal = [json.loads(line) for line in (tmp_path / 'decisions.jsonl').read_text(encoding='utf-8').splitlines()]
    assert journal[-1]['planning_mode'] == 'native_lookahead'
    assert journal[-1]['native_pending'] == ['body-1']
    assert journal[-1]['request_started_at'] <= journal[-1]['at']


def test_conversation_while_body_is_running_does_not_delay_its_later_completion(
        framework_module, tmp_path, run_async):
    async def decide(*_):
        return {'content': '看到你啦，我还在砍这棵树。', 'tool_calls': []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.receipt({'execution': action()})
    run_async(controller.turn_once('survive', 'body contract', module.model_tools(bridge.tools)))
    assert controller.planner_retry_at == 0, (
        'A reply while actual work is running schedules a 60-second no-action pause'
    )
    assert controller.unactioned_replies == 0
    controller.receipt({'execution': action(True)})
    assert not controller.pending and controller.planner_retry_at == 0


@pytest.mark.parametrize('skill', ['follow', 'wait'])
def test_explicit_follow_or_wait_does_not_create_background_planning(
        framework_module, tmp_path, run_async, monkeypatch, skill):
    clock, calls = [1000], []

    async def decide(*_):
        calls.append(clock[0])
        return plan(skill, **({'name': 'Alex'} if skill == 'follow' else {'seconds': 60}))

    module, _, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1030)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, min_decision_seconds=10)
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    run_async(controller.run('survive'))
    assert calls == [1000]


@pytest.mark.parametrize('reason', ['read_only', 'foreign_scope', 'already_planned', 'two_pending',
                                   'unknown_dispatch', 'stopped', 'feedback', 'death'])
def test_only_known_single_body_frontier_grants_lookahead(
        framework_module, tmp_path, reason):
    _, _, controller = setup(framework_module, tmp_path, None)
    key = ('task', 'body-1')
    controller.pending[key] = action()
    controller.action_requests[key] = ('mc_do', {'steps': [{'skill': 'collect', 'block': 'oak_log'}]}, 'r1', reason == 'read_only')
    controller.action_scopes[key] = 'other' if reason == 'foreign_scope' else controller.game_scope
    if reason == 'already_planned':
        controller.lookahead_used.add(key)
    elif reason == 'two_pending':
        controller.pending[('task', 'body-2')] = action()
    elif reason == 'unknown_dispatch':
        controller.inflight_request = 'unknown'
    elif reason == 'stopped':
        controller.operator_stop = True
    elif reason == 'feedback':
        controller.feedback_pending = True
    elif reason == 'death':
        controller.death_waiting = True
    assert controller.lookahead_candidate() is None


@pytest.mark.parametrize('queue', ['now', 'afterCheckpoint'])
def test_ahead_plan_cannot_interrupt_or_insert_into_running_work(
        framework_module, tmp_path, queue):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    controller.lookahead_anchor = ('task', 'body-1')
    reply = plan(block='oak_log')
    reply['tool_calls'][0]['function']['arguments'] = json.dumps(
        {'steps': [{'skill': 'collect', 'block': 'oak_log'}], 'queue': queue})
    with pytest.raises(module.ModelCallRejected, match='append'):
        controller.prepare_calls(reply['tool_calls'], controller.lookahead_tools(module.model_tools(bridge.tools)))
    assert bridge.calls == []


def test_failed_anchor_during_inference_discards_the_ahead_plan(
        framework_module, tmp_path, run_async):
    async def decide(*_):
        return plan('craft', item='oak_planks', count=4)

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    run_async(controller.execute_model_call('mc_do', {'steps': [{'skill': 'collect', 'block': 'oak_log'}]}))
    controller.lookahead_anchor = ('task', 'body-1')
    bridge.event_pages = [[{'cursor': 1, 'trigger': 'piggyback',
        'execution': {**action(True), 'phase': 'blocked', 'evidence': {'receipt': 'No wood collected'}}}]]
    run_async(controller.turn_once('survive', 'body contract', module.model_tools(bridge.tools)))
    assert sum(name == 'mc_do' for name, _, _ in bridge.calls) == 1
    assert controller.preempted and controller.lookahead_invalidated


def test_waiting_ahead_reply_is_one_opportunity_not_a_model_loop(
        framework_module, tmp_path, run_async, monkeypatch):
    clock, calls = [1000], []

    async def decide(*_):
        calls.append(clock[0])
        return plan(block='oak_log') if len(calls) == 1 else {'content': '先等这棵树砍完。', 'tool_calls': []}

    module, _, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1040)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, min_decision_seconds=10)
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    run_async(controller.run('survive'))
    assert calls == [1000, 1001]
    assert controller.planner_retry_at == 0


@pytest.mark.parametrize('stop_at,expected', [(1010, [1000]), (1030, [1000, 1015])])
def test_ahead_opportunity_preserves_backoff_and_user_stop(
        framework_module, tmp_path, run_async, monkeypatch, stop_at, expected):
    clock, calls, held = [1000], [], [False]

    async def decide(*_):
        calls.append(clock[0])
        return plan(block='oak_log')

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= stop_at)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, min_decision_seconds=10)
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    def hold():
        if controller.pending and not held[0]:
            held[0] = True
            controller.planner_retry_at = 1015

    bridge.on_poll = hold
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    run_async(controller.run('survive'))
    assert calls == expected
