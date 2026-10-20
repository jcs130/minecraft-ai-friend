import asyncio
import copy
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone

import pytest

from agent_mc_autonomy import host_recent
from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.host_context import HostContextPort
from agent_mc_autonomy.mailbox import Mailbox
from test_controller import choose, packed, setup
from test_death_memory import event as death_event


SCOPE = {"realm": "test-realm", "account": "test-account", "agent": "test-agent"}
BASE = {"agent_name": "TestRole", "persona": "Observant", "persona_source": "host_projection",
        "current_intent": "keep existing plan", "memories": []}


def request(now=10000):
    return {"identity": "settings-id", "actor": "TestRole", "session": "runtime-1", "run": "native-1",
            "scope": SCOPE, "intent_revision": 3, "death_episode_id": None, "as_of": now}


def message(identifier="record-1", text="Historical user language", role="user", occurred=9999):
    return {"id": identifier, "derived_id": False, "conversation_id": "shared-conversation",
            "actor": "TestRole", "role": role, "source": "public_committed", "turn_type": "utterance",
            "observed_at": occurred, "occurred_at": occurred, "clock_source": "producer", "text": text,
            "text_sha256": hashlib.sha256(text.encode()).hexdigest(), "truncated": False,
            "original_ref": {"source_id": identifier, "full_text_available": True}}


def projection(req=None, messages=None, speech=None):
    req = req or request()
    messages = [message(occurred=req["as_of"] - 1)] if messages is None else messages
    speech = speech or []
    n = len(messages) + len(speech)
    return {"schema": host_recent.SCHEMA, "binding": host_recent.binding(req, request=True),
            "source": "generic_public_snapshot", "sampled_at": req["as_of"], "expires_at": req["as_of"] + 30,
            "coverage": {"state": "available" if n else "empty", "received_count": n, "limit": 60,
                         "saturated": False, "selected_count": n, "omitted_count": 0, "reasons": []},
            "recent_messages": messages, "recent_speech": speech}


def speech(req=None):
    req = req or request()
    return {**{k: req[k] for k in ("actor", "session", "run", "scope")}, "source": "owned_output",
            "opportunity_id": "opportunity-1", "decision_id": "decision-1", "offered_at": req["as_of"] - 1,
            "receipt_state": "accepted", "text_sha256": hashlib.sha256(b"spoken").hexdigest(),
            "text_available": False, "playback_verified": False}


def status(path, req, now=None, **changes):
    now = req["as_of"] if now is None else now
    state = {"phase": "running", "game_connected": True, "owner_pid": 12, "viewer": {"session": "view"},
             "runtime_session": req["session"], "game_identity": req["scope"], "host_recent_request": req,
             "settings_identity": req["identity"], "native_run": req["run"], "body_death_episode_id": req["death_episode_id"],
             "updated_at": datetime.fromtimestamp(now, timezone.utc).isoformat(), **changes}
    (path / "status.json").write_text(json.dumps(state), encoding="utf-8")


def port_fixture(path):
    clock = [10000]
    port = HostContextPort(path, now=lambda: clock[0])
    req = request()
    status(path, req)
    port.publish(BASE, session="12:view", revision=3)
    return port, req, clock


@pytest.mark.parametrize("mutate", [
    lambda v: v.update(schema="agent-mc-host-recent/v2"),
    lambda v: v["binding"].update(actor="OtherRole"),
    lambda v: v["binding"].update(run="other-run"),
    lambda v: v["binding"].update(session="other-session"),
    lambda v: v["binding"].update(identity="other-settings"),
    lambda v: v["binding"].update(scope={**SCOPE, "realm": "other-realm"}),
    lambda v: v["binding"].update(intent_revision=4),
    lambda v: v["binding"].update(death_episode_id="death-1"),
    lambda v: v.update(sampled_at=float("nan")),
    lambda v: v.update(expires_at=10031),
    lambda v: v["recent_messages"][0].update(role="system"),
    lambda v: v["recent_messages"][0].update(actor="OtherRole"),
    lambda v: v["recent_messages"][0].update(occurred_at=10001),
    lambda v: v["recent_messages"][0].update(occurred_at=9399),
    lambda v: v["recent_messages"][0].update(observed_at=float("inf")),
    lambda v: v["recent_messages"][0].update(text_sha256="f" * 64),
    lambda v: v["recent_messages"][0].update(private_prompt="forbidden"),
    lambda v: v["recent_messages"][0].update(original_ref={"path": "../private"}),
    lambda v: v["coverage"].update(selected_count=8),
])
def test_strict_neutral_contract_rejects_bad_binding_provenance_and_times(mutate):
    value = projection()
    mutate(value)
    with pytest.raises(ValueError):
        host_recent.validate(value, request(), 10000)


def test_atomic_recent_refresh_does_not_renew_base_or_static_leases(tmp_path):
    port, req, clock = port_fixture(tmp_path)
    port.publish_static({k: BASE[k] for k in ("agent_name", "persona", "persona_source")} | {"persona_source": "character_profile"},
                        scope=json.dumps(list(SCOPE.values()), ensure_ascii=False))
    base = port.path.read_bytes()
    static = (tmp_path / "host-character.json").read_bytes()
    assert port.publish_recent(projection(req), binding=req)["available"]
    first = port.read_recent(req)
    clock[0] += 10
    req = {**req, "as_of": clock[0]}
    status(tmp_path, req)
    value = projection(req, messages=first["recent_messages"])
    assert port.publish_recent(value, binding=req)["available"]
    assert port.read_recent(req)["recent_messages"][0]["occurred_at"] == 9999
    assert port.path.read_bytes() == base and (tmp_path / "host-character.json").read_bytes() == static
    assert port.read(3)["dynamic"]["current_intent"] == BASE["current_intent"]
    clock[0] = 10601
    status(tmp_path, {**req, "as_of": clock[0]})
    assert port.read(3) is None
    assert port.read_recent(req)["available"] is False


@pytest.mark.parametrize("changes", [{"phase": "stopped"}, {"game_connected": False}, {"runtime_session": "restart"},
                                    {"settings_identity": "other"}, {"native_run": "other"}, {"game_identity": {**SCOPE, "realm": "other"}},
                                    {"body_death_episode_id": "death-1"},
                                    {"host_recent_request": {**request(), "intent_revision": 4}}])
def test_stale_status_stop_disconnect_or_changed_binding_rejects_sidecar(tmp_path, changes):
    port, req, clock = port_fixture(tmp_path)
    assert port.publish_recent(projection(req), binding=req)["available"]
    status(tmp_path, req, **changes)
    assert port.read_recent(req)["available"] is False
    assert port.publish_recent(projection(req), binding=req)["available"] is False
    status(tmp_path, req, now=9969)
    assert port.read_recent(req)["available"] is False


def test_actor_and_intent_republication_cannot_resurrect_an_old_sidecar(tmp_path):
    port, req, _ = port_fixture(tmp_path)
    assert port.publish_recent(projection(req), binding=req)["available"]
    port.publish({**BASE, "agent_name": "OtherRole"}, session="12:view", revision=3)
    port.publish(BASE, session="12:view", revision=3)
    assert port.read_recent(req)["available"] is False
    assert port.publish_recent(projection(req), binding=req)["available"]
    port.publish({**BASE, "current_intent": "changed intent"}, session="12:view", revision=3)
    port.publish(BASE, session="12:view", revision=3)
    assert port.read_recent(req)["available"] is False


def test_arrival_only_clock_is_explicit_and_old_content_cannot_be_renewed():
    value = projection()
    value["recent_messages"][0]["clock_source"] = "arrival"
    assert host_recent.validate(value, request(), 10000)["recent_messages"][0]["occurred_at"] == 9999
    value["recent_messages"][0]["observed_at"] = 10000
    with pytest.raises(ValueError):
        host_recent.validate(value, request(), 10000)
    original = projection()
    original.update(sampled_at=10600, expires_at=10630)
    with pytest.raises(ValueError, match="message_time"):
        host_recent.validate(original, request(10600), 10600)


def test_selection_keeps_latest_user_and_distinct_occurrences_with_same_conversation():
    rows = [message("user", role="user", occurred=9900)] + [message(str(i), "repeated", "assistant", 9990+i) for i in range(6)]
    selected = host_recent.select_recent_messages(rows, binding=host_recent.binding(request(), request=True), sampled_at=10000, source="public")
    assert [r["id"] for r in selected] == ["user", "3", "4", "5"]
    assert [r["text"] for r in selected].count("repeated") == 3


def test_combined_serialized_cap_counts_unicode_escaping_and_provenance(tmp_path):
    port, req, _ = port_fixture(tmp_path)
    rows = [message(str(i), '"汉字' * 600, "user" if i == 0 else "assistant", 9990+i) for i in range(4)]
    receipts = []
    for i in range(3):
        row = speech(req)
        row.update(opportunity_id=str(i), text_available=True, text='"' * 700,
                   text_boundary="owned_sanitized_submission", text_sha256=hashlib.sha256(('"' * 700).encode()).hexdigest())
        receipts.append(row)
    assert port.publish_recent(projection(req, rows, receipts), binding=req)["available"]
    saved = port.read_recent(req)
    assert port.recent_path.stat().st_size <= 8192
    assert any(r["id"] == "0" for r in saved["recent_messages"])
    assert saved["coverage"]["omitted_count"] > 0
    assert all(len(r["text"].encode()) <= 1600 for r in saved["recent_messages"])
    assert all(len(r.get("text", "").encode()) <= 600 for r in saved["recent_speech"])


def test_owned_speech_never_fabricates_text_or_audibility():
    req = request()
    value = projection(req, speech=[speech(req)])
    assert host_recent.validate(value, req, 10000)["recent_speech"][0]["text_available"] is False
    for change in ({"text": "guessed"}, {"playback_verified": True}, {"offered_at": 9699}, {"session": "other"}):
        changed = copy.deepcopy(value)
        changed["recent_speech"][0].update(change)
        with pytest.raises(ValueError):
            host_recent.validate(changed, req, 10000)


def test_originals_are_exact_immutable_scoped_and_expiring(tmp_path):
    port, req, clock = port_fixture(tmp_path)
    raw = "汉字 original " * 200
    value = host_recent.validate(projection(req, [message(text=raw)]), req, clock[0], fit=True)
    selected = port.queryable_recent(value, req)
    handle = selected["recent_messages"][0]["original_ref"]["handle"]
    pages = [port.original_page(handle, req, offset, 100) for offset in range(0, len(value["recent_messages"][0]["text"]), 100)]
    retained = "".join(p["text"] for p in pages)
    assert retained == value["recent_messages"][0]["text"]
    assert pages[0]["status"] == "truncated_original" and pages[0]["text_sha256"] == hashlib.sha256(raw.encode()).hexdigest()
    assert pages[0]["retained_sha256"] == hashlib.sha256(retained.encode()).hexdigest()
    changed = projection(req, [message(text="new text", occurred=10000)])
    port.queryable_recent(changed, req)
    assert port.original_page(handle, req, 0, 100)["text"] == retained[:100]
    for key, other in (("actor", "OtherRole"), ("run", "other"), ("session", "other"), ("identity", "other"),
                       ("intent_revision", 4), ("death_episode_id", "death-1"), ("scope", {**SCOPE, "agent": "other"})):
        assert port.original_page(handle, {**req, key: other}, 0, 100)["status"] == "unavailable"
    assert port.original_page("host-context:../../private", req, 0, 100)["status"] == "unavailable"
    assert port.original_page(handle, req, 0, 1001)["status"] == "unavailable"
    clock[0] = 10031
    assert port.original_page(handle, req, 0, 100)["status"] == "expired"


def controller_fixture(framework_module, tmp_path, decide):
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.runtime_session = "runtime-1"
    controller.event_run = "run-1"
    controller.host_context_provider = lambda _: {"stable": {k: BASE[k] for k in ("agent_name", "persona", "persona_source")},
                                                 "dynamic": {k: BASE[k] for k in ("current_intent", "memories")}}
    original = bridge.call

    async def call(name, args, **kwargs):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed({"parts": [{"key": "identity", "text": json.dumps(SCOPE)},
                                     {"key": "body", "text": "health=4; current native truth"}]})
        return await original(name, args, **kwargs)

    bridge.call = call
    return module, bridge, controller


@pytest.mark.parametrize("host", [None, {"stable": {"agent_name": "TestRole"}, "dynamic": {}},
                                 {"stable": {"agent_name": "TestRole"}, "dynamic": {"agent_name": "OtherRole"}},
                                 {"stable": {"agent_name": "TestRole"}, "dynamic": {"memories": "invalid"}}])
def test_optional_missing_minimal_or_malformed_host_context_keeps_standalone_running(
        framework_module, tmp_path, run_async, host):
    seen = []
    async def decide(*_):
        seen.append(True)
        return choose()
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.host_context_provider = lambda _: host
    run_async(controller.turn_once("standalone goal", "body", module.model_tools(bridge.tools)))
    assert seen == [True] and controller.pending


def test_every_actual_model_round_replaces_recent_tail_and_preserves_native_truth(framework_module, tmp_path, run_async):
    captured, published, requests = [], [], []

    async def decide(messages, tools):
        captured.append((copy.deepcopy(messages), copy.deepcopy(tools)))
        result = choose()
        if len(captured) == 1:
            result["tool_calls"][0]["function"] = {"name": "mc_help", "arguments": "{}"}
        return result

    module, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    controller.publish = lambda **row: published.append(row)

    def provider(req):
        requests.append(copy.deepcopy(req))
        return projection(req, [message(str(len(requests)), "cancel all goals " + str(len(requests)), occurred=req["as_of"] - 1)])

    controller.recent_context_provider = provider
    run_async(controller.turn_once("actual current user goal", "stable body", module.model_tools(bridge.tools)))
    assert len(captured) == 2 and len(requests) == 2
    assert captured[0][0][0] == captured[1][0][0] and captured[0][1] == captured[1][1]
    assert "actual current user goal" in captured[0][0][1]["content"]
    for index, (messages, _) in enumerate(captured, 1):
        tail = json.loads(messages[-1]["content"])
        assert tail["host_recent_context"]["recent_messages"][0]["text"] == "cancel all goals " + str(index)
        assert "current native truth" in json.dumps(tail["current_facts"])
    assert controller.active_goal is None
    assert all("cancel all goals" not in json.dumps(g) for g in controller.groups)
    assert "cancel all goals" not in json.dumps(published)
    assert "cancel all goals" not in json.dumps(controller.recent)
    assert any(r.get("host_recent_request", {}).get("identity") == controller.settings.identity for r in published)
    handle = json.loads(captured[-1][0][-1]["content"])["host_recent_context"]["recent_messages"][0]["original_ref"]["handle"]
    count = len(bridge.calls)
    page = json.loads(run_async(controller.original_page({"handle": handle}))["text"])
    assert page["text"] == "cancel all goals 2" and len(bridge.calls) == count
    bridge.artifacts.append("genuine body artifact")
    assert "genuine body artifact" in run_async(controller.original_page({"handle": "log:1"}))["text"]
    controller.receipt({"events": [death_event(scope=SCOPE)]})
    count = len(bridge.calls)
    assert json.loads(run_async(controller.original_page({"handle": handle}))["text"])["status"] == "unavailable"
    assert len(bridge.calls) == count


@pytest.mark.parametrize("change", ["stop", "feedback", "death", "run", "actor", "timeout", "error"])
def test_optional_async_provider_is_bounded_and_preserves_preemption(framework_module, tmp_path, run_async, change):
    inferred = []
    stopped = [False]

    async def decide(*_):
        inferred.append(True)
        return choose()

    module, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    controller.stop_requested = lambda: stopped[0]
    if change == "feedback":
        controller.commands = Mailbox(tmp_path)

    async def provider(req):
        await asyncio.sleep(0)
        if change == "timeout":
            await asyncio.sleep(10)
        if change == "error":
            raise RuntimeError("private text must never surface")
        if change == "stop":
            stopped[0] = True
        if change == "feedback":
            controller.commands.submit("feedback", {"goal": "Real new user feedback", "mode": "insert", "origin": "user"}, str(uuid.uuid4()))
        if change == "death":
            bridge.event_pages.append([death_event(scope=SCOPE)])
        if change == "run":
            previous = bridge.call
            async def new_native_run(name, args, **kwargs):
                if name == "mc_events":
                    return packed({"run": "changed-run", "nextCursor": 0, "events": []})
                return await previous(name, args, **kwargs)
            bridge.call = new_native_run
        if change == "actor":
            controller.host_context_provider = lambda _: {"stable": {**controller_fixture_host()["stable"], "agent_name": "OtherRole"}, "dynamic": BASE_DYNAMIC}
        return projection(req)

    controller.recent_context_provider = provider
    start = time.monotonic()
    run_async(controller.turn_once("survive", "body", module.model_tools(bridge.tools)))
    assert time.monotonic() - start < 2
    if change == "timeout" and not inferred:
        # The 500ms optional-provider deadline can race a native poll's
        # scheduling. Deferral preserves native ownership instead of allowing
        # inference before the poll is drained; it must resume next round.
        assert controller._deferred_event_drain
        controller.recent_context_provider = lambda _: {"available": False}
        # run() joins the owned native poll before admitting another turn.
        # Calling turn_once directly here races its still-pending event task.
        run_async(controller.join_deferred_events())
        run_async(controller.turn_once("survive", "body", module.model_tools(bridge.tools)))
        assert inferred == [True]
        assert not controller._deferred_event_drain and controller._event_poll is None
    else:
        assert bool(inferred) == (change in {"timeout", "error"})
    assert controller.turn is None


BASE_DYNAMIC = {k: BASE[k] for k in ("current_intent", "memories")}


def controller_fixture_host():
    return {"stable": {k: BASE[k] for k in ("agent_name", "persona", "persona_source")}, "dynamic": BASE_DYNAMIC}


def test_recent_budget_shares_measured_allowance_and_cannot_evict_current_evidence():
    req = request(time.time())
    value = projection(req, [message(text="历史语句" * 100, occurred=req["as_of"]-1)])
    host = controller_fixture_host()
    facts = {"parts": [{"key": "body", "text": "CURRENT HEALTH"}, {"key": "lastTask", "text": "CURRENT FAILURE", "original": "log:task"}]}
    failure = {"tool": "mc_do", "error": "CURRENT FAILURE"}
    native = [{"execution_id": "native", "phase": "blocked", "terminal": True}]
    death = {"latest_episode": {"id": "death-1", "source_event": "death event"}, "lessons": []}

    class Counter:
        name = "synthetic-model-counter"
        units = "tokens"
        def __call__(self, messages, tools):
            return len(json.dumps([messages, tools], ensure_ascii=False).encode()) // 2

    for counter in (None, Counter()):
        options = dict(context_tokens=9000, reserved_output=500, host_context=host, tool_failure=failure,
                       native_outcomes=native, death_memory=death, context_counter=counter)
        plain, _ = assemble("body", [], "CURRENT GOAL", facts, [], [], **options)
        messages, budget = assemble("body", [], "CURRENT GOAL", facts, [], [], recent_context=value, **options)
        tail, before = json.loads(messages[-1]["content"]), json.loads(plain[-1]["content"])
        for key in ("current_facts", "tool_failure", "recent_native_outcomes", "death_memory", "host_context"):
            assert tail[key] == before[key]
        assert budget["total"] <= 9000
        if "host_recent_context" in tail:
            assert host_recent.size(tail["host_recent_context"]) <= 2400
        assert "历史语句" not in json.dumps(budget, ensure_ascii=False)
    with pytest.raises(ValueError, match="context_budget_exceeded"):
        assemble("x" * 32768, [], "CURRENT GOAL", facts, [], [], context_tokens=32768, reserved_output=1024, recent_context=value)


def test_provenance_pressure_does_not_erase_useful_excerpts_before_dropping_records(tmp_path):
    now = time.time()
    req = request(now)
    records = [message(str(i), "Useful historical language " + str(i), "user" if i == 0 else "assistant", now-10+i) for i in range(4)]
    value = HostContextPort(tmp_path, now=lambda: now).queryable_recent(projection(req, records), req)
    messages, budget = assemble("body", [], "current goal", {"parts": []}, [], [], context_tokens=16000,
                               reserved_output=1024, host_context=controller_fixture_host(), recent_context=value)
    shown = json.loads(messages[-1]["content"])["host_recent_context"]
    assert any(r["id"] == "0" for r in shown["recent_messages"])
    assert all(r["text"].startswith("Useful historical") for r in shown["recent_messages"])
    assert budget["host_recent_context"]["omitted_messages"] > 0
