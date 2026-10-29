import dataclasses
import hashlib
import json
import uuid

import pytest
from test_controller import setup


@pytest.mark.parametrize(
    "arguments",
    [
        {"handle": "log:fixture", "limit": 2000},
        {"handle": "log:fixture", "limit": True},
        {"handle": "log:fixture", "offset": -1},
        {"offset": 0},
    ],
)
def test_bad_original_is_failed_tool_result_without_uncertainty(
    framework_module, tmp_path, run_async, arguments
):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.persist(
        stopped=False, pending=[], uncertain=False, inflight_request=None
    )
    result, _ = run_async(
        controller.dispatch("mc_original", arguments, str(uuid.uuid4()))
    )
    assert result["failed"] and result["dispatched"] is False
    assert result["code"] == "invalid_original_page"
    assert not bridge.calls
    state = json.loads(controller.state_path.read_text())
    assert state["uncertain"] is False and state["inflight_request"] is None


def rejected_fixture(tmp_path, framework_module):
    from agent_mc_autonomy.mailbox import Mailbox
    from agent_mc_autonomy.local_rejection_recovery import latest_decision

    settings = dataclasses.replace(
        framework_module.Settings(), host="example.test", username="Alice"
    )
    host = tmp_path / "sessions" / settings.identity / "host"
    host.mkdir(parents=True)
    Mailbox(host).submit(
        "goal", {"goal": "fixture preserved intent"}, str(uuid.uuid4())
    )
    state = {
        "stopped": True,
        "pending": [],
        "uncertain": True,
        "inflight_request": str(uuid.uuid4()),
    }
    status = {
        "phase": "failed",
        "game_connected": False,
        "autonomy_running": False,
        "settings_identity": settings.identity,
    }
    decision = {
        "response": {
            "tool_calls": [
                {
                    "function": {
                        "name": "mc_original",
                        "arguments": json.dumps(
                            {"handle": "log:example", "limit": 2000}
                        ),
                    }
                }
            ]
        }
    }
    for name, content in [("host-state.json", state), ("status.json", status)]:
        (host / name).write_text(json.dumps(content))
    (host / "decisions.jsonl").write_text(json.dumps(decision) + "\n")
    (host / "host-error.log").write_text(
        'File "controller.py", line 976, in original_page\nValueError: Invalid original artifact page\n'
    )
    options = {
        "expected_state_sha256": hashlib.sha256(
            (host / "host-state.json").read_bytes()
        ).hexdigest(),
        "expected_status_sha256": hashlib.sha256(
            (host / "status.json").read_bytes()
        ).hexdigest(),
        "expected_decision_sha256": hashlib.sha256(
            latest_decision(host)[0]
        ).hexdigest(),
        "request_id": str(uuid.uuid4()),
        "operator": "fixture",
        "evidence_id": "fixture-owner-exited",
        "attest_prior_processes_exited": True,
    }
    return settings, host, state, options


def test_historical_local_rejection_preserves_snapshots_and_never_replays(
    tmp_path, framework_module
):
    from agent_mc_autonomy.local_rejection_recovery import (
        reconcile_local_original_rejection,
    )

    settings, host, before, options = rejected_fixture(tmp_path, framework_module)
    receipt = reconcile_local_original_rejection(settings, tmp_path, **options)
    assert receipt["classification"] == "local_validation_rejected"
    assert (
        receipt["dispatched"]
        is receipt["native_replay"]
        is receipt["autostart"]
        is False
    )
    after = json.loads((host / "host-state.json").read_text())
    assert after == {**before, "inflight_request": None, "uncertain": False}
    assert (
        json.loads(
            (
                host
                / "local-read-reconciliations"
                / options["request_id"]
                / "before-state.json"
            ).read_text()
        )
        == before
    )
    assert reconcile_local_original_rejection(settings, tmp_path, **options) == receipt


@pytest.mark.parametrize(
    "change",
    [
        "native_tool",
        "pending",
        "valid_read",
        "changed_digest",
        "missing_trace",
        "no_attestation",
    ],
)
def test_reconciliation_rejects_other_unknown_work(tmp_path, framework_module, change):
    from agent_mc_autonomy.local_rejection_recovery import (
        latest_decision,
        reconcile_local_original_rejection,
    )

    settings, host, _, options = rejected_fixture(tmp_path, framework_module)
    if change in {"native_tool", "valid_read"}:
        decision = json.loads((host / "decisions.jsonl").read_text())
        call = decision["response"]["tool_calls"][0]["function"]
        if change == "native_tool":
            call["name"] = "mc_do"
        else:
            call["arguments"] = '{"handle":"log:example","limit":1000}'
        (host / "decisions.jsonl").write_text(json.dumps(decision) + "\n")
        options["expected_decision_sha256"] = hashlib.sha256(
            latest_decision(host)[0]
        ).hexdigest()
    elif change == "pending":
        state = json.loads((host / "host-state.json").read_text())
        state["pending"] = [{"id": "body-task"}]
        (host / "host-state.json").write_text(json.dumps(state))
        options["expected_state_sha256"] = hashlib.sha256(
            (host / "host-state.json").read_bytes()
        ).hexdigest()
    elif change == "changed_digest":
        options["expected_state_sha256"] = "0" * 64
    elif change == "missing_trace":
        (host / "host-error.log").write_text("different failure")
    else:
        options["attest_prior_processes_exited"] = False
    before = (host / "host-state.json").read_bytes()
    with pytest.raises((ValueError, RuntimeError)):
        reconcile_local_original_rejection(settings, tmp_path, **options)
    assert (host / "host-state.json").read_bytes() == before


def test_interrupted_audit_blocks_start_until_explicit_same_id_retry(
    tmp_path, framework_module, monkeypatch
):
    import agent_mc_autonomy.local_rejection_recovery as recovery
    from agent_mc_autonomy.recovery import require_no_pending_acknowledgement

    settings, host, _, options = rejected_fixture(tmp_path, framework_module)
    original = recovery.durable_write

    def interrupted(path, body):
        if path.name == "receipt.json":
            raise OSError("fixture interrupted commit")
        return original(path, body)

    monkeypatch.setattr(recovery, "durable_write", interrupted)
    with pytest.raises(OSError):
        recovery.reconcile_local_original_rejection(settings, tmp_path, **options)
    with pytest.raises(RuntimeError, match="unfinished local read"):
        require_no_pending_acknowledgement(host)
    monkeypatch.setattr(recovery, "durable_write", original)
    result = recovery.reconcile_local_original_rejection(settings, tmp_path, **options)
    assert result["autostart"] is False
    require_no_pending_acknowledgement(host)
