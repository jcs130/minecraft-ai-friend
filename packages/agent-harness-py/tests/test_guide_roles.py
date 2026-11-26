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


def test_untranslated_maid_name_cannot_block_other_partners():
    body = uuid4()
    auto = {"ownerId": str(uuid4()), "maidId": str(body), "name": "model.authors_and_credits.clocklalier.name", "autoEnroll": True}
    guide = claim()
    roles = parse_guide_roster({"protocol": "qiandengji-maid-body/v1", "maids": [auto, guide]}, "test", {"model": "fixture"})
    assert len(roles) == 2
    assert next(r for r in roles.values() if r.body_id == body).name == "女仆·" + body.hex[:6]


def test_existing_partner_keeps_her_body_scope_and_never_inherits_duplicate_guide_memory():
    owner, original, duplicate = (str(uuid4()) for _ in range(3))
    config = {"model": "fixture"}
    before = {"ownerId": owner, "maidId": original, "name": "沐白", "autoEnroll": True}
    old_guide = {"ownerId": owner, "maidId": duplicate, "name": "旧罗盘伙伴", "confirmed": True}
    protocol = {"protocol": "qiandengji-maid-body/v1"}
    original_role = next(iter(parse_guide_roster(protocol | {"maids": [before]}, "test", config).values()))
    old_role = next(iter(parse_guide_roster(roster(old_guide), "test", config).values()))
    retained = before | {"confirmed": True, "retainedBody": True}
    new_payload = protocol | {"onePartnerPerPlayer": True, "maids": [retained]}
    kept = next(iter(parse_guide_roster(new_payload, "test", config).values()))
    assert kept.id == original_role.id != old_role.id
    assert kept.character_id == original_role.character_id != old_role.character_id
    assert kept.name == "沐白" and kept.scope("test") == original_role.scope("test")
    with pytest.raises(ValueError, match="duplicate_player_partner"):
        parse_guide_roster(new_payload | {"maids": [retained, old_guide]}, "test", config)
    with pytest.raises(ValueError, match="retained_partner_identity_not_verified"):
        parse_guide_roster(new_payload | {"onePartnerPerPlayer": False}, "test", config)


def test_unadmitted_or_duplicate_maids_fail_closed():
    row = {"ownerId": str(uuid4()), "maidId": str(uuid4()), "name": "女仆", "autoEnroll": True}
    payload = {"protocol": "qiandengji-maid-body/v1", "maids": [row]}
    with pytest.raises(ValueError, match="not_admitted"):
        parse_guide_roster(payload | {"maids": [row | {"autoEnroll": False}]}, "test", {"model": "x"})
    with pytest.raises(ValueError, match="identity_conflict"):
        parse_guide_roster(payload | {"maids": [row, row | {"ownerId": str(uuid4())}]}, "test", {"model": "x"})
