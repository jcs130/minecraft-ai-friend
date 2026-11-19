import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from agent_mc_harness.npc_service import external_handoff


def test_external_handoff_is_scoped_and_expires(tmp_path):
    role = SimpleNamespace(body_kind="maid", body_id=uuid4(), owner_id=uuid4())
    marker = tmp_path / "handoff.json"
    cfg = {"externalHandoffFile": str(marker)}
    assert not external_handoff(role, cfg, now=100)
    valid = {"bodyId": str(role.body_id), "ownerId": str(role.owner_id), "until": 232}
    for changes, expected in [
        ({}, True), ({"bodyId": str(uuid4())}, False), ({"ownerId": str(uuid4())}, False),
        ({"until": 100}, False), ({"until": 281}, False), ({"until": "232"}, False),
    ]:
        marker.write_text(json.dumps(valid | changes))
        assert external_handoff(role, cfg, now=100) is expected
    marker.write_text(json.dumps(valid))
    assert not external_handoff(role, cfg, now=233)
    assert not external_handoff(role, {}, now=100)
    role.body_kind = "numen"
    assert not external_handoff(role, cfg, now=100)


def test_incomplete_handoff_never_opens_a_second_controller(tmp_path):
    role = SimpleNamespace(body_kind="maid", body_id=uuid4(), owner_id=uuid4())
    marker = tmp_path / "handoff.json"
    for content in ("bad", "[]", "{}", "null"):
        marker.write_text(content)
        assert not external_handoff(role, {"externalHandoffFile": str(marker)})
    with pytest.raises(ValueError, match="absolute"):
        external_handoff(role, {"externalHandoffFile": "relative"})
