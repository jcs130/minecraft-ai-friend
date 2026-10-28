"""Current player capabilities must precede bulk optional world detail."""
import copy
import json

import pytest

from agent_mc_autonomy import context


@pytest.mark.parametrize("clutter_first", [True, False])
def test_compact_context_retains_current_rpg_state_and_capabilities(clutter_first):
    clutter = [{"key": f"optional-{i}", "text": "旧场景详情" * 90} for i in range(24)]
    required = [
        {"key": "body", "text": "Health 20/20; hunger 16/20"},
        {"key": "queue", "text": "No native work running"},
        {"key": "nativeRpg", "text": "Profession not selected; combat level 3; mana 20/20; balance 0",
         "original": "log:current-rpg"},
        {"key": "combatCapabilities", "text": "Observed skill starbolt, mana cost 4, cooldown 0; configured false",
         "original": "log:current-capabilities"},
    ]
    facts = {"parts": clutter + required if clutter_first else required + clutter}
    before = copy.deepcopy(facts)
    messages, budget = context.assemble("stable identity", [], "Continue playing", facts, [], [],
                                        context_tokens=7000, reserved_output=1024)
    tail = json.loads(messages[-1]["content"])
    actual = {row["key"]: row for row in tail["current_facts"]}
    assert {"body", "queue", "nativeRpg", "combatCapabilities"} <= actual.keys()
    assert actual["nativeRpg"]["original"] == "log:current-rpg"
    assert actual["combatCapabilities"]["text"] == required[-1]["text"]
    assert budget["omitted"] and budget["total"] <= 7000
    assert facts == before


def test_new_rpg_observation_replaces_old_state_without_making_unknowns_usable():
    facts = {"parts": [{"key": "nativeRpg", "text": "Old profession and mana"},
                       {"key": "nativeRpg", "text": "Profession unknown; mana null; balance null",
                        "original": "log:fresh"}]}
    messages, _ = context.assemble("stable", [], "Play", facts, [], [],
                                    context_tokens=9000, reserved_output=1024)
    rows = json.loads(messages[-1]["content"])["current_facts"]
    assert rows == [facts["parts"][-1]]
    assert "Old profession" not in json.dumps(messages)
