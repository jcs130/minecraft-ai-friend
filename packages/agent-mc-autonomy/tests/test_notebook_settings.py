import pytest

from agent_mc_autonomy.configuration import Settings

BASE = {"server": {"host": "fixture.test", "username": "Alice"}}


def test_local_vector_retrieval_requires_no_service_or_credential_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("MC_MEMORY_KEY", "fixture-unused-key")
    settings = Settings.parse({**BASE, "memory": {"mode": "local-vector", "api_key_env": "MC_MEMORY_KEY"}})
    world = settings.client_config(tmp_path)["world"]
    assert world["memory"]["mode"] == "local-vector"
    assert settings.memory.environment() == {}
    assert not world["memory"]["endpoint"]
    assert not world["memory"]["model"]
    assert world["memory"]["learningEnabled"] is False
    assert settings.enabled is False


def test_optional_note_owner_does_not_move_existing_account_or_change_default_namespace(tmp_path):
    original = Settings.parse(BASE)
    default_world = original.client_config(tmp_path)["world"]
    assert "memoryAgentId" not in default_world
    assert "agent_id" not in default_world["memory"]
    selected = Settings.parse({**BASE, "memory": {"mode": "local-vector", "agent_id": "stable-game-role"}})
    world = selected.client_config(tmp_path)["world"]
    assert world["memoryAgentId"] == "stable-game-role"
    assert "agent_id" not in world["memory"]
    assert selected.identity == original.identity
    assert selected.client_config(tmp_path)["dataDir"] == original.client_config(tmp_path)["dataDir"]


@pytest.mark.parametrize("value", [None, True, "a" * 161, " spaced", "line\nbreak", "delete\x7f", "😀" * 81, "\ud800"])
def test_invalid_stable_note_owner_is_rejected(value):
    with pytest.raises(ValueError):
        Settings.parse({"memory": {"agent_id": value}})


def test_stable_note_owner_matches_core_unicode_length_boundary(tmp_path):
    value = "😀" * 80
    settings = Settings.parse({**BASE, "memory": {"agent_id": value}})
    assert settings.client_config(tmp_path)["world"]["memoryAgentId"] == value


@pytest.mark.parametrize("value", [True, False])
def test_explicit_mineral_query_policy_is_forwarded_without_changing_account(tmp_path, value):
    original = Settings.parse(BASE)
    selected = Settings.parse({**BASE, "perception": {"enabled": False, "mineral_vision": value}})
    assert selected.client_config(tmp_path)["world"]["perception"] == {"mineralVision": value}
    assert selected.client_config(tmp_path)["acceptsImages"] is False
    assert original.client_config(tmp_path)["world"]["perception"] == {"mineralVision": False}
    assert selected.identity == original.identity
    assert selected.enabled is False


@pytest.mark.parametrize("value", [None, "true", 1, []])
def test_mineral_query_policy_rejects_truthy_nonbooleans(value):
    with pytest.raises(ValueError):
        Settings.parse({"perception": {"mineral_vision": value}})


def test_local_vector_cannot_enable_remote_service_learning():
    with pytest.raises(ValueError):
        Settings.parse({"memory": {"mode": "local-vector", "learning_enabled": True}})
