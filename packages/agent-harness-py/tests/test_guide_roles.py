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


def test_every_admitted_maid_gets_a_stable_independent_brain():
    row = {"ownerId": str(uuid4()), "maidId": str(uuid4()), "name": "沐白", "autoEnroll": True}
    config = {"model": "maid-test"}
    payload = {"protocol": "qiandengji-maid-body/v1", "maids": [row], "guides": []}
    first = parse_guide_roster(payload, "test", config)
    role = next(iter(first.values()))
    renamed = parse_guide_roster(payload | {"maids": [row | {"name": "新名字"}]}, "test", config)
    updated = renamed[role.id]
    assert role.id.startswith("maid_")
    assert (updated.character_id, updated.body_id, updated.scope("test")) == (
        role.character_id, role.body_id, role.scope("test"))
    assert updated.name == "新名字"
    assert updated.activity_review_seconds == 90
    assert {"body:native:rendezvous", "body:native:schedule"}.issubset(updated.allowed_tools)


def test_unadmitted_or_duplicate_maids_fail_closed():
    row = {"ownerId": str(uuid4()), "maidId": str(uuid4()), "name": "女仆", "autoEnroll": True}
    payload = {"protocol": "qiandengji-maid-body/v1", "maids": [row]}
    with pytest.raises(ValueError, match="not_admitted"):
        parse_guide_roster(payload | {"maids": [row | {"autoEnroll": False}]}, "test", {"model": "x"})
    with pytest.raises(ValueError, match="identity_conflict"):
        parse_guide_roster(payload | {"maids": [row, row | {"ownerId": str(uuid4())}]}, "test", {"model": "x"})
