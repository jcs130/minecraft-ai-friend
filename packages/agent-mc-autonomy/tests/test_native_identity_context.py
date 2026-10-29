"""Exercise the native identity fact consumed by host persona and game memory."""

import json
from datetime import datetime, timezone

import pytest

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.death_memory import identity, scope_key
from agent_mc_autonomy.host_context import HostContextPort


SCOPE = {"realm": '["server-a",["vanilla-world","minecraft:overworld"]]',
         "account": "offline:player-uuid", "agent": "player"}
WORLD = {"schema": "agent-mc-world-identity/v1", "key": "minecraft:overworld", "uuid": None,
         "instanceId": None, "dimensionType": "overworld", "source": "vanilla-login", "revision": 2,
         "observedAt": "2026-10-29T14:49:45.603Z"}


def facts(value):
    return {"parts": [{"key": "identity", "text": json.dumps(value)}]}


@pytest.mark.parametrize("extra", [{}, {"world": WORLD}, {"world": None}])
def test_native_world_metadata_projects_only_the_exact_scope_fields(extra):
    actual = identity(facts({**SCOPE, **extra}))
    assert actual == SCOPE and set(actual) == {"realm", "account", "agent"}
    # The stored scope contract does not become permissive.
    assert scope_key({**SCOPE, "world": WORLD}) is None


@pytest.mark.parametrize("value", [None, [], {"world": WORLD}, {**SCOPE, "realm": None},
                                      {**SCOPE, "account": ""}, {**SCOPE, "agent": 1},
                                      {**SCOPE, "role": "another-player"}])
def test_optional_world_cannot_repair_an_invalid_or_ambiguous_identity(value):
    assert identity(facts(value)) is None


def test_native_identity_allows_scoped_persona_into_actual_planner_context(tmp_path):
    now = 10000
    native = facts({**SCOPE, "world": WORLD})
    bound = identity(native)
    status = {"phase": "running", "game_connected": True, "game_identity": bound,
              "updated_at": datetime.fromtimestamp(now, timezone.utc).isoformat()}
    (tmp_path / "status.json").write_text(json.dumps(status), encoding="utf-8")
    port = HostContextPort(tmp_path, now=lambda: now)
    port.publish_static({"agent_name": "ExampleRole", "persona": "自称本喵，自然接住伙伴的话。",
                         "persona_source": "character_profile"}, scope=scope_key(bound))
    projected = port.read(0)
    assert projected and projected["stable"]["agent_name"] == "ExampleRole"
    messages, budget = assemble("body contract", [], "survive", native, [], [], context_tokens=16000,
                                reserved_output=1000, host_context=projected)
    assert "自称本喵" in messages[0]["content"] and budget["host_context"]["persona"] is True
    # World-aware realm changes remain separate; no legacy scope is silently migrated.
    status["game_identity"] = identity(facts({**SCOPE, "realm": "different-world", "world": WORLD}))
    (tmp_path / "status.json").write_text(json.dumps(status), encoding="utf-8")
    assert port.read(0) is None
