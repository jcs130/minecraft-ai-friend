import hashlib
import json

import pytest
from test_recovery import fixture


def clean_fixture(tmp_path, framework_module):
    settings, host, box, feedback, options = fixture(tmp_path, framework_module)
    status_path = host / "status.json"
    status = json.loads(status_path.read_text())
    status.update(phase="stopped", pending=[], disconnect_confirmed=True)
    status_path.write_text(json.dumps(status), encoding="utf-8")
    options.update(choice="acknowledge-clean-stop-read-gap", native_request_ids=[],
                   expected_status_sha256=hashlib.sha256(status_path.read_bytes()).hexdigest())
    client = host.parent / "client"
    request = "fd81655b-fc62-40a8-937f-dc747a5360a4"
    with (client / f"events-{options['expected_run']}.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"run": options["expected_run"], "cursor": 2, "execution": {
            "kind": "task", "id": "d48caefd-1030-428d-9c4f-8df1e54efd35:9", "terminal": True, "phase": "blocked"}}) + "\n")
    (client / "tools.jsonl").write_text(json.dumps({"run": options["expected_run"], "callId": request, "name": "mc_do"}) + "\n", encoding="utf-8")
    return settings, host, box, feedback, options


def test_clean_stop_read_gap_is_explicit_audited_and_never_replays(tmp_path, framework_module):
    from agent_mc_autonomy.recovery import acknowledge_unknown, assess_clean_stop, require_no_pending_acknowledgement
    settings, host, box, feedback, options = clean_fixture(tmp_path, framework_module)
    before = (host / "host-state.json").read_bytes()
    command = box.get(feedback)
    observed = assess_clean_stop(settings, tmp_path)
    assert observed["eligible_shape"] and observed["read_gap_only"]
    assert observed["linked_terminal_count"] == 1
    assert (host / "host-state.json").read_bytes() == before
    result = acknowledge_unknown(settings, tmp_path, **options)
    assert result["classification"] == "acknowledged_unknown" and result["verified"] is False
    assert result["native_replay"] is False and result["autostart"] is False
    assert json.loads((host / "host-state.json").read_text()) == {
        "stopped": True, "uncertain": False, "pending": [], "inflight_request": None}
    assert box.get(feedback) == command
    require_no_pending_acknowledgement(host)
    assert acknowledge_unknown(settings, tmp_path, **options) == result


@pytest.mark.parametrize("damage", ["missing_terminal", "unknown_effect", "unreturned", "wrong_request", "wrong_run", "disconnect_unconfirmed"])
def test_clean_stop_refuses_missing_or_unknown_native_evidence(tmp_path, framework_module, damage):
    from agent_mc_autonomy.recovery import acknowledge_unknown
    settings, host, _, _, options = clean_fixture(tmp_path, framework_module)
    client = host.parent / "client"
    archive = client / f"events-{options['expected_run']}.jsonl"
    request_path = client / "requests" / (hashlib.sha256(b"fd81655b-fc62-40a8-937f-dc747a5360a4").hexdigest() + ".json")
    if damage == "missing_terminal":
        archive.write_text(archive.read_text().splitlines()[0] + "\n")
    elif damage in {"unknown_effect", "unreturned", "wrong_request"}:
        value = json.loads(request_path.read_text())
        if damage == "unknown_effect":
            value["outcome"]["execution"]["evidence"] = {"outcomeUnknown": True}
        elif damage == "unreturned":
            value["phase"] = "dispatching"
        else:
            value["requestId"] = "different"
        request_path.write_text(json.dumps(value))
    elif damage == "wrong_run":
        (client / "tools.jsonl").write_text(json.dumps({"run": "foreign", "callId": "fixture", "name": "mc_do"}) + "\n")
    else:
        p = host / "status.json"
        value = json.loads(p.read_text()); value["disconnect_confirmed"] = False
        p.write_text(json.dumps(value)); options["expected_status_sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()
    before = (host / "host-state.json").read_bytes()
    with pytest.raises((ValueError, RuntimeError)):
        acknowledge_unknown(settings, tmp_path, **options)
    assert (host / "host-state.json").read_bytes() == before


def test_clean_stop_prepared_ack_blocks_restart_and_retries_only_same_id(tmp_path, framework_module, monkeypatch):
    import agent_mc_autonomy.recovery as recovery
    settings, host, _, _, options = clean_fixture(tmp_path, framework_module)
    original = recovery._write_immutable
    def crash(path, body):
        if path.name == "committed.json":
            raise OSError("fixture crash after CAS")
        return original(path, body)
    monkeypatch.setattr(recovery, "_write_immutable", crash)
    with pytest.raises(OSError):
        recovery.acknowledge_unknown(settings, tmp_path, **options)
    with pytest.raises(RuntimeError):
        recovery.require_no_pending_acknowledgement(host)
    monkeypatch.setattr(recovery, "_write_immutable", original)
    receipt = recovery.acknowledge_unknown(settings, tmp_path, **options)
    assert receipt["native_replay"] is False
    recovery.require_no_pending_acknowledgement(host)


@pytest.mark.parametrize("name,allowed", [("mc_events", True), ("mc_do", False)])
def test_numbered_internal_observation_is_not_a_hidden_action(tmp_path, framework_module, name, allowed):
    from agent_mc_autonomy.recovery import acknowledge_unknown
    settings, host, _, _, options = clean_fixture(tmp_path, framework_module)
    with (host.parent / "client/tools.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"run": options["expected_run"], "callId": "fd81655b-fc62-40a8-937f-dc747a5360a4:7", "name": name}) + "\n")
    if allowed:
        assert acknowledge_unknown(settings, tmp_path, **options)["native_replay"] is False
    else:
        with pytest.raises((RuntimeError, OSError)):
            acknowledge_unknown(settings, tmp_path, **options)
