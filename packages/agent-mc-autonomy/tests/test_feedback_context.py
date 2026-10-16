import copy
import dataclasses
import importlib
import json
import uuid

import pytest
from test_controller import Bridge, packed
from test_death_memory import facts


def response(name, call_id):
    return {"content": None, "tool_calls": [{"id": call_id, "type": "function",
            "function": {"name": name, "arguments": "{}"}}]}


def setup(framework_module, tmp_path, replies):
    module = importlib.import_module("agent_mc_autonomy.controller")
    mailbox = importlib.import_module("agent_mc_autonomy.mailbox").Mailbox(tmp_path)
    seen = []

    async def decide(messages, _):
        seen.append(copy.deepcopy(messages))
        return replies.pop(0)

    class FeedbackBridge(Bridge):
        async def call(self, name, args, **metadata):
            if name == "mc_protocol" and args["action"] == "facts":
                self.calls.append((name, args, metadata))
                return packed(facts())
            if name == "mc_stop":
                self.calls.append((name, args, metadata))
                return {"structuredContent": {"protocol": "agent-mc/v1", "text": "native queue cleared", "failed": False}}
            return await super().call(name, args, **metadata)

    bridge = FeedbackBridge()
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    settings = dataclasses.replace(framework_module.Settings(), max_tool_rounds=1)
    controller = module.Controller(bridge, decide, settings, tmp_path, lambda **_: None, lambda: False, mailbox)
    controller.observe_game_facts(facts())
    return module, mailbox, bridge, controller, seen


def test_host_stage_revision_preserves_original_help_and_rejected_call_for_next_request(framework_module, tmp_path, run_async):
    replies = [response("mc_help", "help-1"), response("unavailable_skill", "failed-2"), response("mc_help", "help-3")]
    module, box, bridge, controller, seen = setup(framework_module, tmp_path, replies)
    first = str(uuid.uuid4())
    box.submit("feedback", {"goal": "Observe food sources", "mode": "insert", "origin": "host_review",
                            "stage_baseline": controller.stage_baseline()}, first)
    run_async(controller.external_command())
    tools = module.model_tools(bridge.tools)
    for _ in range(2):
        run_async(controller.turn_once(controller.active_goal["goal"], "prefix", tools))
    original = copy.deepcopy(controller.groups)
    assert len(original) == 2
    assert "Read the next section" in original[0][1]["content"]
    assert json.loads(original[1][1]["content"])["dispatched"] is False
    calls = copy.deepcopy(bridge.calls)
    for goal in ("Use observed food sources", "Gather food after the current checkpoint"):
        revised = str(uuid.uuid4())
        payload = {"goal": goal, "mode": "insert", "origin": "host_review", "revision_of": first, "parent_id": first,
                   "stage_baseline": controller.stage_baseline()}
        box.submit("feedback", payload, revised)
        controller.last_decision = 42
        run_async(controller.external_command())
        assert controller.groups == original
        assert [(name, args) for name, args, _ in bridge.calls[len(calls):]] == [("mc_protocol", {"protocol": "agent-mc/v1", "action": "facts"})]
        calls = copy.deepcopy(bridge.calls)
        assert controller.active_goal["id"] == revised and controller.last_decision == 0
        assert controller.feedback_pending  # The first body action still uses the safe checkpoint.
        assert box.get(first)["delivery"] == "revised"
        box.submit("feedback", payload, revised)
        assert not run_async(controller.external_command())  # Retrying the same UUID is not another revision.
        assert controller.groups == original
        first = revised
    run_async(controller.turn_once(controller.active_goal["goal"], "prefix", tools))
    assert seen[-1][2:-1] == [message for group in original for message in group]


@pytest.mark.parametrize(("origin", "mode", "revision"), [
    ("user", "replace", False), ("user", "insert", False), ("user", "insert", True),
    ("unknown", "insert", True), (None, "insert", True), ("host_review", "insert", False),
])
def test_new_feedback_and_non_host_revisions_still_clear_old_history(framework_module, tmp_path, run_async, origin, mode, revision):
    module, box, bridge, controller, _ = setup(framework_module, tmp_path, [response("mc_help", "help-1")])
    first, following = str(uuid.uuid4()), str(uuid.uuid4())
    box.submit("feedback", {"goal": "Observe food sources", "mode": "insert", "origin": "host_review",
                            "stage_baseline": controller.stage_baseline()}, first)
    run_async(controller.external_command())
    run_async(controller.turn_once(controller.active_goal["goal"], "prefix", module.model_tools(bridge.tools)))
    assert controller.groups
    payload = {"goal": "Return to shelter", "mode": mode}
    if origin is not None:
        payload["origin"] = origin
    if origin == "host_review":
        payload["stage_baseline"] = controller.stage_baseline()
    if revision:
        payload["revision_of"] = first
    box.submit("feedback", payload, following)
    run_async(controller.external_command())
    assert controller.groups == [] and controller.active_goal["id"] == following
    assert sum(name == "mc_stop" for name, _, _ in bridge.calls) == (mode == "replace")
