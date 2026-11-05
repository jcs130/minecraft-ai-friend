import json

import pytest

from agent_mc_autonomy.bridge import MinecraftBridge
from agent_mc_autonomy.work_evidence import PROTOCOL, SCHEMA


def bridge(tmp_path, answer, *, legacy=False):
    client = MinecraftBridge("unused-node", tmp_path / "unused", tmp_path / "config", tmp_path / "log")
    client.tools = [{"name": "mc_protocol", "inputSchema": {"properties": {"action": {"enum": ["report_review", "execution_wait"]}}},
                     "_meta": {} if legacy else {PROTOCOL: {"workEvidence": {"schema": SCHEMA, "tool": "mc_protocol",
                         "reportReviewAction": "report_review", "executionWaitAction": "execution_wait", "source": "caller-supplied"}}}}]
    calls = []

    async def call(name, arguments, **_):
        calls.append((name, arguments))
        return {"content": [{"type": "text", "text": json.dumps(answer)}]}

    client.call = call
    return client, calls


def test_review_forwards_full_record_and_preserves_non_adoption(tmp_path, run_async):
    record = {"assignmentId": "assignment", "reportRevision": 3, "report": {"status": "ready", "text": "结果", "evidence": ["call-1"]}}
    review = {"assignmentId": "assignment", "expectedReportRevision": 3, "decision": "release", "text": "核对"}
    answer = {"schema": SCHEMA, "source": "caller-supplied", "assignmentId": "assignment", "reportRevision": 3,
              "disposition": "reject", "code": "FULL_REPORT_REQUIRED", "mutated": False, "goalCompleted": False}
    client, calls = bridge(tmp_path, answer)
    assert run_async(client.inspect_report_review(record, review)) == answer
    assert calls == [("mc_protocol", {"protocol": PROTOCOL, "action": "report_review", "reportRecord": record, "review": review})]
    assert client._owner is None
    client, _ = bridge(tmp_path, {**answer, "reportRevision": 4})
    with pytest.raises(ValueError, match="work evidence"):
        run_async(client.inspect_report_review(record, review))


def test_wait_forwards_native_receipts_without_dispatch_or_python_policy(tmp_path, run_async):
    wait = {"world": "minecraft", "kind": "task", "id": "42"}
    observations = [{"world": "minecraft", "at": 100, "execution": {"kind": "task", "id": "42", "terminal": False}}]
    options = {"world": "minecraft", "after": 90}
    answer = {"schema": SCHEMA, "source": "caller-supplied", "disposition": "unique", "wait": wait,
              "candidates": [wait], "mutated": False, "goalCompleted": False}
    client, calls = bridge(tmp_path, answer)
    assert run_async(client.select_execution_wait(observations, options)) == answer
    assert calls[0][1] == {"protocol": PROTOCOL, "action": "execution_wait", "observations": observations, "waitOptions": options}
    for wrong in [{**answer, "mutated": True}, {**answer, "candidates": []}, {**answer, "goalCompleted": True},
                  {**answer, "source": "server-verified"}, {**answer, "wait": {**wait, "world": "dungeon"}}]:
        client, _ = bridge(tmp_path, wrong)
        with pytest.raises(ValueError, match="work evidence"):
            run_async(client.select_execution_wait(observations, options))


def test_older_core_is_explicitly_unknown_without_probes_or_fallback(tmp_path, run_async):
    client, calls = bridge(tmp_path, {}, legacy=True)
    assert run_async(client.inspect_report_review({}, {}))["available"] is False
    assert run_async(client.select_execution_wait([], {"world": "minecraft", "after": 0}))["disposition"] == "unknown"
    assert not calls
