"""Actual native membership and desired companions must remain different evidence."""
import copy
import json

from test_social import NAMES, config

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.social import SocialInbox


def test_four_configured_companions_are_visible_without_inventing_native_membership(tmp_path):
    inbox = SocialInbox(tmp_path, config(), NAMES[0], clock=lambda: 1000)
    context = inbox.context()
    assert [row["name"] for row in context["configured_companions"]] == list(NAMES)
    assert sum(row["self"] for row in context["configured_companions"]) == 1
    assert context["native_party_membership"] == "unverified_until_native_roster_observed"
    assert not context["dialogue"] and not inbox.ready()
    assert "each other actor must accept its own matching invitation" in context["guidance"]


def test_native_four_member_party_facts_keep_priority_over_bulk_world_detail():
    party = {"type": "party", "partyId": "native-party-observed", "memberCount": 4,
             "members": [{"name": name} for name in NAMES], "phase": "assembling"}
    plan = {"type": "partyPlan", "requiredMembers": 4, "membershipConfirmed": True,
            "nextCommand": "/mycli guild party status", "nearbyHearingVerified": False}
    facts = {"parts": [{"key": "noise-" + str(i), "text": "场景细节" * 200} for i in range(30)] + [
        {"key": "body", "text": "health=20 hunger=20"},
        {"key": "nativeParty", "text": json.dumps(party), "original": "log:native-party"},
        {"key": "partyPlan", "text": json.dumps(plan), "original": "log:party-plan"}]}
    before = copy.deepcopy(facts)
    messages, budget = assemble("body", [], "Play together", facts, [], [], context_tokens=7000, reserved_output=1024)
    actual = {row["key"]: row for row in json.loads(messages[-1]["content"])["current_facts"]}
    assert actual["nativeParty"]["original"] == "log:native-party"
    assert json.loads(actual["nativeParty"]["text"])["memberCount"] == 4
    assert json.loads(actual["partyPlan"]["text"])["nearbyHearingVerified"] is False
    assert budget["omitted"] and facts == before
