import dataclasses
import hashlib
import json

import pytest

from agent_mc_autonomy.agent_store import AgentSettings, AgentStore, canonical, tools
from agent_mc_autonomy.configuration import Settings


PROFILE = AgentSettings.parse({"owner_id": "owner", "id": "character-1", "name": "新旅人", "persona": "好奇、乐于助人。"})


def test_same_character_across_restart_models_and_harnesses(tmp_path):
    first = AgentStore(tmp_path, PROFILE, "world-account")
    binding = first.configure()
    note = first.invoke("agent_remember", {"text": "我答应过小鱼修一座桥。"}, "request-1")
    second = AgentStore(tmp_path, PROFILE, "world-account")
    assert second.configure() == binding
    result = second.invoke("agent_recall", {"query": "小鱼"}, "read-1")
    assert result["records"][0]["id"] == note["id"]
    assert result["current_world_verified"] is False
    assert first.invoke("agent_remember", {"text": "我答应过小鱼修一座桥。"}, "request-1")["id"] == note["id"]
    with pytest.raises(ValueError, match="conflict"):
        first.invoke("agent_remember", {"text": "different"}, "request-1")


def test_owner_agent_and_world_scopes_do_not_mix(tmp_path):
    original = AgentStore(tmp_path, PROFILE, "world-a")
    original.configure()
    ident = original.invoke("agent_remember", {"text": "private memory"}, "write")["id"]
    for profile, scope in [(PROFILE, "world-b"), (dataclasses.replace(PROFILE, owner_id="other"), "world-a"),
                            (dataclasses.replace(PROFILE, id="other"), "world-a")]:
        other = AgentStore(tmp_path, profile, scope)
        other.configure()
        assert not other.invoke("agent_recall", {"query": "private"}, "read")["records"]
        assert other.invoke("agent_recall", {"id": ident}, "read")["found"] is False


def test_persona_revision_preserves_episodes_and_vendor_state_is_not_imported(tmp_path):
    store = AgentStore(tmp_path, PROFILE, "world")
    store.configure()
    exchange = [{"role": "assistant", "content": "建桥", "_provider_state": {"secret": "vendor-opaque"}},
                {"role": "tool", "tool_call_id": "real", "content": "bridge not finished"}]
    record = store.record_exchange("turn-1", exchange)
    assert store.record_exchange("turn-1", exchange) == record
    changed = AgentStore(tmp_path, dataclasses.replace(PROFILE, persona="喜欢钓鱼。"), "world")
    assert changed.configure()["revision"] == 2
    content = changed.invoke("agent_recall", {"id": record}, "read")["text"]
    assert "bridge not finished" in content and "vendor-opaque" not in content
    assert '"game_goal_verified":false' in content
    path = tmp_path / "character.json"
    result = changed.export(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    assert result["profiles"] == 2 and result["records"] == 1
    assert data["sha256"] == hashlib.sha256(canonical(data["data"]).encode()).hexdigest()
    with pytest.raises(FileExistsError):
        changed.export(path)


def test_memory_page_is_bounded_not_a_full_history_dump(tmp_path):
    store = AgentStore(tmp_path, PROFILE, "world")
    store.configure()
    ident = store.append("episode", "test", {"text": "字" * 5000}, "request")
    page = store.invoke("agent_recall", {"id": ident}, "read")
    assert len(page["text"]) == 2000 and page["has_more"]
    next_page = store.invoke("agent_recall", {"id": ident, "offset": page["next_offset"]}, "read")
    assert next_page["text"] and next_page["next_offset"] > page["next_offset"]


@pytest.mark.parametrize("value", [{"id": "../other", "owner_id": "a", "name": "a", "persona": "a"},
    {"id": "only-id"}, {"owner_id": "a", "id": "b", "name": "a", "persona": "x" * 2001}, {"api_key": "private"}])
def test_invalid_profile_cannot_choose_paths_or_credentials(value):
    with pytest.raises(ValueError):
        AgentSettings.parse(value)


def test_optional_profile_does_not_change_legacy_account_or_notebook_identity():
    base = {"server": {"host": "server.test", "username": "Account"}}
    plain = Settings.parse(base)
    role = Settings.parse({**base, "agent": dataclasses.asdict(PROFILE)})
    assert role.identity == plain.identity and not plain.agent.id
    assert {t["name"] for t in tools()} == {"agent_recall", "agent_remember"}


def test_private_journal_uses_coordinator_validation_and_never_calls_game(tmp_path, run_async):
    from agent_mc_autonomy.controller import Controller, ModelCallRejected
    from test_controller import Bridge
    store = AgentStore(tmp_path, PROFILE, "world")
    store.configure()
    bridge = Bridge()
    controller = Controller(bridge, None, Settings(), tmp_path, lambda **_: None, lambda: False, character=store)
    async def exercise():
        written, _ = await controller.dispatch("agent_remember", {"text": "我在这里交到了朋友。"}, "note-id")
        assert json.loads(written["text"])["saved"]
        result, _ = await controller.dispatch("agent_recall", {"query": "朋友"}, "read-id")
        assert json.loads(result["text"])["records"]
        failed, _ = await controller.dispatch("agent_remember", {"text": "", "owner_id": "other"}, "bad-id")
        assert failed["failed"]
        assert bridge.calls == [] and controller.inflight_request is None
    run_async(exercise())
