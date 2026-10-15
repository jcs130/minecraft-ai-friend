import copy
import json
from datetime import datetime, timezone

import pytest

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.host_context import HostContextPort, validate_host_context


def profile():
    return {"agent_name": "TestRole", "persona": "爱观察，会珍惜已有物资。", "persona_source": "character_profile",
            "current_intent": "先找安全的食物，再准备营地。",
            "memories": [{"id": "memory-1", "source": "host_recall", "text": "用户希望保留原有建筑，不随意破坏。"}]}


def state(path, now=10000, owner=12):
    status = {"phase": "running", "game_connected": True, "owner_pid": owner, "viewer": {"session": "view"},
              "updated_at": datetime.fromtimestamp(now, timezone.utc).isoformat()}
    (path / "status.json").write_text(json.dumps(status))


def test_context_is_private_bound_to_session_intent_and_freshness(tmp_path):
    state(tmp_path)
    port = HostContextPort(tmp_path, now=lambda: 10000)
    port.publish(profile(), session="12:view", revision=3)
    saved = port.read(3)
    assert saved["stable"]["agent_name"] == "TestRole"
    assert saved["dynamic"]["memories"][0]["id"] == "memory-1"
    assert port.read(4) is None
    state(tmp_path, owner=13)
    assert port.read(3) is None
    state(tmp_path, now=10601)
    port.now = lambda: 10601
    assert port.read(3) is None


@pytest.mark.parametrize("change", [
    {"api_key": "must-not-enter"}, {"persona": "x" * 5000}, {"memories": [{"text": "no provenance"}]},
    {"persona_source": "exact_main_request"}, {"memories": profile()["memories"] * 7},
])
def test_host_context_has_a_bounded_explicit_contract(change):
    with pytest.raises(ValueError):
        validate_host_context({**profile(), **change})


def test_actual_planner_messages_share_identity_and_place_changing_memory_at_the_tail():
    value = validate_host_context(profile())
    context = {"stable": {k: value[k] for k in ("agent_name", "persona", "persona_source")},
               "dynamic": {k: value[k] for k in ("current_intent", "memories")}}
    messages, budget = assemble("body contract", [], "survive", {"parts": []}, [], [],
                                context_tokens=16000, reserved_output=500, host_context=context)
    assert "TestRole" in messages[0]["content"] and "爱观察" in messages[0]["content"]
    assert "memory-1" not in messages[0]["content"]
    assert json.loads(messages[-1]["content"])["host_context"]["memories"][0]["id"] == "memory-1"
    changed = copy.deepcopy(context)
    changed["dynamic"]["current_intent"] = "准备烹饪刚拿到的食物。"
    later, _ = assemble("body contract", [], "survive", {"parts": []}, [], [],
                        context_tokens=16000, reserved_output=500, host_context=changed)
    assert messages[0] == later[0]
    assert budget["total"] <= budget["limit"]
    assert "相关记忆" not in json.dumps(budget, ensure_ascii=False)


def test_optional_host_context_cannot_displace_the_entire_small_window():
    value = validate_host_context(profile())
    context = {"stable": value, "dynamic": {"memories": value["memories"] * 30}}
    messages, budget = assemble("body", [], "survive", {"parts": [{"key": "body", "text": "生命4/20"}]}, [], [],
                                context_tokens=5000, reserved_output=400, host_context=context)
    assert budget["total"] <= 5000
    assert "生命4/20" in messages[-1]["content"]


def test_escaped_payload_is_bounded_and_opt_out_removes_the_projection(tmp_path):
    value = profile()
    value["memories"] = [{"id": str(i), "source": "host_recall", "text": '"' * 1800} for i in range(6)]
    with pytest.raises(ValueError, match="payload_limit"):
        validate_host_context(value)
    state(tmp_path)
    port = HostContextPort(tmp_path, now=lambda: 10000)
    port.publish(profile(), session="12:view", revision=0)
    assert port.read(0)
    port.invalidate()
    assert port.read(0) is None
