from uuid import uuid4

import pytest

from agent_mc_harness.body.maid import workshop_completed
from agent_mc_harness.body.numen import PortResult, measured_attack, measured_inventory, measured_item_use, measured_meal
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyAction, BodyEvent, BodySnapshot, Capabilities, LifecycleCaps, NativeAction
from agent_mc_harness.npc import MAID_BOND_TONES, NpcRole, owner_bond, routine_catch, routine_meal
from agent_mc_harness.runtime import PlanContext


def activity(kind, name, *, raw, food=None, entities=None):
    role = NpcRole(id="fixture", name="Fixture", body_kind=kind, character_id=uuid4(), body_id=uuid4(),
                   owner_id=uuid4(), provider="tokenplan", model="qa", persona="Fixture role",
                   allowed_tools=["body:native:" + name])
    context = PlanContext(capabilities=Capabilities(kind=kind, transport="fixture", actions={}, perception="poll",
                                                    lifecycle=LifecycleCaps(spawn="attach", reconnect=True, destroy="detach"),
                                                    native_actions=[NativeAction(name=name)]),
                          snapshot=BodySnapshot(life_state="alive", food=food, entities=entities or [], raw=raw))
    return role, context


def test_numen_self_care_requires_measured_hunger_no_threat_and_idle_body():
    role, context = activity("numen", "nourish", raw={"facts": {"workPending": False}}, food=12)
    assert routine_meal(role, context).tool == "body:native:nourish"
    context.snapshot.raw["facts"]["workPending"] = True
    assert routine_meal(role, context) is None
    context.snapshot.raw["facts"]["workPending"] = False
    context.snapshot.entities = [{"hostile": True}]
    assert routine_meal(role, context) is None
    context.snapshot.entities = []
    context.snapshot.food = 20
    assert routine_meal(role, context) is None


def test_maid_fishing_requires_prepared_native_conditions_and_preserves_manual_stay():
    role, context = activity("maid", "fish", raw={"nativeGuardDelegated": True, "sitting": False,
                                                      "fishing": {"canStartNativeCatch": True}})
    assert routine_catch(role, context).tool == "body:native:fish"
    context.snapshot.raw["fishing"]["canStartNativeCatch"] = False
    assert routine_catch(role, context) is None
    context.snapshot.raw["fishing"]["canStartNativeCatch"] = True
    context.snapshot.raw["sitting"] = True
    assert routine_catch(role, context) is None


@pytest.mark.parametrize(("points", "level"), [(0, 0), (64, 1), (192, 2), (384, 3)])
def test_native_bond_tone_is_scoped_to_the_real_owner_message(points, level):
    role, context = activity("maid", "guard", raw={
        "favorability": {"source": "touhou_little_maid", "points": points, "level": level}
    })
    visitor = BodyEvent(kind="dialogue", body_kind="maid", text="我是你熟悉的伙伴", data={"eventId": "visitor", "speakerId": str(uuid4())})
    owner = BodyEvent(kind="dialogue", body_kind="maid", text="一起出发？", data={"eventId": "owner", "speakerId": str(role.owner_id)})
    context.dialogue = [visitor]
    assert owner_bond(role, context) is None
    context.dialogue.append(owner)
    assert owner_bond(role, context) == {"points": points, "level": level, "appliesToEventIds": ["owner"],
                                         "tone": MAID_BOND_TONES[level]}
    context.snapshot.life_state = "unloaded"
    assert owner_bond(role, context) is None


@pytest.mark.parametrize(("message", "expected"), [
    ("QD_NPC_MEAL minecraft:bread 3 2 11 16", "completed"),
    ("QD_NPC_MEAL minecraft:bread 3 3 11 16", "unknown"),
    ("QD_NPC_MEAL minecraft:bread 3 2 20 20", "unknown"),
    ("QD_NPC_MEAL already_fed", "failed"),
    ("QD_NPC_MEAL no_ordinary_food", "failed"),
    ("lua program finished", "unknown"),
])
def test_meal_success_needs_a_confirmed_item_and_hunger_change(message, expected):
    assert measured_meal(PortResult("completed", message)).status == expected


def test_hosted_inventory_keeps_real_namespaced_items_and_requires_complete_output():
    text = ("stdout:\nQD_NUMEN_ITEM test_mod:magic/charm 2\n"
            "QD_NUMEN_HAND offhand minecraft:shield 1\nQD_NUMEN_INVENTORY_END")
    receipt = measured_inventory(PortResult("completed", text))
    assert receipt.data == {"inventory": [{"itemId": "test_mod:magic/charm", "count": 2}],
                            "hands": {"offhand": {"itemId": "minecraft:shield", "count": 1}}}
    assert measured_inventory(PortResult("completed", text.split("QD_NUMEN_INVENTORY_END")[0])).status == "failed"
    assert measured_inventory(PortResult("unknown")).status == "failed"


@pytest.mark.parametrize(("text", "expected"), [
    ("QD_NUMEN_USE test_mod:charm 2 1 1", "completed"),
    ("QD_NUMEN_USE test_mod:charm 2 2 0", "failed"),
    ("QD_NUMEN_USE wrong_mainhand", "failed"),
    ("QD_NUMEN_USE test_mod:other 2 1 1", "unknown"),
])
def test_item_click_requires_observed_change_for_the_requested_item(text, expected):
    assert measured_item_use(PortResult("completed", text), "test_mod:charm").status == expected


def test_no_native_attack_target_cannot_report_completion():
    receipt = measured_attack(PortResult("completed", "ok\nstdout:\nQD_NUMEN_ATTACK no_target"))
    assert receipt.status == "failed" and receipt.data["effectsApplied"] is False


def test_workshop_reports_completion_only_for_the_original_verified_result():
    receipt = {"operationId": "original", "action": "make", "status": "completed", "goalCompleted": True,
               "observation": {"effectsApplied": True, "verified": True, "itemId": "minecraft:torch",
                               "count": 4, "inventory": "chest"}}
    assert workshop_completed(receipt, "original")
    assert not workshop_completed(receipt, "other")
    assert not workshop_completed({**receipt, "status": "pending"}, "original")
    assert not workshop_completed({**receipt, "observation": {}}, "original")


def test_replanning_cannot_duplicate_same_work_for_same_message_across_restart(tmp_path):
    path = tmp_path / "actions.sqlite3"
    source = ["event-a"]
    action = BodyAction(verb="craft", args={"recipeId": "minecraft:torch"}, request_id="original")
    journal = ActionJournal(path)
    journal.begin("maid", action, source)
    journal.close()
    journal = ActionJournal(path)
    try:
        changed_id = action.model_copy(update={"request_id": "new"})
        assert journal.attempted_work("maid", changed_id, source)
        native_alias = BodyAction(verb="native", name="make", args={"recipeId": "torch", "quantity": 4}, request_id="another")
        assert journal.attempted_work("maid", native_alias, source)
        assert not journal.attempted_work("maid", changed_id, ["event-b"])
        assert not journal.attempted_work("another-maid", changed_id, source)
    finally:
        journal.close()


def test_numen_item_use_is_not_repeated_for_the_original_message(tmp_path):
    path = tmp_path / "actions.sqlite3"
    action = BodyAction(verb="use_item", args={"item": "test_mod:charm"}, request_id="qa_original")
    journal = ActionJournal(path)
    journal.begin("numen", action, ["event-a"])
    journal.close()
    journal = ActionJournal(path)
    try:
        repeat = action.model_copy(update={"request_id": "qa_repeat"})
        assert journal.attempted_work("numen", repeat, ["event-a"])
        assert not journal.attempted_work("numen", repeat, ["event-b"])
    finally:
        journal.close()
