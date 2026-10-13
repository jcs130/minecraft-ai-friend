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
        raise AssertionError(name)


def setup(framework_module, tmp_path, decide, stop=lambda: False):
    module = importlib.import_module("agent_mc_autonomy.controller")
    bridge = Bridge()
    settings = dataclasses.replace(framework_module.Settings(), max_decisions=2)
    controller = module.Controller(bridge, decide, settings, tmp_path, lambda **_: None, stop)
    return module, bridge, controller


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
    assert controller.continuation_needed and controller.planner_retry_at > 0
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


def test_incomplete_inference_recovery_is_bounded(framework_module, tmp_path, run_async):
    planner = importlib.import_module("agent_mc_autonomy.planner")

    async def decide(*_):
        raise planner.PlannerResponseError({"choice": {"finish_reason": "length"}})

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.persist(stopped=False)
    tools = module.model_tools(bridge.tools)
    for _ in range(2):
        run_async(controller.turn_once("survive", "prefix", tools))
    with pytest.raises(planner.PlannerResponseError):
        run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.planner_failures == 3 and controller.inflight_request is None
    assert not any(name == "mc_do" for name, *_ in bridge.calls)
    assert [args["action"] for name, args, _ in bridge.calls if name == "mc_protocol"].count("end_turn") == 3


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
    assert controller.continuation_needed and controller.planner_retry_at > module.time.monotonic()
    assert not bridge.closed and controller.inflight_request is None
    assert not json.loads(controller.state_path.read_text()).get("uncertain")
    assert all(name == "mc_protocol" and args["action"] in {"begin_turn", "facts", "end_turn"}
               for name, args, _ in bridge.calls)
    records = [json.loads(line) for line in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert records[0]["response"] == invalid
    assert records[-1]["dispatched"] is False
    run_async(controller.turn_once("survive", "prefix", tools))
    assert "No tool was dispatched" in seen[1][-1]["content"]
    assert len([row for row in bridge.calls if row[0] == "mc_do"]) == 1
    assert controller.pending[("task", "body-1")]["terminal"] is False


def test_multiple_model_calls_are_rejected_as_a_whole_and_rate_limited(framework_module, tmp_path, run_async):
    async def decide(*_):
        result = choose()
        result["tool_calls"] += [{**result["tool_calls"][0], "id": "call-2"}]
        return result

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    tools = module.model_tools(bridge.tools)
    delays = []
    for _ in range(5):
        run_async(controller.turn_once("survive", "prefix", tools))
        delays.append(controller.planner_retry_at - module.time.monotonic())
    assert all(delay > 0 for delay in delays)
    assert delays[-1] >= 59 and delays[-1] <= 60
    assert not any(row[0] == "mc_do" for row in bridge.calls)
    assert controller.inflight_request is None and not bridge.closed


def test_running_actions_do_not_cause_idle_or_snapshot_replanning(framework_module, tmp_path, run_async, monkeypatch):
    decisions, polls, stopped = [], [], False

    async def decide(*_):
        decisions.append(True)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: stopped)
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
    assert state["stopped"] is True and state["pending"] == []


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


def test_submitted_stage_keeps_standing_goal_context_without_losing_priority(framework_module, tmp_path, run_async):
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
    assert "Submitted goal (current priority): Gather a few logs and craft a workbench" in prompt
    assert "goal_report" in prompt and "observed" in prompt


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
    failure = module.failure_context(catalog, "mc_scout", {"steps": [{"skill": "craft"}, {"skill": "collect"}]}, {"text": "Invalid arguments"})
    assert "collect, craft belongs to mc_do" in failure["next_step"]


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
