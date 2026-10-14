import dataclasses
import importlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

import httpx
import pytest
from test_controller import Bridge, choose


def modules(framework_module):
    return [importlib.import_module("agent_mc_autonomy." + name)
            for name in ("planner", "mailbox", "runner", "ownership", "controller")]


def test_sdk_free_process_executes_native_queue_and_optional_brain():
    result = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("standalone_probe.py"))],
                            capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "no-host-imports; autonomous and queue-only cycles passed" in result.stdout


def test_delivery_deduplicates_and_preserves_unknown(framework_module, tmp_path):
    _, mail, _, _, _ = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    request_id = str(uuid.uuid4())
    payload = {"steps": [{"skill": "eat"}], "queue": "append"}
    assert box.get(request_id) is None and not box.path.exists()
    assert box.submit("steps", payload, request_id)["delivery"] == "queued"
    assert box.submit("steps", payload, request_id)["delivery"] == "queued"
    with pytest.raises(ValueError, match="conflict"):
        box.submit("steps", {**payload, "queue": "now"}, request_id)
    assert box.claim()["id"] == request_id
    assert box.submit("steps", payload, request_id)["delivery"] == "dispatching"
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        box.check_uncertain()
    receipt = {"execution": {"id": "native-42", "phase": "accepted", "terminal": False}}
    box.finish(request_id, receipt)
    assert box.get(request_id)["native_receipt"] == receipt
    assert box.claim() is None
    box.check_uncertain()


def test_explicit_stop_cancels_undelivered_commands(framework_module, tmp_path):
    _, mail, _, _, _ = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    request_id, stop_id = str(uuid.uuid4()), str(uuid.uuid4())
    box.submit("steps", {"steps": [{"skill": "eat"}], "queue": "append"}, request_id)
    for _ in range(63):
        box.submit("goal", {"goal": "wait"}, str(uuid.uuid4()))
    with pytest.raises(ValueError, match="inbox_full"):
        box.submit("goal", {"goal": "wait"}, str(uuid.uuid4()))
    box.submit("stop", {}, stop_id)
    assert box.claim()["id"] == stop_id
    box.stop_queued()
    assert not box.ready() and box.get(request_id)["delivery"] == "cancelled"


def test_two_owners_cannot_share_an_account_ledger(framework_module, tmp_path):
    _, _, _, ownership, _ = modules(framework_module)
    with ownership.session_lease(tmp_path):
        with pytest.raises(RuntimeError, match="session_in_use"), ownership.session_lease(tmp_path):
            pytest.fail("Second controller entered")
    with ownership.session_lease(tmp_path):
        assert (tmp_path / "owner.lock").is_file()


def test_account_lease_probe_requires_a_current_holder_and_creates_no_state(framework_module, tmp_path):
    _, _, _, ownership, _ = modules(framework_module)
    account = tmp_path / "account"
    assert not ownership.session_is_owned(account)
    assert not account.exists()
    account.mkdir()
    (account / "owner.lock").write_bytes(b"0")
    with ownership.session_lease(account):
        assert ownership.session_is_owned(account)
        assert not ownership.session_is_owned(tmp_path / "other-account")
    assert not ownership.session_is_owned(account)
    assert (account / "owner.lock").read_bytes() == b"0"


def test_empty_lease_file_is_not_an_owner(framework_module, tmp_path):
    _, _, _, ownership, _ = modules(framework_module)
    (tmp_path / "owner.lock").touch()
    assert not ownership.session_is_owned(tmp_path)
    assert (tmp_path / "owner.lock").read_bytes() == b""


@pytest.mark.parametrize("queue", ["append", "afterCheckpoint", "now"])
def test_command_uses_native_mode_and_original_receipt(framework_module, tmp_path, run_async, queue):
    _, mail, _, _, controller_module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    request_id = str(uuid.uuid4())
    payload = {"steps": [{"skill": "eat"}], "queue": queue}
    box.submit("steps", payload, request_id)
    bridge = Bridge()
    published = []
    controller = controller_module.Controller(bridge, None, framework_module.Settings(), tmp_path, lambda **value: published.append(value), lambda: False, box)
    assert run_async(controller.external_command())
    sent = next(row for row in bridge.calls if row[0] == "mc_do")
    assert sent[1] == payload and sent[2]["request_id"] == request_id
    result = box.get(request_id)
    assert result["native_receipt"]["execution"]["phase"] == "accepted"
    assert result["native_receipt"]["execution"]["goalCompleted"] is False
    receipt = next(row["viewer_action"] for row in published if "viewer_action" in row)
    assert receipt["action"] == {"type": "mc_do", "operation": "eat"}
    assert receipt["execution_id"] == result["native_receipt"]["execution"]["id"]
    assert receipt["result"]["effectVerified"] is False
    assert not run_async(controller.external_command())
    assert len([row for row in bridge.calls if row[0] == "mc_do"]) == 1


def test_insert_during_inference_rejects_stale_action(framework_module, tmp_path, run_async):
    _, mail, _, _, controller_module = modules(framework_module)
    async def exercise():
        box = mail.Mailbox(tmp_path)
        async def decide(*_):
            box.submit("steps", {"steps": [{"skill": "eat"}], "queue": "append"}, str(uuid.uuid4()))
            return choose()  # Same-tick reply is already stale after insertion.
        bridge = Bridge()
        controller = controller_module.Controller(bridge, decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
        controller.persist(stopped=False)
        await controller.turn_once("survive", "prefix", controller_module.model_tools(bridge.tools))
        assert not any(name == "mc_do" for name, *_ in bridge.calls)
        assert controller.preempted
        await controller.external_command()
        assert len([name for name, *_ in bridge.calls if name == "mc_do"]) == 1
    run_async(exercise())


def test_http_adapter_is_explicit_no_retry_and_hides_error_body(framework_module, run_async, monkeypatch):
    brain_module, *_ = modules(framework_module)
    monkeypatch.setenv("MC_TEST_KEY", "fake-secret")
    config = brain_module.HttpPlannerConfig.parse({"base_url": "http://model.test/v1", "model": "chosen-model", "api_key_env": "MC_TEST_KEY"})
    calls = []
    def respond(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls", "message": choose()}]})
        return httpx.Response(503, text="fake-secret; internal provider diagnostics")
    async def exercise():
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        brain = brain_module.HttpPlanner(config, 512, 30, client=client)
        messages = [{"role": "user", "content": "latest facts"}]
        response = await brain.decide(messages, [])
        assert {k: response[k] for k in ("content", "tool_calls")} == choose()
        assert response["model_status"]["route"] == "standalone_text"
        payload = json.loads(calls[0].content)
        assert payload["model"] == "chosen-model" and payload["messages"] == messages
        assert payload["max_tokens"] == 512 and not payload["parallel_tool_calls"]
        assert calls[0].headers["Authorization"] == "Bearer fake-secret"
        with pytest.raises(RuntimeError, match="^brain_http_error_503$"):
            await brain.decide(messages, [])
        assert len(calls) == 2
        await brain.aclose()
        assert client.is_closed
    run_async(exercise())


def test_truncated_response_is_rejected_before_partial_tool_dispatch(framework_module, run_async):
    planner_module, *_ = modules(framework_module)
    choice = {"finish_reason": "length", "message": choose()}
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [choice]})

    async def exercise():
        config = planner_module.HttpPlannerConfig("http://model.test/v1", "chosen")
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            planner = planner_module.HttpPlanner(config, 512, 30, client=client)
            with pytest.raises(planner_module.PlannerResponseError) as caught:
                await planner.decide([], [])
            assert caught.value.diagnostic == {"choice": choice}
            assert str(caught.value) == "brain_response_invalid_or_incomplete"
        assert len(requests) == 1  # Recovery belongs to the event-aware controller.

    run_async(exercise())


@pytest.mark.parametrize("content", [None, "", " \n\t"])
def test_empty_success_response_is_rejected_and_journalable(framework_module, run_async, content):
    planner_module, *_ = modules(framework_module)
    choice = {"finish_reason": "stop", "message": {"content": content, "tool_calls": []}}

    async def exercise():
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"choices": [choice]})))
        brain = planner_module.HttpPlanner(planner_module.HttpPlannerConfig("http://model.test/v1", "model"), 512, 30, client=client)
        with pytest.raises(planner_module.PlannerResponseError) as rejected:
            await brain.decide([], [])
        assert rejected.value.diagnostic == {"choice": choice}
        await brain.aclose()
    run_async(exercise())


@pytest.mark.parametrize("change", [{"base_url": "https://user:secret@model.test/v1"}, {"model": ""},
                                    {"base_url": "http://model.test/v1?key=secret"}, {"api_key": "secret"}])
def test_provider_configuration_rejects_implicit_or_embedded_secrets(framework_module, change):
    brain_module, *_ = modules(framework_module)
    with pytest.raises(ValueError):
        brain_module.HttpPlannerConfig.parse({"base_url": "http://model.test/v1", "model": "chosen", **change})


def test_runner_refuses_unknown_before_starting_body_or_model(framework_module, tmp_path, run_async):
    _, mail, runner, _, _ = modules(framework_module)
    settings = dataclasses.replace(framework_module.Settings(), enabled=True, host="example.test", username="Alice")
    directory = tmp_path / "sessions" / settings.identity / "host"
    box = mail.Mailbox(directory)
    box.submit("steps", {"steps": [{"skill": "eat"}], "queue": "append"}, str(uuid.uuid4()))
    box.claim()
    class Brain:
        closed = False
        async def decide(self, *_):
            pytest.fail("Uncertain task must block model calls")
        async def aclose(self):
            self.closed = True
    brain = Brain()
    def forbidden(*_):
        pytest.fail("Uncertain task must block child startup")
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(runner.run_session(settings, tmp_path / "fake", tmp_path, brain, "survive", lambda **_: None, lambda: False,
                                     bridge_factory=forbidden))
    assert brain.closed and not (directory / "client.json").exists()


def test_natural_goals_are_planned_serially_and_reports_are_not_verification(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    box.submit("goal", {"goal": "收集木头并制作工作台"}, first)
    box.submit("goal", {"goal": "探索附近村庄"}, second)
    async def decide(*_):
        return choose()
    controller = module.Controller(Bridge(), decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    assert run_async(controller.external_command())
    assert controller.active_goal["goal"] == "收集木头并制作工作台"
    assert not run_async(controller.external_command())  # Another goal cannot preempt this one.
    assert not box.ready(allow_goal=False)
    run_async(controller.turn_once(controller.active_goal["goal"], "prefix", module.model_tools(controller.bridge.tools)))
    assert controller.pending and box.get(first)["delivery"] == "planning"
    assert not run_async(controller.external_command())
    with pytest.raises(ValueError, match="no_pending_actions"):
        run_async(controller.dispatch("goal_report", {"outcome": "reported_done", "evidence": "wood observed"}, str(uuid.uuid4())))
    bridge = controller.bridge
    bridge.event_pages.append([{"execution": {**bridge.result["execution"], "terminal": True, "phase": "completed"}}])
    run_async(controller.events())
    run_async(controller.dispatch("goal_report", {"outcome": "reported_done", "evidence": "workbench observed"}, str(uuid.uuid4())))
    report = box.get(first)
    assert report["delivery"] == "reported_done" and report["planner_report"]["verified"] is False
    assert report["planner_report"]["observed_facts"]["parts"]
    assert run_async(controller.external_command())
    assert controller.active_goal["id"] == second


def test_feedback_inserts_at_native_checkpoint_without_stopping_old_work(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    original, feedback = str(uuid.uuid4()), str(uuid.uuid4())
    box.submit("goal", {"goal": "收集木头"}, original)
    async def decide(*_):
        return choose()
    bridge = Bridge()
    controller = module.Controller(bridge, decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    run_async(controller.external_command())
    run_async(controller.turn_once(controller.active_goal["goal"], "prefix", module.model_tools(bridge.tools)))
    old_id = bridge.result["execution"]["id"]
    bridge.result["execution"] = {**bridge.result["execution"], "id": "inserted-body"}
    box.submit("feedback", {"goal": "先吃点东西", "mode": "insert"}, feedback)
    assert box.ready(allow_goal=False)
    run_async(controller.external_command())
    assert controller.active_goal["id"] == feedback and controller.feedback_pending
    assert box.get(original)["delivery"] == "paused"
    run_async(controller.turn_once(controller.active_goal["goal"], "prefix", module.model_tools(bridge.tools)))
    actions = [row for row in bridge.calls if row[0] == "mc_do"]
    assert [row[1]["queue"] for row in actions] == ["append", "afterCheckpoint"]
    assert not any(row[0] == "mc_stop" for row in bridge.calls)
    assert not controller.feedback_pending
    assert box.active_goal()["queue_policy_consumed"]
    bridge.event_pages.append([{"execution": {**bridge.result["execution"], "terminal": True, "phase": "completed"}}])
    run_async(controller.events())
    assert ("task", old_id) in controller.pending and not controller.current_work()
    run_async(controller.dispatch("goal_report", {"outcome": "reported_done", "evidence": "hunger restored"}, str(uuid.uuid4())))
    assert controller.active_goal["id"] == original
    assert controller.current_work() and not controller.feedback_pending


def test_nested_feedback_restores_the_unplanned_insertion(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    async def decide(*_):
        return choose()
    bridge = Bridge()
    controller = module.Controller(bridge, decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    box.submit("feedback", {"goal": "先吃饭", "mode": "insert"}, first)
    run_async(controller.external_command())
    box.submit("feedback", {"goal": "先离开火堆", "mode": "insert"}, second)
    run_async(controller.external_command())
    run_async(controller.turn_once(controller.active_goal["goal"], "prefix", module.model_tools(bridge.tools)))
    bridge.event_pages.append([{"execution": {**bridge.result["execution"], "terminal": True, "phase": "completed"}}])
    run_async(controller.events())
    run_async(controller.dispatch("goal_report", {"outcome": "reported_done", "evidence": "safe position observed"}, str(uuid.uuid4())))
    assert controller.active_goal["id"] == first and controller.feedback_pending
    assert not box.active_goal()["queue_policy_consumed"]


def test_explicit_replacement_archives_native_stop_then_adopts_new_goal(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    original, feedback = str(uuid.uuid4()), str(uuid.uuid4())
    box.submit("goal", {"goal": "挖矿"}, original)
    async def decide(*_):
        return choose()
    class StopBridge(Bridge):
        async def call(self, name, args, **metadata):
            if name == "mc_stop":
                self.calls.append((name, args, metadata))
                return {"structuredContent": {"protocol": "agent-mc/v1", "text": "native queue cleared", "failed": False}}
            return await super().call(name, args, **metadata)
    bridge = StopBridge()
    controller = module.Controller(bridge, decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    run_async(controller.external_command())
    box.submit("feedback", {"goal": "别挖了，回家", "mode": "replace"}, feedback)
    run_async(controller.external_command())
    assert box.get(original)["delivery"] == "superseded" and controller.active_goal["id"] == feedback
    receipt = json.loads((tmp_path / "receipts.jsonl").read_text(encoding="utf-8"))
    assert receipt["tool"] == "mc_stop" and receipt["requestId"] == feedback
    assert receipt["result"]["text"] == "native queue cleared"
    run_async(controller.turn_once(controller.active_goal["goal"], "prefix", module.model_tools(bridge.tools)))
    assert [args for name, args, _ in bridge.calls if name == "mc_do"] == [{"steps": [], "queue": "append"}]


def test_stage_revision_preserves_running_body_and_resumes_original_goal(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    original, first, revised = (str(uuid.uuid4()) for _ in range(3))
    async def decide(*_):
        return choose()
    bridge = Bridge()
    controller = module.Controller(bridge, decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    box.submit("goal", {"goal": "长期生存"}, original)
    run_async(controller.external_command())
    box.submit("feedback", {"goal": "准备工具", "mode": "insert"}, first)
    run_async(controller.external_command())
    run_async(controller.turn_once("准备工具", "prefix", module.model_tools(bridge.tools)))
    assert controller.active_goal["queue_policy_consumed"]
    calls = list(bridge.calls)
    box.submit("feedback", {"goal": "完成当前工具后找食物", "mode": "insert", "revision_of": first}, revised)
    run_async(controller.external_command())
    assert bridge.calls == calls  # No cancellation, replay or extra native queue.
    assert controller.current_work() and not controller.feedback_pending
    assert controller.action_owners[("task", "body-1")] == revised
    assert box.get(first)["delivery"] == "revised"
    assert box.get(original)["delivery"] == "paused"
    assert box.active_goal()["queue_policy_consumed"]
    bridge.event_pages.append([{"execution": {**bridge.result["execution"], "terminal": True, "phase": "completed"}}])
    run_async(controller.events())
    run_async(controller.dispatch("goal_report", {"outcome": "reported_done", "evidence": "observed food"}, str(uuid.uuid4())))
    assert controller.active_goal["id"] == original
    assert box.get(revised)["planner_report"]["verified"] is False


def test_stale_revision_cannot_resurrect_a_finished_stage(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    first, revised = str(uuid.uuid4()), str(uuid.uuid4())
    async def decide(*_):
        return choose()
    bridge = Bridge()
    controller = module.Controller(bridge, decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    box.submit("feedback", {"goal": "准备工具", "mode": "insert"}, first)
    run_async(controller.external_command())
    box.submit("feedback", {"goal": "找食物", "mode": "insert", "revision_of": first}, revised)
    run_async(controller.dispatch("goal_report", {"outcome": "blocked", "evidence": "cannot continue"}, str(uuid.uuid4())))
    calls = list(bridge.calls)
    run_async(controller.external_command())
    assert bridge.calls == calls and controller.active_goal is None
    assert box.get(revised)["planner_report"]["reason"] == "revision_target_not_active"


def test_unplanned_revision_retains_safe_checkpoint_policy(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    first, revised = str(uuid.uuid4()), str(uuid.uuid4())
    async def decide(*_):
        return choose()
    bridge = Bridge()
    controller = module.Controller(bridge, decide, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    box.submit("feedback", {"goal": "工具", "mode": "insert"}, first)
    run_async(controller.external_command())
    box.submit("feedback", {"goal": "食物", "mode": "insert", "revision_of": first}, revised)
    run_async(controller.external_command())
    assert controller.feedback_pending
    run_async(controller.turn_once("食物", "prefix", module.model_tools(bridge.tools)))
    assert [args["queue"] for name, args, _ in bridge.calls if name == "mc_do"] == ["afterCheckpoint"]


def test_queue_only_mode_does_not_pretend_it_can_plan_natural_goals(framework_module, tmp_path, run_async):
    _, mail, _, _, module = modules(framework_module)
    box = mail.Mailbox(tmp_path)
    request_id = str(uuid.uuid4())
    box.submit("goal", {"goal": "做工作台"}, request_id)
    bridge = Bridge()
    controller = module.Controller(bridge, None, framework_module.Settings(), tmp_path, lambda **_: None, lambda: False, box)
    run_async(controller.external_command())
    assert box.get(request_id)["delivery"] == "blocked"
    assert box.get(request_id)["planner_report"]["reason"] == "planner_unavailable"
    assert not bridge.calls
