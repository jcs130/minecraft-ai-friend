"""Full requests preserve evidence rather than inheriting compact-mode previews."""
import copy
import dataclasses
import json

import pytest

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.context import assemble, encode
from agent_mc_autonomy.controller import model_tools
from test_context_retention import exchange
from test_controller import setup


def test_full_context_keeps_all_supplied_evidence_and_history():
    events = [{"run": "r", "cursor": i + 1, "type": "chat", "text": "私聊原文" * 400,
               "meta": {"channel": "private", "extra_evidence": "keep"}} for i in range(70)]
    facts = {"parts": [{"key": "serverFeedback", "text": "服务端完整提示" * 2000, "original": "log:feedback"}]}
    groups = [exchange(i, 3000) for i in range(12)]
    host = {"stable": {"agent_name": "Role", "persona": "完整人格" * 1200},
            "dynamic": {"current_intent": "意图" * 2000, "memories": [{"text": "经历" * 3000}]}}
    original = copy.deepcopy((events, facts, groups, host))
    messages, budget = assemble("stable", [], "survive", facts, events, groups,
        context_tokens=1048576, reserved_output=8192, context_mode="full", host_context=host,
        native_outcomes=[{"id": i, "receipt": "result" * 900} for i in range(10)])
    tail = json.loads(messages[-1]["content"])
    assert [r["text"] for r in tail["events"]] == [r["text"] for r in events]
    assert tail["events"][0]["meta"]["extra_evidence"] == "keep"
    assert tail["current_facts"][0]["text"] == facts["parts"][0]["text"]
    assert messages[2:-1] == [m for group in groups for m in group]
    assert host["stable"]["persona"] in messages[0]["content"]
    assert tail["host_context"] == host["dynamic"]
    assert len(tail["recent_native_outcomes"]) == 10
    assert budget["mode"] == "full" and budget["event_delivery"]["included"] == 70
    assert budget["total"] <= 1048576 and budget["omitted"] == []
    assert (events, facts, groups, host) == original


def test_full_window_evicts_whole_exchanges_and_reports_omission():
    groups = [exchange(i, 2500) for i in range(10)]
    messages, budget = assemble("stable", [], "survive", {"parts": [{"key": "health", "text": "20/20"}]}, [], groups,
        context_tokens=10000, reserved_output=1024, context_mode="full")
    assert budget["total"] <= 10000
    assert 0 < budget["history"]["included"] < len(groups)
    calls = [c["id"] for m in messages for c in m.get("tool_calls", [])]
    assert calls == [m["tool_call_id"] for m in messages if m["role"] == "tool"]
    assert json.loads(messages[-1]["content"])["context_omissions"]["history_groups"] > 0


def test_full_mode_retains_native_tool_manual():
    description = "Long native semantics. " * 100
    schema = {"type": "object", "properties": {"target": {"type": "string", "description": description}}}
    tool = model_tools([{"name": "mc_bag", "description": description, "inputSchema": schema}], context_mode="full")[0]
    assert tool["function"]["description"] == description
    assert tool["function"]["parameters"]["properties"]["target"]["description"] == description


def test_full_setting_is_explicit_and_validated():
    assert Settings.parse({}).context_mode == "compact"
    assert Settings.parse({"autonomy": {"context_mode": "full", "context_tokens": 1048576}}).context_mode == "full"
    with pytest.raises(ValueError):
        Settings.parse({"autonomy": {"context_mode": "unlimited"}})


def test_full_pending_event_buffer_uses_window_instead_of_count():
    from agent_mc_autonomy.context import retain_events
    events = [{"run": "r", "cursor": i, "text": "message"} for i in range(150)]
    assert retain_events(events, byte_limit=1048576) == events
    assert len(retain_events(events)) == 64


def test_full_host_recent_contract_is_owned_and_keeps_all_selected_originals():
    from agent_mc_autonomy import host_recent
    from test_host_recent import message, projection, request
    req = {**request(), "context_mode": "full"}
    rows = [message(f"{i:02d}", text="Long attributed language " * 150) for i in range(20)]
    selected = host_recent.select_recent_messages(rows, binding=host_recent.binding(req, request=True),
        sampled_at=req["as_of"], source="public")
    assert selected == rows
    value = projection(req, messages=selected)
    assert host_recent.validate(value, req, req["as_of"])["recent_messages"] == rows
    with pytest.raises(ValueError, match="binding_mismatch"):
        host_recent.validate(value, request(), req["as_of"])


def test_full_counter_fallback_and_pending_events_are_explicit():
    class FailedCounter:
        name = "failed-counter"

        def count_input(self, messages, tools):
            raise ValueError("unavailable")

    events = [{"run": "r", "cursor": i, "text": "long evidence" * 1500} for i in range(5)]
    _, budget = assemble("stable", [], "survive", {"parts": []}, events, [],
        context_tokens=11000, reserved_output=1024, context_mode="full", context_counter=FailedCounter())
    assert budget["total"] <= 11000
    assert budget["event_delivery"]["omitted"] == 5
    assert budget["event_delivery"]["included_indices"] == []
    assert budget["counter_fallback"]


def test_controller_full_receipts_and_more_than_eight_exchanges(framework_module, tmp_path, run_async):
    captured = []

    async def decide(messages, tools):
        captured.append(messages)
        return {"content": "A complete plan", "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode="full", context_tokens=1048576)
    controller.groups = [exchange(i, 1000) for i in range(12)]
    full = {"text": "完整工具结果" * 2000, "failed": False, "meta": {"source": "native"}}
    view = json.loads(run_async(controller.archive_receipt("request", "mc_help", full)))
    assert view == full and not bridge.artifacts
    run_async(controller.turn_once("survive", "body contract", module.model_tools(bridge.tools, context_mode="full")))
    assert len(controller.groups) == 13
    assert len(captured[0][2:-1]) == 24
