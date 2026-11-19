from types import SimpleNamespace

import pytest

from agent_mc_harness.body import adventure, loadout
from agent_mc_harness.body.base import ArgumentError
from agent_mc_harness.body.numen import PortResult


NOW = 1_900_000_000
PEER = "LifePeerQA"


def record(tag, value, at=NOW, **extra):
    return {"at": at, "records": [{"type": tag, "value": value}], **extra}


@pytest.fixture
def attempt(monkeypatch):
    monkeypatch.setattr(adventure, "time", lambda: NOW)
    roster = record("MC_RPG", {"phase": "awaiting_teammates", "inParty": True, "memberCount": 1,
                               "leaderUuid": "self", "selfUuid": "self"})
    invitation = record("MC_RPG", {"type": "party", "success": True}, NOW-20, peer=PEER, effect="confirmed")
    facts = {"participant": False, "reason": "equipment_missing", "worldKey": "minecraft:overworld",
             "entrance": {"x": 10, "y": 70, "z": 12}, "missingEquipment": ["头盔"],
             "outing": {"ruin": {"id": "new_ruin", "name": "新遗迹"}}}
    body = SimpleNamespace(position={"x": 400, "y": 70, "z": 12}, dimension="minecraft:overworld", life_state="alive")
    return dict(roster=roster, invitation=invitation, creation={}, trial=record("MC_TRIAL_STATE", facts),
                travel={}, peer=PEER, snapshot=body)


def test_inviter_can_visit_a_public_place_while_unequipped(attempt):
    suggestion = adventure.public_outing(**attempt)
    assert suggestion["next"] == "travel_trial"
    assert suggestion["partnerAttendance"] == "unconfirmed"
    assert suggestion["missingArmor"] == ["head"]
    attempt["travel"] = {"at": NOW, "effect": "dispatched"}
    assert adventure.public_outing(**attempt)["next"] != "travel_trial"


@pytest.mark.parametrize("change", ["expired", "unconfirmed", "different_recipient", "new_party", "not_leader",
                                    "old_roster", "multiple_members", "in_combat", "dead"])
def test_stale_or_unrelated_actions_do_not_claim_a_rendezvous(attempt, change):
    invitation = attempt["invitation"]
    party = attempt["roster"]["records"][0]["value"]
    if change == "expired":
        invitation["at"] = NOW-adventure.INVITE_INTERVAL
    elif change == "unconfirmed":
        invitation["effect"] = "dispatched"
    elif change == "different_recipient":
        invitation["peer"] = "Other"
    elif change == "new_party":
        attempt["creation"] = {"at": NOW}
    elif change == "not_leader":
        party["leaderUuid"] = "other"
    elif change == "old_roster":
        attempt["roster"]["at"] = NOW-100
    elif change == "multiple_members":
        party["memberCount"] = 2
    elif change == "in_combat":
        attempt["trial"]["records"][0]["value"]["participant"] = True
    elif change == "dead":
        attempt["snapshot"].life_state = "dead"
    assert adventure.public_outing(**attempt) is None


def test_previous_release_receipt_and_resampling(attempt):
    invitation = attempt["invitation"]
    del invitation["peer"]
    invitation["records"][0]["value"]["message"] = f"已向 {PEER} 发送邀请，等待接受"
    attempt["trial"]["at"] = NOW-200
    assert adventure.public_outing(**attempt)["next"] == "trial"


@pytest.mark.parametrize(("state", "missing", "expected"), [
    ("requirements", ["头盔"], "prepare_armor"),
    ("requirements", ["另一件可用远程武器（弓弩＋弹药）"], "check_ranged_loadout"),
    ("travel", [], "travel_ruin"), ("ready", [], "start_ruin"), ("approach", [], "survey_then_walk"),
    ("cooldown", [], "ruin_status"),
])
def test_lobby_offer_uses_the_selected_sites_observed_state(attempt, state, missing, expected):
    attempt["snapshot"].position["x"] = 10
    offer = adventure.public_outing(**attempt)
    assert offer["next"] == "ruin_info" and offer["siteId"] == "new_ruin"
    info = record("MC_SITE_DUNGEON_INFO", {"id": "new_ruin", "guidance": {"state": state,
                  "reason": "EQUIPMENT_REQUIRED" if missing else "", "missingEquipment": missing}},
                  kind="ruin_info", effect="read", id="new_ruin")
    adventure.continue_outing(offer, [{"adventure": {**info, "id": "somewhere_else"}}])
    assert offer["next"] == "ruin_info"
    adventure.continue_outing(offer, [{"adventure": info}])
    assert offer["next"] == expected


def test_earlier_travel_to_this_ruin_is_checked_before_retry(attempt):
    attempt["snapshot"].position["x"] = 10
    offer = adventure.public_outing(**attempt)
    adventure.continue_outing(offer, [{"adventure": {"kind": "travel_ruin", "id": "new_ruin", "at": NOW}}])
    assert offer["next"] == "ruin_status"


def test_pending_landing_requires_observation_and_the_gate_requires_walking(attempt):
    result = adventure.game_result(PortResult("completed", "stdout:\nMC_TRAVEL target=arena status=pending reason=loading"),
                                   adventure.ACT, {"kind": "travel_trial"})
    assert result.data["adventure"]["effect"] == "awaiting_arrival" and not result.data["adventure"]["retryWrite"]
    attempt["travel"] = {**result.data["adventure"], "at": NOW-3}
    attempt["trial"]["at"] = NOW-5
    assert adventure.public_outing(**attempt)["next"] == "trial"
    attempt["trial"]["at"] = NOW
    attempt["snapshot"].position["x"] = 20
    landing = {"world": "world", "x": 10, "y": 70, "z": 12}
    attempt["trial"]["records"][0]["value"]["walkTarget"] = landing
    offer = adventure.public_outing(**attempt)
    assert offer["next"] == "walk_to_platform" and offer["walkTarget"] == landing
    attempt["snapshot"].position["x"] = 11
    assert adventure.public_outing(**attempt)["next"] == "trial"


def test_ammo_is_an_advertised_separate_action_with_an_explicit_purchase_flag():
    options = adventure.catalogue(PEER)[2].input_schema["properties"]["kind"]["enum"]
    assert "prepare_ammo" in options
    with pytest.raises(ArgumentError):
        loadout.ammo_lua("true", "QaKirito")
    with pytest.raises(ArgumentError):
        loadout.armor_lua("ammo", True, "QaKirito")
    for phase, status, ready in [("purchased_to_queue", "completed", False), ("ready", "completed", True),
                                 ("payment_unconfirmed", "unknown", False), ("bow_required", "rejected", False)]:
        r = loadout.armor_result(PortResult("completed", f"stdout:\nQD_ARMOR {phase} ammo arrows"), "ammo", recovered=True)
        assert r.status == status and r.data["adventure"]["ready"] == ready
        assert r.data["adventure"]["kind"] == "prepare_ammo" and r.data["adventure"]["at"] == 0

