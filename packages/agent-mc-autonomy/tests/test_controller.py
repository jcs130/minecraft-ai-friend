import asyncio
import dataclasses
import importlib
import json
from types import SimpleNamespace

import pytest


def packed(value):
    return {"content": [{"type": "text", "text": json.dumps(value)}]}


def action(terminal=False):
    return {"kind": "task", "id": "body-1", "phase": "completed" if terminal else "accepted",
            "terminal": terminal, "goalCompleted": False}


def choose():
    return {"content": None, "tool_calls": [{"id": "call-1", "type": "function",
            "function": {"name": "mc_do", "arguments": '{"steps":[]}'}}]}


class Bridge:
    def __init__(self):
        self.tools = [{"name": "mc_do", "inputSchema": {"type": "object"}, "_meta": {"agent-mc/v1": {"tags": ["act"]}}}]
        self.calls, self.artifacts = [], []
        self.opened = self.closed = False
        self.event_pages = []
        self.on_poll = lambda: None
        self.result = {"text": "accepted, not completed", "protocol": "agent-mc/v1", "execution": action()}

    async def open(self):
        self.opened = True

    async def close(self):
        self.closed = True

    async def resource(self, _):
        return {"contents": [{"text": "Stable core rules"}]}

    async def call(self, name, args, **kwargs):
        self.calls.append((name, args, kwargs))
        if name == "mc_connection":
            return packed({"phase": "disconnected" if args["action"] == "disconnect" else "started",
                           "lamps": [{"label": "服务器", "state": "online"}]})
        if name == "mc_events":
            self.on_poll()
            return packed({"run": "run-1", "nextCursor": len(self.calls), "events": self.event_pages.pop(0) if self.event_pages else []})
        if name == "mc_artifact":
            if args["action"] == "get":
                return {"structuredContent": {"protocol": "agent-mc/v1", "text": self.artifacts[int(args["handle"].split(":")[1]) - 1]}}
            self.artifacts.append(args["text"])
            return packed({"handle": "log:" + str(len(self.artifacts))})
        if name == "mc_protocol":
            return packed({"parts": [{"key": "world", "text": "health=20", "original": "log:health"}]} if args["action"] == "facts" else {})
        if name == "mc_do":
            value = {**self.result, "control": {"requestId": kwargs["request_id"], "barrierAfter": True, "endTurnRequested": False}}
            return {"structuredContent": value}
        if name == "mc_help":
            return {"structuredContent": {"protocol": "agent-mc/v1", "text": "Read the next section"}}
        if name in {"mc_queue", "mc_bag"}:
            return packed({"text": "Idle"})
        raise AssertionError(name)


def setup(framework_module, tmp_path, decide, stop=lambda: False):
    module = importlib.import_module("agent_mc_autonomy.controller")
    bridge = Bridge()
    settings = dataclasses.replace(framework_module.Settings(), max_decisions=2)
    controller = module.Controller(bridge, decide, settings, tmp_path, lambda **_: None, stop)
    return module, bridge, controller


def test_actual_turn_uses_shared_identity_and_selected_memory_without_public_plaintext(framework_module, tmp_path, run_async):
    shared = {"stable": {"agent_name": "TestRole", "persona": "珍惜材料", "persona_source": "host_projection"},
              "dynamic": {"current_intent": "收集食物", "memories": [{"id": "m-1", "source": "recall", "text": "保护建筑"}]}}
    captured, published = [], []

    async def decide(messages, _):
        captured.append(messages)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.host_context_provider = lambda _: shared
    controller.publish = lambda **value: published.append(value)
    run_async(controller.turn_once("survive", "body contract", module.model_tools(bridge.tools)))
    assert "珍惜材料" in captured[0][0]["content"]
    assert "m-1" not in captured[0][0]["content"]
    assert json.loads(captured[0][-1]["content"])["host_context"]["memories"][0]["text"] == "保护建筑"
    metadata = next(row["host_context"] for row in published if "host_context" in row)
    assert metadata["memory_count"] == 1 and metadata["persona_bytes"] > 0
    assert "保护建筑" not in json.dumps(published, ensure_ascii=False)
    assert "珍惜材料" not in json.dumps(published, ensure_ascii=False)


def test_accepted_receipt_preserves_action_and_acknowledges_barrier(framework_module, tmp_path, run_async):
    async def decide(*_):
        return choose()
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.persist(stopped=False)
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert controller.pending[("task", "body-1")]["terminal"] is False
    phases = [args["action"] for name, args, _ in bridge.calls if name == "mc_protocol"]
    assert phases == ["begin_turn", "facts", "ack_barrier", "end_turn"]
    call = next(row for row in bridge.calls if row[0] == "mc_do")
    assert call[2]["turn_id"] and call[2]["request_id"]
    assert call[2]["attribution"] == {"controller": "system2", "decisionId": call[2]["turn_id"]}
    assert json.loads((tmp_path / "receipts.jsonl").read_text())["result"]["execution"]["goalCompleted"] is False


def test_bounded_read_round_can_continue_without_unrelated_world_change(framework_module, tmp_path, run_async):
    async def decide(*_):
        response = choose()
        response["tool_calls"][0]["function"] = {"name": "mc_help", "arguments": "{}"}
        return response
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert controller.continuation_needed and not controller.pending
    assert len(controller.groups) == 1


def test_read_activity_survives_acceptance_and_pruned_history_until_observed_change(framework_module, tmp_path, run_async):
    seen = []
    selected = ["mc_help"]

    async def decide(messages, _):
        seen.append(json.loads(messages[-1]["content"]))
        response = choose()
        response["tool_calls"][0]["function"] = {"name": selected[0], "arguments": "{}"}
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    tools = module.model_tools(bridge.tools)
    for _ in range(10):
        run_async(controller.turn_once("survive", "prefix", tools))
        controller.groups.clear()  # Reproduce a tight context evicting older reads.
    assert seen[-1]["read_activity"]["calls_since_body_action"] == {"mc_help": 9}
    assert seen[-1]["read_activity"]["action_progress_verified"] is False
    selected[0] = "mc_do"
    run_async(controller.turn_once("survive", "prefix", tools))
    controller.receipt({"execution": action(terminal=True)})
    assert controller.read_activity == {"mc_help": 10}  # Completion without an effect is still unknown.
    controller.game_facts = {"observation": {"dimension": "overworld", "inventory": {"oak_log": 1}}}
    controller.observe_game_facts({"observation": {"dimension": "overworld", "inventory": {"oak_log": 2}}})
    selected[0] = "mc_help"
    run_async(controller.turn_once("survive", "prefix", tools))
    assert "read_activity" not in seen[-1]


def test_failed_tool_evidence_reaches_host_review_and_read_success_cannot_clear_it(framework_module, tmp_path, run_async):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    published = {}
    controller.publish = lambda **values: published.update(values)
    controller.turn = "failed-turn"
    bridge.result = {"protocol": "agent-mc/v1", "failed": True, "execution": None,
                     "text": "Invalid arguments: pitch must be within -90..90"}
    run_async(controller.execute_model_call("mc_do", {"steps": [{"skill": "observe", "rays": [[120, 0, 32]]}]}))
    diagnostic = published["tool_failure"]
    assert diagnostic["tool"] == "mc_do" and "pitch" in diagnostic["error"]
    receipt = json.loads((tmp_path / "receipts.jsonl").read_text())
    assert diagnostic["receipt"] == {"request_id": receipt["requestId"], "turn_id": "failed-turn", "archive": "receipts.jsonl"}
    assert "arguments" not in diagnostic and "parameter_help" not in diagnostic
    run_async(controller.execute_model_call("mc_help", {}))
    assert published["tool_failure"] == diagnostic  # Reading help is not a repaired action.
    run_async(controller.execute_model_call("mc_do", {"steps": [{"skill": "observe", "rays": [[120, 0, 32]]}]}))
    assert published["tool_failure"]["receipt"] == diagnostic["receipt"]  # No invented second body receipt.
    bridge.result = {"protocol": "agent-mc/v1", "text": "accepted", "execution": action()}
    run_async(controller.execute_model_call("mc_do", {"steps": [{"skill": "observe", "rays": [[0, 120, 32]]}]}))
    assert published["tool_failure"] is None


def test_predispatch_rejection_publishes_decision_reference_without_fake_receipt(framework_module, tmp_path):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    published = {}
    controller.publish = lambda **values: published.update(values)
    controller.turn = "invalid-batch"
    bridge.tools[0]["inputSchema"] = {"type": "object", "properties": {"steps": {"type": "array"}}}
    call = choose()["tool_calls"]
    call[0]["function"]["arguments"] = '{"steps":"invalid"}'
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_calls(call, module.model_tools(bridge.tools))
    assert published["tool_failure"]["receipt"] == {"request_id": None, "turn_id": "invalid-batch", "archive": "decisions.jsonl"}
    assert bridge.calls == [] and not (tmp_path / "receipts.jsonl").exists()


def test_plain_plan_is_retained_and_revisited_with_bounded_backoff(framework_module, tmp_path, run_async):
    seen = []
    plan = "已有工作台和工具，接下来寻找食物并准备庇护所。"

    async def decide(messages, _):
        seen.append(messages)
        return {"content": plan, "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.continuation_needed
    assert controller.settings.idle_decision_seconds - 1 <= controller.planner_retry_at - module.time.monotonic() <= 300
    assert not controller.pending
    run_async(controller.turn_once("survive", "prefix", tools))
    assert {"role": "assistant", "content": plan} in seen[-1]
    assert "no game action was dispatched" in json.loads(seen[-1][-1]["content"])["planner_notice"]
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)
    for _ in range(10):
        run_async(controller.turn_once("survive", "prefix", tools))
    assert len(controller.groups) == 8
    assert 299 <= controller.planner_retry_at - module.time.monotonic() <= 300
    journal = [json.loads(line) for line in (tmp_path / "decisions.jsonl").read_text(encoding="utf-8").splitlines()]
    assert all(row["response"]["content"] == plan for row in journal)

    async def act(*_):
        return choose()

    controller.decide = act
    run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.unactioned_replies == 0 and controller.planner_retry_at == 0


@pytest.mark.parametrize("interrupt", ["none", "user_goal", "user_feedback", "danger", "stop"])
def test_unacted_plan_timer_keeps_event_and_user_priority(framework_module, tmp_path, run_async, monkeypatch, interrupt):
    clock, decisions, stopped = [1000], [], [False]

    async def decide(messages, _):
        decisions.append((clock[0], messages[1]["content"]))
        return {"content": "Next I will gather food.", "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: stopped[0])
    controller.settings = dataclasses.replace(controller.settings, min_decision_seconds=1, idle_decision_seconds=60)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        stopped[0] = clock[0] >= (1005 if interrupt == "stop" else 1100)
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)
    if interrupt in {"user_goal", "user_feedback"}:
        from agent_mc_autonomy.mailbox import Mailbox
        controller.commands = Mailbox(tmp_path)

        def feedback():
            if clock[0] == 1004:
                kind = "feedback" if interrupt == "user_feedback" else "goal"
                payload = {"goal": "Return to shelter", **({"mode": "insert"} if kind == "feedback" else {})}
                controller.commands.submit(kind, payload, "a6e8b876-9720-4a84-a049-74f3fb4e3b28")

        bridge.on_poll = feedback
    elif interrupt == "danger":
        def danger():
            if clock[0] == 1004:
                bridge.event_pages.append([{"cursor": 1, "trigger": "interrupt", "text": "Health dropped"}])

        bridge.on_poll = danger
    run_async(controller.run("survive"))
    assert decisions[0][0] == 1000
    if interrupt == "stop":
        assert len(decisions) == 1
    elif interrupt == "none":
        assert [time for time, _ in decisions] == [1000, 1060]
    else:
        assert 1004 <= decisions[1][0] < 1060
        if interrupt in {"user_goal", "user_feedback"}:
            assert "Return to shelter" in decisions[1][1]
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)
    assert bridge.closed


def test_rejected_body_action_does_not_erase_read_activity(framework_module, tmp_path, run_async):
    choices = iter(["mc_help", "mc_do", "mc_help"])
    seen = []

    async def decide(messages, _):
        seen.append(json.loads(messages[-1]["content"]))
        response = choose()
        response["tool_calls"][0]["function"] = {"name": next(choices), "arguments": "{}"}
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    bridge.result = {"protocol": "agent-mc/v1", "text": "Invalid arguments: unknown skill", "failed": True, "execution": None}
    for _ in range(3):
        run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert seen[-1]["read_activity"]["calls_since_body_action"] == {"mc_help": 1}


def test_rejected_tool_exposes_exact_parameter_help_in_next_request(framework_module, tmp_path, run_async):
    seen = []

    async def decide(messages, _):
        seen.append(messages)
        if len(seen) == 1:
            result = choose()
            result["tool_calls"][0]["function"] = {"name": "mc_scout", "arguments": '{"steps":[{"skill":"find","bounds":[-8,-2,-8,7,6,7]}]}'}
            return result
        return {"content": "Read the corrected schema", "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_scout", "inputSchema": {"type": "object", "properties": {
        "steps": {"type": "array", "items": {"type": "object", "properties": {
            "skill": {"type": "string", "enum": ["observe", "probe"]},
            "bounds": {"type": "array", "description": "Inclusive volume <=512 cells"}}}}}}})
    original_call = bridge.call

    async def call(name, args, **kwargs):
        if name == "mc_scout":
            bridge.calls.append((name, args, kwargs))
            return {"isError": True, "content": [{"type": "text", "text": "Invalid arguments: data/steps/0/skill must be equal to one of the allowed values"}]}
        return await original_call(name, args, **kwargs)

    bridge.call = call
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert not any(name == "mc_scout" for name, *_ in bridge.calls)
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    tail = json.loads(seen[1][-1]["content"])
    recovery = tail["tool_failure"]
    assert recovery["tool"] == "mc_scout"
    assert recovery["parameter_help"]["steps.skill"]["enum"] == ["observe", "probe"]
    assert recovery["parameter_help"]["steps.bounds"]["description"] == "Inclusive volume <=512 cells"
    assert "find" in str(recovery["arguments"])
    assert "mc_help" in recovery["next_step"]


@pytest.mark.parametrize("error", ["Invalid arguments: missing block", '[mc_do 失败] 第 1 步 voxels 请求尺寸超限。你写的是 [{"skill":"observe"}]'])
def test_identical_rejected_call_is_not_dispatched_again(framework_module, tmp_path, run_async, error):
    seen = []

    async def decide(messages, _):
        seen.append(messages)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.result = {"text": error, "protocol": "agent-mc/v1", "failed": True, "execution": None}
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert len([c for c in bridge.calls if c[0] == "mc_do"]) == 1
    assert len(seen) == 2
    assert controller.continuation_needed and controller.planner_retry_at == 0
    assert not controller.pending and controller.inflight_request is None


def test_native_scout_is_advertised_and_defaults_to_append(framework_module, tmp_path, run_async):
    async def decide(*_):
        response = choose()
        response["tool_calls"][0]["function"]["name"] = "mc_scout"
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_scout", "inputSchema": {"type": "object"}})
    original_call = bridge.call

    async def call(name, args, **kwargs):
        if name == "mc_scout":
            bridge.calls.append((name, args, kwargs))
            return {"structuredContent": bridge.result}
        return await original_call(name, args, **kwargs)

    bridge.call = call
    tools = module.model_tools(bridge.tools)
    assert any(tool["function"]["name"] == "mc_scout" for tool in tools)
    run_async(controller.turn_once("observe the world", "prefix", tools))
    submitted = next(args for name, args, _ in bridge.calls if name == "mc_scout")
    assert submitted["queue"] == "append"
    assert controller.pending[("task", "body-1")]["terminal"] is False
    recorded = json.loads((tmp_path / "decisions.jsonl").read_text())
    assert recorded["response"]["tool_calls"][0]["function"]["name"] == "mc_scout"


def test_rejected_inference_keeps_body_and_latest_receipt_then_recovers(framework_module, tmp_path, run_async):
    planner = importlib.import_module("agent_mc_autonomy.planner")
    attempts = []

    async def decide(messages, _):
        attempts.append(messages)
        if len(attempts) == 1:
            raise planner.PlannerResponseError({"choice": {"finish_reason": "length", "message": choose()}})
        assert "previous model response" in messages[-1]["content"]
        assert "collect does not support at" in json.dumps(messages)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.persist(stopped=False)
    controller.groups = [[{"role": "assistant", "content": None, "tool_calls": choose()["tool_calls"]},
                          {"role": "tool", "tool_call_id": "call-1", "content": "collect does not support at"}]]
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.continuation_needed and controller.planner_failures == 1
    assert controller.planner_retry_at > module.time.monotonic()
    assert not bridge.closed and not any(name == "mc_do" for name, *_ in bridge.calls)
    assert not json.loads(controller.state_path.read_text())["stopped"]
    run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.planner_failures == 0 and controller.planner_notice is None
    assert len([name for name, *_ in bridge.calls if name == "mc_do"]) == 1
    records = [json.loads(line) for line in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert records[0]["dispatched"] is False and records[0]["rejected"]["choice"]["finish_reason"] == "length"
    assert records[1]["response"] == choose()


def test_repeated_incomplete_inference_backs_off_without_disconnecting_body(framework_module, tmp_path, run_async):
    planner = importlib.import_module("agent_mc_autonomy.planner")
    recovered = [False]

    async def decide(*_):
        if recovered[0]:
            return choose()
        raise planner.PlannerResponseError({"choice": {"finish_reason": "length"}})

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.persist(stopped=False)
    tools = module.model_tools(bridge.tools)
    for _ in range(10):
        run_async(controller.turn_once("survive", "prefix", tools))
        # Same-tick Windows readings can subtract a few floating-point ULPs
        # above 300, without extending the configured backoff.
        assert 0 < controller.planner_retry_at - module.time.monotonic() <= 300.000001
    assert controller.planner_failures == 10 and controller.inflight_request is None
    assert controller.planner_retry_at - module.time.monotonic() >= 299
    assert controller.continuation_needed and not bridge.closed
    assert not json.loads(controller.state_path.read_text())["stopped"]
    assert not any(name == "mc_do" for name, *_ in bridge.calls)
    assert [args["action"] for name, args, _ in bridge.calls if name == "mc_protocol"].count("end_turn") == 10
    recovered[0] = True
    run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.planner_failures == 0 and controller.planner_retry_at == 0
    assert len([name for name, *_ in bridge.calls if name == "mc_do"]) == 1


@pytest.mark.parametrize("bad_call", [
    {"name": "mc_goal", "arguments": '{"arguments":{"action":"set","goal":"get food"},"name":"mc_goal"}'},
    {"name": "mc_do", "arguments": "[]"},
    {"name": "mc_do", "arguments": "{"},
    {"name": "mc_invoke", "arguments": '{"name":"mc_connection","arguments":{"action":"disconnect"}}'},
    {"name": "mc_protocol", "arguments": '{"action":"ack_barrier","id":"foreign"}'},
])
def test_invalid_model_call_is_not_dispatched_and_can_recover(framework_module, tmp_path, run_async, bad_call):
    seen = []
    invalid = choose()
    invalid["tool_calls"][0]["function"] = bad_call

    async def decide(messages, _):
        seen.append(messages)
        return invalid if len(seen) == 1 else choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.extend([
        {"name": "mc_goal", "inputSchema": {"type": "object"}},
        {"name": "mc_protocol", "inputSchema": {"type": "object", "properties": {}}},
    ])
    controller.persist(stopped=False)
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.continuation_needed
    if bad_call['arguments'] == '{':
        assert controller.continuation_ready  # One known pre-dispatch JSON correction can run promptly.
    else:
        assert controller.planner_retry_at == 0
    assert not bridge.closed and controller.inflight_request is None
    assert not json.loads(controller.state_path.read_text()).get("uncertain")
    assert all(name == "mc_events" or (name == "mc_protocol" and args["action"] in {"begin_turn", "facts", "end_turn"})
               for name, args, _ in bridge.calls)
    records = [json.loads(line) for line in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert records[0]["response"] == invalid
    assert records[-1]["dispatched"] is False
    run_async(controller.turn_once("survive", "prefix", tools))
    assert "No tool was dispatched" in seen[1][-1]["content"]
    assert len([row for row in bridge.calls if row[0] == "mc_do"]) == 1
    assert controller.pending[("task", "body-1")]["terminal"] is False


@pytest.mark.parametrize("steps", ['[{"skill":"craft","item":"oak_planks"}', [], [{"skill": "craft", "count": True}]])
def test_native_schema_rejection_precedes_batch_dispatch_and_uncertainty(framework_module, tmp_path, run_async, steps):
    response = {"content": None, "tool_calls": [
        {"id": "read", "type": "function", "function": {"name": "mc_bag", "arguments": "{}"}},
        {"id": "action", "type": "function", "function": {"name": "mc_do", "arguments": json.dumps({"steps": steps})}},
    ]}

    async def decide(*_):
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools[0]["inputSchema"] = {"type": "object", "properties": {
        "steps": {"type": "array", "minItems": 1, "items": {"type": "object", "properties": {
            "skill": {"enum": ["craft"]}, "count": {"type": "integer", "minimum": 1}}, "required": ["skill"]}}}, "required": ["steps"]}
    bridge.tools.append({"name": "mc_bag", "inputSchema": {"type": "object"}})
    controller.persist(stopped=False)
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert not any(name in {"mc_do", "mc_bag"} for name, *_ in bridge.calls)
    assert controller.inflight_request is None
    assert not json.loads(controller.state_path.read_text()).get("uncertain")
    assert controller.continuation_needed and "steps" in controller.planner_notice
    assert "No tool was dispatched" in controller.planner_notice


def test_advanced_arguments_use_native_schema_before_dispatch(framework_module, tmp_path):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append({"name": "mc_script", "inputSchema": {"type": "object", "properties": {
        "timeoutMs": {"type": "integer", "maximum": 120000}}}})
    call = {"id": "advanced", "type": "function", "function": {"name": "mc_invoke", "arguments":
        json.dumps({"name": "mc_script", "arguments": {"timeoutMs": 120001}})}}
    with pytest.raises(module.ModelCallRejected, match="timeoutMs"):
        controller.prepare_calls([call], module.model_tools(bridge.tools))
    assert bridge.calls == [] and not controller.state_path.exists()


def test_mailbox_dispatch_rejects_schema_error_without_uncertain_journal(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools[0]["inputSchema"] = {"type": "object", "properties": {"steps": {"type": "array"}}, "required": ["steps"]}
    result, _ = run_async(controller.dispatch("mc_do", {"steps": "[]"}, "invalid-mailbox"))
    assert result["failed"] and result["dispatched"] is False and result["execution"] is None
    assert not bridge.calls and controller.inflight_request is None and not controller.state_path.exists()
    assert json.loads((tmp_path / "receipts.jsonl").read_text())["result"] == result


def test_native_schema_refs_are_local_only(framework_module):
    from agent_mc_autonomy.tool_schema import argument_error

    schema = {"$defs": {"step": {"type": "array"}}, "$ref": "#/$defs/step"}
    assert argument_error([{"name": "local", "inputSchema": schema}], "local", []) is None
    remote = {"$ref": "https://example.invalid/schema.json"}
    assert "locally" in argument_error([{"name": "remote", "inputSchema": remote}], "remote", {})


@pytest.mark.parametrize("last_tool", ["mc_do", "mc_scout"])
@pytest.mark.parametrize("read_boundary", ["none", "end", "failed", "stop"])
def test_read_batch_runs_in_order_and_obeys_native_boundary(framework_module, tmp_path, run_async, last_tool, read_boundary):
    planner = importlib.import_module("agent_mc_autonomy.planner")
    calls = [{"id": "bag", "type": "function", "function": {"name": "mc_bag", "arguments": "{}"}},
             {"id": "next", "type": "function", "function": {"name": last_tool, "arguments": '{"steps":[]}'}}]

    async def decide(*_):
        return planner.decision({"content": "Read inventory, then submit the selected task", "tool_calls": calls})

    stopped = False
    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: stopped)
    bridge.tools.extend([{"name": name, "inputSchema": {"type": "object"}} for name in ("mc_bag", "mc_scout")])
    original_call = bridge.call

    async def call(name, args, **kwargs):
        nonlocal stopped
        if name == "mc_bag":
            bridge.calls.append((name, args, kwargs))
            stopped = read_boundary == "stop"
            return {"structuredContent": {"protocol": "agent-mc/v1", "text": "wood=34",
                                          "endsTurn": read_boundary == "end", "failed": read_boundary == "failed"}}
        return await original_call("mc_do" if name == "mc_scout" else name, args, **kwargs)

    bridge.call = call
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    relevant = [name for name, *_ in bridge.calls if name in {"mc_bag", "mc_do"}]
    assert relevant == (["mc_bag", "mc_do"] if read_boundary == "none" else ["mc_bag"])
    exchange = controller.groups[-1]
    assert exchange[0]["tool_calls"] == calls
    assert [row["tool_call_id"] for row in exchange[1:]] == ["bag", "next"]
    if read_boundary != "none":
        skipped = json.loads(exchange[-1]["content"])
        assert skipped["dispatched"] is False and skipped["origin"] == "controller_boundary"
        assert not controller.pending
    else:
        assert controller.pending[("task", "body-1")]["terminal"] is False


def test_invalid_later_call_rejects_whole_batch_before_reading(framework_module, tmp_path, run_async):
    async def decide(*_):
        response = choose()
        response["tool_calls"].insert(0, {"id": "read", "type": "function", "function": {"name": "mc_help", "arguments": "{}"}})
        response["tool_calls"][1]["function"]["arguments"] = "{"
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert not any(name in {"mc_help", "mc_do"} for name, *_ in bridge.calls)
    assert "JSON" in controller.planner_notice


def test_multiple_mutating_calls_are_rejected_as_a_whole_without_freezing_other_decisions(framework_module, tmp_path, run_async):
    async def decide(*_):
        result = choose()
        result["tool_calls"] += [{**result["tool_calls"][0], "id": "call-2"}]
        return result

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    tools = module.model_tools(bridge.tools)
    delays = []
    for _ in range(5):
        run_async(controller.turn_once("survive", "prefix", tools))
        delays.append(controller.planner_retry_at)
    assert delays == [0] * 5
    assert not any(row[0] == "mc_do" for row in bridge.calls)
    assert controller.inflight_request is None and not bridge.closed


@pytest.mark.parametrize("confirmed_disconnect", [True, False])
def test_running_actions_do_not_cause_idle_or_snapshot_replanning(framework_module, tmp_path, run_async, monkeypatch, confirmed_disconnect):
    decisions, polls, stopped = [], [], False

    async def decide(*_):
        decisions.append(True)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: stopped)
    published = {}
    controller.publish = lambda **patch: published.update(patch)
    original_call = bridge.call

    async def call(name, args, **kwargs):
        if name == "mc_connection" and args.get("action") == "disconnect" and not confirmed_disconnect:
            return packed({"phase": "unconfirmed"})
        return await original_call(name, args, **kwargs)

    bridge.call = call
    clock = [1000]
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 61
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)

    def on_poll():
        nonlocal stopped
        polls.append(True)
        stopped = len(polls) >= 8

    bridge.on_poll = on_poll
    bridge.event_pages = [[], *[[{"cursor": n, "type": "snapshot", "trigger": "flush", "text": "unchanged"}] for n in range(7)]]
    run_async(controller.run("survive"))
    assert len(decisions) == 1
    assert bridge.closed
    state = json.loads((tmp_path / "host-state.json").read_text())
    assert state["stopped"] is True
    if confirmed_disconnect:
        assert state["pending"] == [] and published["pending"] == []
        assert published["disconnect_confirmed"] is True
        # Disconnect is a lifecycle receipt, never invented native completion.
        assert not published.get("native_outcomes")
    else:
        assert state["pending"] and published["pending"]
        assert state["uncertain"] is True and published["disconnect_confirmed"] is False


def test_stop_during_model_wait_blocks_late_action(framework_module, tmp_path, run_async):
    async def exercise():
        entered = asyncio.Event()
        stopped = False

        async def slow(*_):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                return choose()  # Misbehaving client delivers a late completion.

        _, bridge, controller = setup(framework_module, tmp_path, slow, lambda: stopped)
        task = asyncio.create_task(controller.run("survive"))
        await entered.wait()
        stopped = True
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not any(row[0] == "mc_do" for row in bridge.calls)
        assert bridge.closed

    run_async(exercise())


def test_legacy_stage_keeps_standing_goal_without_claiming_user_priority(framework_module, tmp_path, run_async):
    seen = []

    async def decide(messages, _):
        seen.append(messages)
        return {"content": "Check the stage evidence before continuing survival", "tool_calls": []}

    _, _, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=1)
    controller.active_goal = {"id": "stage", "goal": "Gather a few logs and craft a workbench", "mode": "insert"}
    run_async(controller.run("Survive, establish food reserves and shelter"))
    prompt = "\n".join(m.get("content") or "" for m in seen[0])
    assert "Standing goal: Survive, establish food reserves and shelter" in prompt
    assert "Submitted stage (origin unknown): Gather a few logs and craft a workbench" in prompt
    assert "Current user feedback takes priority" not in prompt
    assert "goal_report" in prompt and "observed" in prompt


@pytest.mark.parametrize("origin", ["user", "host_review", "unknown"])
def test_goal_prompt_distinguishes_user_and_model_stage(framework_module, tmp_path, origin):
    from test_death_memory import facts
    _, _, controller = setup(framework_module, tmp_path, None)
    controller.observe_game_facts(facts())
    controller.active_goal = {"id": "stage", "goal": "find food", "origin": origin, "mode": "insert",
                              **({"stage_baseline": controller.stage_baseline()} if origin == "host_review" else {})}
    controller.feedback_pending = True
    prompt = controller.goal_prompt("survive")
    assert ("Current user feedback takes priority" in prompt) == (origin == "user")
    assert ("Host review proposed stage" in prompt) == (origin == "host_review")
    assert "safe checkpoint" in prompt


def test_host_stage_prompt_keeps_explicit_user_parent_goal(framework_module, tmp_path):
    import uuid

    from test_death_memory import facts

    from agent_mc_autonomy.mailbox import Mailbox
    _, _, controller = setup(framework_module, tmp_path, None)
    controller.observe_game_facts(facts())
    box = Mailbox(tmp_path)
    user, stage = str(uuid.uuid4()), str(uuid.uuid4())
    box.submit_user_intent("feedback", {"goal": "Find food, keep current shelter", "mode": "insert"}, user)
    box.activate_feedback(box.claim())
    box.submit("feedback", {"goal": "inspect berry bushes", "mode": "insert", "origin": "host_review", "parent_id": user,
                            "stage_baseline": controller.stage_baseline()}, stage)
    box.activate_feedback(box.claim())
    controller.commands, controller.active_goal = box, box.active_goal()
    controller.feedback_pending = True
    prompt = controller.goal_prompt("Survive safely")
    assert "Standing goal: Survive safely" in prompt
    assert "Current user goal (priority over proposed stages): Find food, keep current shelter" in prompt
    assert "Host review proposed stage: inspect berry bushes" in prompt
    assert "Current user feedback takes priority" not in prompt


def test_unknown_outcome_blocks_restart_without_replay(framework_module, tmp_path, run_async):
    async def decide(*_):
        return choose()
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.result["execution"]["evidence"] = {"outcomeKnown": False}
    controller.persist(stopped=False)
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert (tmp_path / "receipts.jsonl").exists()
    _, second, restart = setup(framework_module, tmp_path, decide)
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(restart.run("survive"))
    assert not second.opened and not second.calls


def test_large_receipts_are_retrievable_in_full(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    value = {"text": "原始证据🦊" * 16000}
    compact = run_async(controller.archive_receipt("r", "mc_read", value))
    assert json.loads("".join(bridge.artifacts)) == value
    assert json.loads(compact)["original_chunks"]
    assert all(len(part.encode("utf-16-le")) // 2 <= 64000 for part in bridge.artifacts)
    recovered = []
    for handle in json.loads(compact)["original_chunks"]:
        offset = 0
        while True:
            page = json.loads(run_async(controller.original_page({"handle": handle, "offset": offset}))["text"])
            assert len(page["text"].encode("utf-8")) <= 4000
            recovered.append(page["text"])
            offset = page["next_offset"]
            if not page["has_more"]:
                break
    assert json.loads("".join(recovered)) == value


def test_events_reconcile_terminal_but_ignore_archived_and_stale(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.receipt({"execution": action()})
    bridge.event_pages = [[{"execution": action(True), "contextDelivery": "archive-only", "trigger": "preempt"},
                           {"execution": action(True), "meta": {"staleEpoch": True}, "trigger": "preempt"}],
                          [{"execution": action(True), "trigger": "flush"}]]
    assert run_async(controller.events()) == (False, False, False)
    assert controller.pending
    assert run_async(controller.events()) == (True, False, False)
    assert not controller.pending


def test_started_engine_without_server_lamp_is_not_online(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    assert not module.online({"phase": "started", "lamps": []})


def test_sample_timestamp_alone_does_not_trigger_decisions(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    first = {"parts": [{"key": "sample", "text": "now"}, {"key": "health", "text": "20"}]}
    later = {"parts": [{"key": "sample", "text": "later"}, {"key": "health", "text": "20"}]}
    assert module.fact_fingerprint(first) == module.fact_fingerprint(later)


def test_progressive_tool_docs_preserve_constraints(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    original = {"name": "mc_do", "description": "长说明" * 800, "inputSchema": {
        "type": "object", "properties": {"steps": {"type": "array", "minItems": 1, "description": "步骤文档" * 200},
                                          "description": {"type": "string", "description": "This is a real parameter"}},
        "required": ["steps"], "additionalProperties": False}}
    tool = module.model_tools([original])[0]["function"]
    assert tool["parameters"]["required"] == ["steps"]
    assert tool["parameters"]["properties"]["steps"] == {"type": "array", "minItems": 1}
    assert tool["parameters"]["properties"]["description"] == {"type": "string", "description": "This is a real parameter"}
    details = module.tool_help([original], {"name": "mc_do", "path": "/inputSchema/properties/steps"})
    assert json.loads(details["text"]) == original["inputSchema"]["properties"]["steps"]
    assert original["description"] == "长说明" * 800


def test_compact_schema_keeps_coordinate_semantics_without_long_manuals(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    bounds = {"type": "array", "minItems": 6, "maxItems": 6, "items": {"type": "integer"},
              "description": "Relative to feet: [xmin,ymin,zmin,xmax,ymax,zmax], inclusive volume <=512"}
    rays = {"type": "array", "maxItems": 64, "items": {"type": "array", "items": {"type": "number"}},
            "description": "[pitch degrees,yaw degrees,distance]"}
    original = {"name": "mc_scout", "inputSchema": {"type": "object", "properties": {
        "steps": {"type": "array", "description": "Full manual " * 100,
                  "items": {"oneOf": [{"properties": {"bounds": bounds, "rays": rays}}]}}}}}
    compact = module.model_tools([original])[0]["function"]["parameters"]
    step = compact["properties"]["steps"]
    assert "description" not in step
    assert step["items"]["oneOf"][0]["properties"] == {"bounds": bounds, "rays": rays}


def test_action_and_observation_tools_keep_distinct_semantics(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    props = {"skill": {"type": "string", "enum": ["probe", "observe"]},
             "block": {"type": "string", "description": "用于 collect"}}
    catalog = [{"name": name, "inputSchema": {"properties": {"steps": {"items": {"properties": props}}}}} for name in ["mc_do", "mc_scout"]]
    tools = {t["function"]["name"]: t["function"] for t in module.model_tools(catalog)}
    assert "Execute real" in tools["mc_do"]["description"]
    assert "Read-only" in tools["mc_scout"]["description"]
    assert tools["mc_scout"]["parameters"]["properties"]["queue"] == {"enum": ["append", "afterCheckpoint", "now"]}
    assert tools["mc_do"]["parameters"]["properties"]["steps"]["items"]["properties"]["block"] == props["block"]
    original_step = json.loads(module.tool_help(catalog, {"name": "mc_do", "path": "/inputSchema/properties/steps/items"})["text"])
    assert original_step["properties"]["block"] == props["block"]
    failure = module.failure_context(catalog, "mc_scout", {"steps": [{"skill": "craft"}, {"skill": "collect"}]}, {"text": "Invalid arguments"})
    assert "collect, craft belongs to mc_do" in failure["next_step"]


def test_step_projection_preserves_envelope_and_full_native_constraints(framework_module, tmp_path):
    from agent_mc_autonomy.tool_schema import argument_error

    module, _, _ = setup(framework_module, tmp_path, None)
    schema = {"type": "object", "properties": {"steps": {"type": "array", "minItems": 1, "maxItems": 16,
        "items": {"type": "object", "properties": {
            "skill": {"type": "string", "enum": ["craft", "eat"]},
            "needs": {"type": "array", "items": {"type": "integer"}, "description": "Earlier step numbers, starting at one."},
            "item": {"type": "string", "description": "原生物品参数完整语义" * 60},
            "count": {"type": "integer", "minimum": 1}}, "required": ["skill"]}}}, "required": ["steps"]}
    original = {"name": "mc_do", "inputSchema": schema}
    before = json.dumps(original)
    projected = module.model_tools([original])[0]["function"]["parameters"]["properties"]["steps"]
    assert projected["type"] == "array" and projected["minItems"] == 1 and projected["maxItems"] == 16
    assert projected["items"]["properties"] == {
        **{k: schema["properties"]["steps"]["items"]["properties"][k] for k in ["skill", "needs", "count"]},
        "item": {"type": "string"}}
    assert projected["items"].get("additionalProperties", True) is True
    assert "flat step" in module.model_tools([original])[0]["function"]["description"]
    assert json.loads(module.tool_help([original], {"name": "mc_do", "path": "/inputSchema"})["text"]) == schema
    assert json.dumps(original) == before
    assert "minimum=1" in argument_error([original], "mc_do", {"steps": [{"skill": "craft", "count": 0}]})
    assert argument_error([original], "mc_do", {"steps": [{"skill": "craft", "item": "oak_planks", "count": 1}]}) is None


def test_forbidden_queue_policy_is_rejected_locally_then_planner_can_correct(framework_module, tmp_path, run_async):
    seen = []

    async def decide(messages, _):
        seen.append(messages)
        response = choose()
        if len(seen) == 1:
            response["tool_calls"][0]["function"] = {"name": "mc_scout", "arguments": '{"steps":[],"queue":"replace"}'}
        else:
            assert "queue" in messages[-1]["content"] and "append" in messages[-1]["content"]
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_scout", "inputSchema": {"type": "object"}})
    controller.persist(stopped=False)
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert not any(name == "mc_scout" for name, _, _ in bridge.calls)
    actual = [(name, args) for name, args, _ in bridge.calls if name == "mc_do"]
    assert actual == [("mc_do", {"steps": [], "queue": "append"})]
    records = [json.loads(line) for line in (tmp_path / "receipts.jsonl").read_text().splitlines()]
    assert records[0]["result"]["failed"] and records[0]["result"]["origin"] == "controller_validation"
    assert records[0]["result"]["execution"] is None
    assert controller.pending[("task", "body-1")]["terminal"] is False


def test_advanced_router_cannot_invoke_host_connection(framework_module, tmp_path, run_async):
    async def decide(*_):
        result = choose()
        result["tool_calls"][0]["function"] = {"name": "mc_invoke", "arguments": '{"name":"mc_connection","arguments":{"action":"connect"}}'}
        return result
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_goal", "inputSchema": {"type": "object"}})
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert controller.continuation_needed and "Unavailable advanced tool" in controller.planner_notice
    assert not any(row[0] in {"mc_do", "mc_connection"} for row in bridge.calls)


def test_large_script_and_artifact_schemas_remain_discoverable_on_demand(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    catalogue = [{"name": name, "inputSchema": {"type": "object", "properties": {
        "source": {"type": "string", "maxLength": 4000}}}} for name in ("mc_script", "mc_artifact")]
    tools = {t["function"]["name"]: t["function"] for t in module.model_tools(catalogue)}
    assert "mc_script" not in tools and "mc_artifact" not in tools
    assert tools["mc_invoke"]["parameters"]["properties"]["name"]["enum"] == ["mc_artifact", "mc_script"]
    assert json.loads(module.tool_help(catalogue, {"name": "mc_script"})["text"]) == catalogue[0]


def test_native_knowledge_is_discovered_as_an_immediate_read_only_when_available(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    catalogue = [{"name": "mc_knowledge", "description": "Versioned local vanilla knowledge",
                  "inputSchema": {"type": "object", "properties": {"action": {"enum": ["search", "get"]},
                    "id": {"type": "string"}, "query": {"type": "string"}}}}]
    tools = {t["function"]["name"]: t["function"] for t in module.model_tools(catalogue)}
    assert tools["mc_knowledge"]["parameters"] == catalogue[0]["inputSchema"]
    assert "mc_knowledge" in module.IMMEDIATE_READ_TOOLS
    assert module.observation_call("mc_knowledge", {"action": "get", "id": "food/beef"})
    assert "mc_knowledge" not in {t["function"]["name"] for t in module.model_tools([])}


def test_urgent_event_discards_inflight_plan(framework_module, tmp_path, run_async):
    async def decide(*_):
        await asyncio.Event().wait()
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.event_pages = [[{"trigger": "preempt", "type": "damage", "text": "hurt"}]]
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert controller.preempted
    assert controller.recent[0]["type"] == "damage"
    assert not any(row[0] == "mc_do" for row in bridge.calls)


def test_chat_arriving_during_model_wait_reaches_next_turn(framework_module, tmp_path, run_async):
    async def exercise():
        ready = asyncio.Event()

        async def decide(*_):
            await ready.wait()
            return {"content": "Waiting", "tool_calls": []}
        module, bridge, controller = setup(framework_module, tmp_path, decide)
        bridge.on_poll = ready.set
        bridge.event_pages = [[{"trigger": "debounce", "type": "chat", "text": "server guide"}]]
        await controller.turn_once("survive", "prefix", module.model_tools(bridge.tools))
        assert controller.deferred_wake
        assert controller.recent[0]["text"] == "server guide"
    run_async(exercise())


def test_context_tail_replaces_facts_and_budgets_all_fields(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    tools = [{"name": "tool", "description": "文" * 1000}]
    facts = {"parts": [{"key": "health", "text": "old"}, {"key": "health", "text": "20", "original": "log:h"},
                       {"key": "chat", "text": "聊天" * 20000, "original": "log:chat"}]}
    messages, usage = context.assemble("stable", tools, "survive", facts, [], [], context_tokens=8000, reserved_output=1024)
    tail = json.loads(messages[-1]["content"])
    assert tail["current_facts"] == [facts["parts"][1]]
    assert tail["omitted_facts"] == [{"key": "chat", "original": "log:chat"}]
    assert usage["total"] <= 8000
    other, _ = context.assemble("stable", tools, "survive", {"parts": []}, [], [], context_tokens=8000, reserved_output=1024)
    assert messages[:2] == other[:2]
    assert not json.loads(other[-1]["content"])["current_facts"]
    with pytest.raises(ValueError, match="context_budget_exceeded"):
        context.assemble("stable", tools * 5, "survive", facts, [], [], context_tokens=8000, reserved_output=1024)


def test_large_chinese_receipt_has_bounded_preview_and_lossless_originals(framework_module, tmp_path, run_async):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    result = {"text": "查询结果：中文和表情🌲" * 4000, "failed": False}
    compact = json.loads(run_async(controller.archive_receipt("large", "mc_help", result)))
    assert len(compact["text"].encode("utf-8")) <= 2800
    assert len(json.dumps(compact, ensure_ascii=False).encode("utf-8")) < 4000
    assert json.loads("".join(bridge.artifacts)) == result
    assert json.loads((tmp_path / "receipts.jsonl").read_text(encoding="utf-8"))["result"] == result


def test_planner_receipt_omits_transport_ids_and_exact_duplicate_text_only(framework_module, tmp_path, run_async):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    result = {"text": "task accepted, not completed", "failed": False, "protocol": "agent-mc/v1",
              "control": {"requestId": "req", "turnId": "turn", "barrierAfter": True},
              "execution": {**action(), "evidence": {"receipt": "task accepted, not completed", "outcomeKnown": True}},
              "events": [{"type": "chat", "text": "help"}], "blobs": []}
    compact = json.loads(run_async(controller.archive_receipt("req", "mc_do", result)))
    assert "control" not in compact and "protocol" not in compact
    assert compact["text"] == result["text"]
    assert compact["execution"] == {**action(), "evidence": {"outcomeKnown": True}}
    assert compact["events"] == result["events"]  # Nonempty external evidence is not transport noise.
    assert json.loads((tmp_path / "receipts.jsonl").read_text())["result"] == result
    result["execution"]["evidence"]["receipt"] = "different native evidence"
    other = json.loads(run_async(controller.archive_receipt("req-2", "mc_do", result)))
    assert other["execution"]["evidence"]["receipt"] == "different native evidence"


def test_realclock_alone_does_not_trigger_another_decision(framework_module):
    module = importlib.import_module("agent_mc_autonomy.controller")
    parts = [{"key": "body", "text": "health 20/20"}]
    before = {"parts": parts + [{"key": "realclock", "text": "20:00"}, {"key": "sample", "text": "A"}]}
    after = {"parts": parts + [{"key": "realclock", "text": "20:01"}, {"key": "sample", "text": "B"}]}
    assert module.fact_fingerprint(before) == module.fact_fingerprint(after)
    assert module.fact_fingerprint(before) != module.fact_fingerprint({"parts": [{"key": "body", "text": "health 4/20"}]})


def test_tight_context_keeps_survival_facts_before_incidental_clock(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [], context_tokens=32768, reserved_output=1024)
    facts = {"parts": [{"key": "realclock", "text": "x" * 240}, {"key": "body", "text": "health 4/20"}]}
    messages, _ = context.assemble("stable", [], "survive", facts, [], [], context_tokens=base["total"] + 300, reserved_output=1024)
    assert json.loads(messages[-1]["content"])["current_facts"] == [facts["parts"][1]]


def test_standing_goal_report_is_rejected_without_stopping_or_writing_game(framework_module, tmp_path, run_async):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    result, compact = run_async(controller.dispatch("goal_report", {
        "outcome": "reported_done", "evidence": "I feel safe now"}, "report-standing"))
    assert result["failed"] and result["execution"] is None
    assert "standing goal continues" in compact
    assert bridge.calls == [] and controller.inflight_request is None
    assert not (tmp_path / "host-state.json").exists()


def test_large_stable_prefix_keeps_latest_tool_error(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    prefix = "p" * 22000
    latest = [{"role": "assistant", "content": None, "tool_calls": choose()["tool_calls"]},
              {"role": "tool", "tool_call_id": "call-1", "content": "Invalid arguments: skills maxItems is 4"}]
    _, base = context.assemble(prefix, [], "survive", {"parts": []}, [], [],
                               context_tokens=32768, reserved_output=1024)
    assert base["total"] > 32768 * 0.65
    facts = {"parts": [{"key": "health", "text": "20", "original": "log:h"}]}
    messages, budget = context.assemble(prefix, [], "survive", facts, [], [latest],
                                       context_tokens=32768, reserved_output=1024)
    assert messages[2:4] == latest
    assert json.loads(messages[-1]["content"])["current_facts"] == facts["parts"]
    assert budget["total"] <= 32768


def test_repeated_rejection_restores_exact_error_after_an_unrelated_success(framework_module, tmp_path, run_async):
    async def decide(*_):
        return choose()
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    args = {"steps": [], "queue": "append"}
    original = {"tool": "mc_do", "error": "voxels volume 2890 exceeds 512 cells"}
    controller.rejected_calls[json.dumps(["mc_do", args], sort_keys=True, ensure_ascii=False)] = original
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert controller.tool_failure == original
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)
    assert controller.continuation_needed


def test_worker_is_single_owner_and_cleans_up_before_stop_returns(framework_module, tmp_path):
    import threading
    entered, cleanup = threading.Event(), threading.Event()

    async def factory(*_):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleanup.set()

    worker = framework_module.Worker(factory, tmp_path / "errors.log")
    assert worker.start("survive")
    assert entered.wait(5)
    assert not worker.start("another")
    assert worker.stop(5)
    assert cleanup.is_set()
    assert not worker.snapshot()["worker_alive"]
    assert worker.stop(5)
