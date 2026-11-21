from uuid import uuid4

import pytest

from agent_mc_harness.guide_roles import parse_guide_roster


def roster(*rows):
    return {"protocol": "qiandengji-maid-body/v1", "guides": list(rows)}


def claim():
    return {"ownerId": str(uuid4()), "maidId": str(uuid4()), "name": "小灯", "confirmed": True}


def test_guides_have_independent_identity_and_same_character_after_rename():
    first, second = claim(), claim()
    config = {"provider": "tokenplan", "model": "guide-test"}
    old = parse_guide_roster(roster(first, second), "test", config)
    one, other = old.values()
    renamed = parse_guide_roster(roster(first | {"name": "新名字"}), "test", config)[one.id]
    assert (renamed.character_id, renamed.body_id, renamed.scope("test")) == (
        one.character_id, one.body_id, one.scope("test"))
    assert renamed.name == "新名字"
    assert one.scope("test") != other.scope("test")
    assert "body:cast" in renamed.allowed_tools
    assert "body:command" not in renamed.allowed_tools


def test_provisional_and_conflicting_bindings_fail_closed():
    row = claim()
    config = {"model": "guide-test"}
    for invalid in (
        roster(row | {"confirmed": False}),
        roster(row | {"ownerId": row["maidId"]}),
        roster(row, row | {"maidId": str(uuid4())}),
        roster(row, row | {"ownerId": str(uuid4())}),
    ):
        with pytest.raises(ValueError, match="identity_conflict"):
            parse_guide_roster(invalid, "test", config)
