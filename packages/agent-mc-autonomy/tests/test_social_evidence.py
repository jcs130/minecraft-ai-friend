"""Offline boundary evidence, transcript continuity and recipient-local routing."""
import dataclasses
import hashlib
import json
import math
import sqlite3

import pytest
from test_controller import packed, setup
from test_social import MEMBERS, NAMES, config, event, transport

from agent_mc_autonomy.social import SocialInbox
from agent_mc_autonomy.social_diagnostics import inspect_social


def settings(module, **options):
    return dataclasses.replace(module.Settings(), username=NAMES[0], host="fixture.invalid", social=config(**options))


def test_topic_context_includes_own_actual_send_in_order_without_claiming_hearing(tmp_path):
    clock = [1000]
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: clock[0])
    first = event(text="一起收麦吗？")
    inbox.offer(first)
    inbox.model_started([first], "request-1")
    inbox.model_finished("request-1")
    clock[0] += 1
    inbox.note_transport(transport("我来补种。", now=clock[0]))
    clock[0] += 1
    last = event(2, speaker="Yui", text="我把种子拿来了。", now=clock[0])
    inbox.offer(last)
    assert [row["speaker"] for row in inbox.context()["dialogue"]] == ["Coobot", NAMES[0]]
    inbox.model_started([last], "request-2")
    inbox.model_finished("request-2")
    inbox = SocialInbox(tmp_path, config(batch_seconds=0), NAMES[0], clock=lambda: clock[0])
    dialogue = inbox.context()["dialogue"]
    assert [row["speaker"] for row in dialogue] == ["Coobot", NAMES[0], "Yui"]
    assert dialogue[1]["direction"] == "outgoing" and dialogue[1]["recipient_heard"] == "unknown"
    assert dialogue[1]["attention"] == "transport_sent"
    assert not inbox.ready()  # Transcript recovery never creates a wakeup.


def test_prior_candidate_outgoing_hashes_survive_schema_upgrade(tmp_path):
    inbox = SocialInbox(tmp_path, config(), NAMES[0], clock=lambda: 1000)
    inbox.note_transport(transport())
    with sqlite3.connect(inbox.path) as db:
        db.execute("ALTER TABLE outgoing DROP COLUMN payload")
    inbox = SocialInbox(tmp_path, config(), NAMES[0], clock=lambda: 1001)
    assert inbox.speech_problem("mc_do", {"steps": [{"skill": "chat", "text": "收到！"}]})
    assert not inbox.context()["dialogue"]  # Old hashes cannot reconstruct a fabricated transcript.


def test_private_sent_context_and_counters_stay_in_the_receiving_account(tmp_path, framework_module):
    first = SocialInbox(tmp_path / "first", config(), NAMES[0], clock=lambda: 1000)
    other = SocialInbox(tmp_path / "other", config(), NAMES[1], clock=lambda: 1000)
    first.note_transport(transport("只给悠怡的私信", channel="private", to="Yui"))
    assert first.context()["dialogue"][0]["to"] == "Yui"
    assert not other.context()["dialogue"]
    assert inspect_social(tmp_path / "other", dataclasses.replace(settings(framework_module), username=NAMES[1]))["outgoing"]["client_transport_sent"] == 0
    changed = [dict(row) for row in MEMBERS]
    changed[1]["uuid"] = MEMBERS[0]["uuid"].replace("001", "099")
    new = dataclasses.replace(config(), members=tuple((row["name"], row["uuid"]) for row in changed))
    rebound = SocialInbox(tmp_path / "first", new, NAMES[0], clock=lambda: 1001)
    assert rebound.status()["counts"] == {} and not rebound.context()["dialogue"]


def fingerprint(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in directory.rglob("*") if p.is_file()}


def test_diagnostics_distinguishes_receive_pending_consumed_unknown_and_sending_read_only(tmp_path, framework_module):
    cfg = settings(framework_module, batch_seconds=0)
    inbox = SocialInbox(tmp_path, cfg.social, cfg.username, clock=lambda: 1000)
    first, second, third = event(), event(2, speaker="DeepFish"), event(3, speaker="Yui")
    for row in (first, second, third):
        inbox.offer(row)
    inbox.model_started([first], "turn-observed")
    inbox.model_finished("turn-observed")
    inbox.model_started([second], "turn-lost")
    inbox.note_transport(transport("这不是收获完成证明"))
    (tmp_path / "status.json").write_text(json.dumps({"phase": "running", "game_connected": True,
        "host_context": {"persona": "private"}, "api_key": "never-print"}), encoding="utf-8")
    before = fingerprint(tmp_path)
    report = inspect_social(tmp_path, cfg, clock=lambda: 2000)
    assert fingerprint(tmp_path) == before
    assert report["live_verified"] is False and report["action_completion_inferred"] is False
    assert report["host_adapter"] == "unverified" and report["snapshot"]["game_connected"] is True
    peers = {row["name"]: row for row in report["peers"]}
    assert peers["Coobot"]["decision"] == "model_observed"
    assert peers["DeepFish"]["decision"] == "model_outcome_unknown"
    assert peers["Yui"]["decision"] == "awaiting_model" and peers["Yui"]["latest_input"]["expired_at_inspection"]
    assert peers["Coobot"]["latest_input"]["model_request"] == "turn-observed"
    assert report["outgoing"]["client_transport_sent"] == 1 and report["outgoing"]["recipient_heard"] == "unknown"
    assert "麦田" not in json.dumps(report, ensure_ascii=False) and "never-print" not in json.dumps(report)


def test_diagnostics_does_not_treat_name_only_or_absent_evidence_as_verified_hearing(tmp_path, framework_module):
    cfg = settings(framework_module)
    inbox = SocialInbox(tmp_path, cfg.social, cfg.username, clock=lambda: 1000)
    inbox.offer(event(identityEvidence="explicit-chat-event", senderUuid=None))
    peer = inspect_social(tmp_path, cfg)["peers"][0]
    assert peer["hearing"] == "not_observed" and peer["decision"] == "not_observed"
    assert peer["reasons"] == {"identity_unverified": 1}
    assert all(row["latest_input"] is None for row in inspect_social(tmp_path, cfg)["peers"])
    changed = dataclasses.replace(cfg, username=NAMES[1])
    assert inspect_social(tmp_path, changed)["ledger"] == "binding_mismatch"
    absent = tmp_path / "absent"
    assert inspect_social(absent, cfg)["ledger"] == "not_observed" and not absent.exists()


@pytest.mark.parametrize("account,match", [
    ("offline:" + MEMBERS[0]["uuid"], True),
    ("uuid:" + MEMBERS[1]["uuid"].replace("-", ""), False),
    ("offline:FixtureWithoutUuid", None),
])
def test_diagnostic_self_binding_uses_only_available_snapshot_uuid(tmp_path, framework_module, account, match):
    (tmp_path / "status.json").write_text(json.dumps({"game_identity": {"account": account}}), encoding="utf-8")
    report = inspect_social(tmp_path, settings(framework_module))
    assert report["self_binding"]["snapshot_uuid_matches_roster"] is match
    assert report["self_binding"]["configured_uuid"] == MEMBERS[0]["uuid"]
    assert report["live_verified"] is False  # A matching old UUID does not certify current presence.


def test_social_status_cli_is_passive_and_does_not_require_a_body_or_model(tmp_path, framework_module, monkeypatch, capsys):
    import agent_mc_autonomy.cli as cli
    cfg = settings(framework_module)
    filename = tmp_path / "fixture.toml"
    filename.write_text("", encoding="utf-8")
    monkeypatch.setattr(cli.Settings, "parse", lambda _: cfg)
    def forbidden(*_, **__):
        pytest.fail("social-status must never construct or connect a body/model")
    monkeypatch.setattr(cli, "play", forbidden)
    monkeypatch.setattr(cli, "HttpPlannerConfig", forbidden)
    before = fingerprint(tmp_path)
    assert cli.main(["social-status", "--config", str(filename), "--data", str(tmp_path / "missing")]) == 0
    assert json.loads(capsys.readouterr().out)["ledger"] == "not_observed"
    assert fingerprint(tmp_path) == before and not (tmp_path / "missing").exists()


def test_invalid_ledger_is_reported_without_repair_or_private_error_text(tmp_path, framework_module):
    cfg = settings(framework_module)
    path = tmp_path / "social.sqlite3"
    path.write_bytes(b"not a database containing secret material")
    before = fingerprint(tmp_path)
    with pytest.raises(ValueError, match="^social_ledger_unreadable$"):
        inspect_social(tmp_path, cfg)
    assert fingerprint(tmp_path) == before


def test_plain_model_narration_is_consumption_without_transport_evidence(
        tmp_path, framework_module, run_async):
    async def decide(*_):
        return {"content": "我会告诉大家一起收麦。", "tool_calls": []}
    module, bridge, ctl = setup(framework_module, tmp_path, decide)
    ctl.settings = settings(framework_module, batch_seconds=0)
    ctl.social = SocialInbox(tmp_path, ctl.settings.social, NAMES[0], clock=lambda: 1000)
    ctl.receipt({"events": [event()]})
    run_async(ctl.turn_once("生存", "prefix", module.model_tools(bridge.tools)))
    report = inspect_social(tmp_path, ctl.settings)
    assert report["peers"][0]["decision"] == "model_observed"
    assert report["outgoing"]["client_transport_sent"] == 0
    assert report["outgoing"]["recipient_heard"] == "unknown"
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)


@pytest.mark.parametrize("route,heard", [
    ({"world": "world", "dimension": "overworld", "position": (48, 64, 0), "online": True}, True),
    ({"world": "world", "dimension": "overworld", "position": (48.01, 64, 0), "online": True}, False),
    ({"world": "nether", "dimension": "nether", "position": (0, 64, 0), "online": True}, False),
    ({"world": "another-overworld", "dimension": "overworld", "position": (0, 64, 0), "online": True}, False),
    ({"world": "world", "dimension": "overworld", "position": (0, 64, 0), "online": False}, False),
])
def test_recipient_local_route_same_world_distance_dimension_and_offline(
        route, heard, tmp_path, framework_module, run_async):
    """Explicit fake of the documented 48-block route, not a live server test.

    Route selection belongs to the fake server; no production-side distance
    guess, shared transcript or sender's sent receipt fabricates a receive.
    """
    decisions = []
    async def decide(messages, _):
        decisions.append(messages)
        return {"content": "", "tool_calls": []}
    module, bridge, ctl = setup(framework_module, tmp_path, decide)
    ctl.settings = settings(framework_module, batch_seconds=0)
    ctl.social = SocialInbox(tmp_path, ctl.settings.social, NAMES[0], clock=lambda: 1000)
    sender = {"world": "world", "dimension": "overworld", "position": (0, 64, 0), "online": True}
    delivered = (route["online"] and sender["online"] and route["world"] == sender["world"]
                 and route["dimension"] == sender["dimension"]
                 and math.dist(route["position"], sender["position"]) <= 48)
    assert delivered == heard
    if delivered:
        bridge.event_pages.append([event()])
    ctl.social.note_transport(transport())  # Independent of whether any peer receives anything.
    wake, urgent, _ = run_async(ctl._poll_events())
    assert wake == heard and not urgent
    if wake:
        run_async(ctl.turn_once("生存", "prefix", module.model_tools(bridge.tools)))
    assert len(decisions) == int(heard)
    assert bool(ctl.social.context()["dialogue"])  # Our own send is historical, never a peer wake.
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)


@pytest.mark.parametrize("health,hunger", [(4, 20), (20, 3)])
def test_peer_chat_keeps_survival_focus_and_real_task_evidence(
        health, hunger, tmp_path, framework_module, run_async):
    captured = []
    async def decide(messages, _):
        captured.append(json.dumps(messages, ensure_ascii=False))
        return {"content": "", "tool_calls": []}
    module, bridge, ctl = setup(framework_module, tmp_path, decide)
    ctl.settings = settings(framework_module, batch_seconds=0)
    ctl.social = SocialInbox(tmp_path, ctl.settings.social, NAMES[0], clock=lambda: 1000)
    original_call = bridge.call
    async def call(name, args, **kwargs):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed({"parts": [{"key": "body", "text": f"health={health} hunger={hunger}"}]})
        return await original_call(name, args, **kwargs)
    bridge.call = call
    published = {}
    ctl.publish = lambda **values: published.update(values)
    ctl.receipt({"events": [event(text="来聊聊天吧。收麦只是我的计划，还没完成。")],
                 "execution": {"kind": "task", "id": "survival-work", "terminal": False, "phase": "running"}})
    run_async(ctl.turn_once("先活下来", "prefix", module.model_tools(bridge.tools)))
    assert published["fast_focus"]["choice"] == "survival"
    assert ("task", "survival-work") in ctl.pending
    assert "promising to harvest is not a completed harvest" in captured[0]
    assert not any(name in {"mc_do", "mc_stop"} for name, _, _ in bridge.calls)
