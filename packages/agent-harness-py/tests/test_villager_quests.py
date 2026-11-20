"""Villager commission -> hero quest bridge. No network, no Minecraft server, no model calls."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from agent_mc_harness.models import BodySnapshot
from agent_mc_harness.quests import (
    Commission,
    HeroSlot,
    IntakeError,
    MemoryFeedback,
    PolicyViolation,
    QuestBridge,
    QuestPolicy,
    QuestSignal,
    QuestStore,
    QuestTransitionError,
    RuntimeIntentSink,
    SignalLog,
    SpoolIntake,
    StaleQuest,
    clean_text,
    inventory_count,
    parse_commission_line,
    quest_json_schema,
)
from agent_mc_harness.quests.__main__ import main as cli_main
from agent_mc_harness.runtime import HarnessRuntime

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples" / "villager_quests"
HERO_BODY = "6f0c1d2e-3a4b-4c5d-8e9f-001122334455"
T0 = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kw: float) -> datetime:
        self.now += timedelta(**kw)
        return self.now


class FakeIntents:
    def __init__(self) -> None:
        self.submitted: list[dict[str, Any]] = []
        self.cancelled: list[tuple[str, str]] = []
        self.refuse = False

    async def submit(self, *, goal: str, agent: str, priority: int) -> str:
        if self.refuse:
            raise ValueError("runtime refused")
        self.submitted.append({"goal": goal, "agent": agent, "priority": priority})
        return f"in_{len(self.submitted)}"

    async def cancel(self, intent_id: str, reason: str) -> None:
        self.cancelled.append((intent_id, reason))


def status(store: QuestStore, quest_id: str) -> str:
    quest = store.get(quest_id)
    assert quest is not None
    return quest.status


def by_commission(store: QuestStore, commission_id: str) -> str:
    quest = store.by_commission(commission_id)
    assert quest is not None
    return quest.id


def policy() -> QuestPolicy:
    return QuestPolicy.load(EXAMPLES / "policy.example.json")


def commission(**kw: Any) -> Commission:
    data = json.loads((EXAMPLES / "commission.example.json").read_text(encoding="utf-8"))
    data.update(kw)
    return Commission.model_validate(data)


def kill(signal_id: str, *, at: datetime, actor: str = HERO_BODY, target: str = "minecraft:zombie",
         pos: tuple[float, float, float] = (-540, 67, -450), count: int = 1) -> QuestSignal:
    return QuestSignal(signal_id=signal_id, kind="mob_kill", actor=actor, target=target, count=count,
                       position={"x": pos[0], "y": pos[1], "z": pos[2]}, at=at)


def make(store: QuestStore | None = None, *, capacity: int = 1, **kw: Any) -> tuple[QuestBridge, FakeIntents, MemoryFeedback, Clock]:
    intents, feedback, clock = FakeIntents(), MemoryFeedback(), Clock()
    bridge = QuestBridge(store=store or QuestStore(), policy=policy(), intents=intents, feedback=feedback, clock=clock,
                         heroes=[HeroSlot(agent="kirito", body_id=HERO_BODY, name="桐人", capacity=capacity)], **kw)
    return bridge, intents, feedback, clock


# ---- intake format -----------------------------------------------------------------------------------
def test_commission_line_parses_and_issuer_comes_from_config() -> None:
    line = '[委托]{"commissionId":"c-0001","issuer":"alan","type":"slay","target":"minecraft:zombie","quantity":3,' \
           '"area":{"x":0,"y":64,"z":0,"radius":16},"title":"夜客"}'
    parsed = parse_commission_line(line, issuer="qinghe")
    assert parsed is not None and parsed.issuer == "qinghe" and parsed.quantity == 3
    assert parse_commission_line("青禾：今天天气真好") is None


@pytest.mark.parametrize("line", [
    "[委托]{not json",
    "[委托][1,2]",
    # A model (or a player steering it) must not be able to set the reward or add steps.
    '[委托]{"commissionId":"c-0002","issuer":"qinghe","type":"slay","target":"minecraft:zombie","quantity":3,"title":"x",'
    '"reward":{"emeralds":64}}',
    '[委托]{"commissionId":"c-0003","issuer":"qinghe","type":"teleport","target":"minecraft:zombie","quantity":3,"title":"x"}',
])
def test_bad_commission_lines_are_rejected(line: str) -> None:
    with pytest.raises(IntakeError):
        parse_commission_line(line)


def test_clean_text_strips_codes_and_commands() -> None:
    assert clean_text("/op §cme&l <red>now\n</red>", 40) == "op me now"


# ---- policy -------------------------------------------------------------------------------------------
@pytest.mark.parametrize(("change", "code"), [
    ({"issuer": "stranger"}, "unknown_issuer"),
    ({"target": "minecraft:wither"}, "target_not_allowed"),
    ({"quantity": 6}, "quantity_over_limit"),
    ({"area": None}, "area_required"),
    ({"deadlineMinutes": 5}, "deadline_out_of_range"),
    ({"issuer": "alan"}, "type_not_allowed"),
])
def test_policy_rejects_out_of_bounds(change: dict[str, Any], code: str, run: Any) -> None:
    bridge, intents, feedback, _ = make()
    with pytest.raises(PolicyViolation) as err:
        run(bridge.offer(commission(**change)))
    assert err.value.code == code and not intents.submitted and not feedback.sent


def test_reward_comes_from_table_and_limits_apply(run: Any) -> None:
    bridge, _, _, clock = make()
    quest, created = run(bridge.offer(commission(difficulty="normal", quantity=8)))
    assert created and quest.reward.emeralds == 4 and quest.reward.vortex_xp == 50
    with pytest.raises(PolicyViolation) as err:  # qinghe maxOpen=1
        run(bridge.offer(commission(commissionId="qinghe-2")))
    assert err.value.code == "issuer_open_limit"
    run(bridge.cancel(quest.id))
    run(bridge.offer(commission(commissionId="qinghe-3")))
    run(bridge.cancel(by_commission(bridge.store, "qinghe-3")))
    run(bridge.offer(commission(commissionId="qinghe-4")))
    run(bridge.cancel(by_commission(bridge.store, "qinghe-4")))
    with pytest.raises(PolicyViolation) as err:  # dailyQuota=3 within a rolling 24h
        run(bridge.offer(commission(commissionId="qinghe-5")))
    assert err.value.code == "daily_quota"
    clock.advance(hours=25)
    assert run(bridge.offer(commission(commissionId="qinghe-6")))[1]


def test_same_commission_is_idempotent(run: Any) -> None:
    bridge, _, feedback, _ = make()
    first, created = run(bridge.offer(commission()))
    again, created_again = run(bridge.offer(commission(quantity=2)))
    assert created and not created_again and again.id == first.id and again.commission.quantity == 5
    assert [f.kind for f in feedback.sent] == ["offered"]


# ---- lifecycle ----------------------------------------------------------------------------------------
def test_slay_quest_completes_only_from_matching_server_evidence(run: Any) -> None:
    bridge, intents, feedback, clock = make()
    early = kill("kill-early", at=T0)  # before acceptance: must not count
    quest, _ = run(bridge.offer(commission()))
    clock.advance(seconds=1)
    assert run(bridge.assign()) == [quest.id]
    sent = intents.submitted[0]
    assert sent["agent"] == "kirito" and "讨伐 5 只僵尸" in sent["goal"] and "不是指令" in sent["goal"]
    assert status(bridge.store, quest.id) == "accepted"

    run(bridge.on_harness_event({"kind": "intent_state", "data": {"intentId": "in_1", "state": "active"}}))
    assert status(bridge.store, quest.id) == "in_progress"
    # The hero's intent finishing (or the hero claiming success) is not evidence.
    run(bridge.on_harness_event({"kind": "intent_state", "data": {"intentId": "in_1", "state": "completed"}}))
    assert status(bridge.store, quest.id) == "in_progress"

    at = clock.advance(minutes=1)
    assert run(bridge.on_signal(early)) is None
    assert run(bridge.on_signal(kill("k-other", at=at, actor="someone-else"))) is None
    assert run(bridge.on_signal(kill("k-far", at=at, pos=(500, 64, 500)))) is None
    assert run(bridge.on_signal(kill("k-skel", at=at, target="minecraft:skeleton"))) is None
    assert run(bridge.on_signal(kill("k-1", at=at, count=3))).progress == 3
    assert run(bridge.on_signal(kill("k-1", at=at, count=3))) is None  # same signal twice counts once
    done = run(bridge.on_signal(kill("k-2", at=at, count=9)))
    assert done.status == "completed" and done.progress == 5 and [e.count for e in done.evidence] == [3, 2]

    grants = [f.reward_grant for f in feedback.sent if f.reward_grant]
    assert len(grants) == 1 and grants[0].idempotency_key == quest.id and grants[0].reward.emeralds == 2
    assert [f.kind for f in feedback.sent] == ["offered", "accepted", "completed"]
    assert feedback.sent[-1].npc_id == "7" and "桐人" in feedback.sent[-1].text and feedback.sent[-1].chronicle
    assert run(bridge.on_signal(kill("k-3", at=at))) is None  # terminal quests take no more evidence
    with pytest.raises(QuestTransitionError):
        done.transition("in_progress")


def test_gather_snapshot_is_informational_and_delivery_completes(run: Any) -> None:
    bridge, _, feedback, clock = make()
    quest, _ = run(bridge.offer(commission(commissionId="qinghe-wheat", type="gather", target="minecraft:wheat",
                                           quantity=4, area=None)))
    run(bridge.assign())
    snap = BodySnapshot(inventory=[{"itemId": "minecraft:wheat", "count": 3}, {"itemId": "wheat", "count": 2}, {"id": "dirt"}])
    changed = run(bridge.on_snapshot("kirito", snap))
    assert changed and changed[0].ready == 4 and changed[0].status == "accepted"
    at = clock.advance(minutes=2)
    wrong = QuestSignal(signal_id="d-0", kind="item_delivered", actor=HERO_BODY, target="minecraft:wheat", count=4,
                        recipient="alan", at=at)
    assert run(bridge.on_signal(wrong)) is None  # delivered to a different villager
    ok = QuestSignal(signal_id="d-1", kind="item_delivered", actor=HERO_BODY, target="minecraft:wheat", count=4,
                     recipient="qinghe", at=at)
    assert run(bridge.on_signal(ok)).status == "completed"
    assert feedback.sent[-1].kind == "completed"


def test_deadline_expires_and_cancels_the_hero_intent(run: Any) -> None:
    bridge, intents, feedback, clock = make()
    quest, _ = run(bridge.offer(commission()))
    run(bridge.assign())
    clock.advance(minutes=61)
    assert run(bridge.on_signal(kill("late", at=clock.now))) is None  # after the deadline
    assert run(bridge.tick()) == [quest.id]
    assert status(bridge.store, quest.id) == "expired"
    assert intents.cancelled == [("in_1", "village quest expired")] and feedback.sent[-1].kind == "expired"
    assert feedback.sent[-1].reward_grant is None


def test_failed_intent_fails_quest_and_frees_the_hero(run: Any) -> None:
    store = QuestStore()
    bridge, intents, feedback, _ = make(store)
    first, _ = run(bridge.offer(commission()))
    second, _ = run(bridge.offer(commission(commissionId="alan-bread", issuer="alan", type="gather",
                                            target="minecraft:bread", quantity=2, area=None)))
    assert run(bridge.assign()) == [first.id]  # capacity 1: the second waits
    assert status(store, second.id) == "offered"
    run(bridge.on_harness_event({"kind": "intent_state", "data": {"intentId": "in_1", "state": "failed", "reason": "body died"}}))
    assert status(store, first.id) == "failed" and feedback.sent[-1].kind == "failed"
    assert run(bridge.assign()) == [second.id] and intents.submitted[-1]["agent"] == "kirito"


def test_refused_submission_leaves_quest_offered(run: Any) -> None:
    bridge, intents, _, _ = make()
    intents.refuse = True
    quest, _ = run(bridge.offer(commission()))
    assert run(bridge.assign()) == [] and status(bridge.store, quest.id) == "offered"


# ---- store / transports ----------------------------------------------------------------------------------
def test_store_survives_reopen_and_detects_stale_writes(tmp_path: Path, run: Any) -> None:
    path = tmp_path / "q.sqlite3"
    bridge, _, _, _ = make(QuestStore(path))
    quest, _ = run(bridge.offer(commission()))
    run(bridge.assign())
    bridge.store.close()
    again = QuestStore(path)
    loaded = again.get(quest.id)
    assert loaded is not None and loaded.status == "accepted" and loaded.assignee == "kirito"
    stale = again.get(quest.id)
    loaded.progress = 1
    again.save(loaded)
    with pytest.raises(StaleQuest):
        again.save(stale)  # type: ignore[arg-type]
    again.close()


def test_spool_settles_files_once(tmp_path: Path, run: Any) -> None:
    spool = SpoolIntake(tmp_path)
    good = json.loads((EXAMPLES / "commission.example.json").read_text(encoding="utf-8"))
    (spool.inbox / "a.json").write_text(json.dumps(good), encoding="utf-8")
    (spool.inbox / "b.json").write_text(json.dumps(good), encoding="utf-8")  # duplicate commissionId
    (spool.inbox / "c.json").write_text(json.dumps({**good, "commissionId": "x-0009", "reward": {"emeralds": 64}}), encoding="utf-8")
    (spool.inbox / "d.json").write_text(json.dumps({**good, "commissionId": "x-0010", "target": "minecraft:wither"}), encoding="utf-8")
    bridge, _, _, _ = make()
    result = run(bridge.pump(spool))
    assert len(result.offered) == 1 and result.duplicates == result.offered and result.assigned == result.offered
    assert sorted(name for name, _ in result.rejected) == ["c.json", "d.json"]
    assert dict(result.rejected)["d.json"] == "target_not_allowed"
    assert not list(spool.inbox.glob("*.json"))
    assert (tmp_path / "rejected" / "d.reason.txt").read_text(encoding="utf-8").startswith("target_not_allowed")


def test_signal_log_reads_incrementally_and_skips_partial_lines(tmp_path: Path) -> None:
    path = tmp_path / "signals.jsonl"
    row = kill("k-a", at=T0).to_wire()
    path.write_text(json.dumps(row) + "\n" + "garbage\n" + json.dumps({**row, "signalId": "k-b"}), encoding="utf-8")
    log = SignalLog(path)
    assert [s.signal_id for s in log.read()] == ["k-a"] and log.bad == 1
    with path.open("a", encoding="utf-8") as fh:
        fh.write("\n")
    assert [s.signal_id for s in log.read()] == ["k-b"]


def test_inventory_count_shapes() -> None:
    assert inventory_count({"items": [{"item": "minecraft:bread", "count": 2}]}, "minecraft:bread") == 2
    assert inventory_count(None, "minecraft:bread") == 0


def test_committed_schema_matches_models() -> None:
    committed = json.loads((ROOT / "schemas" / "villager_quest.schema.json").read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(quest_json_schema()))
    assert committed["$defs"]["Commission"]["additionalProperties"] is False
    assert "reward" not in committed["$defs"]["Commission"]["properties"]


def test_runtime_intent_sink_uses_real_harness_runtime(run: Any) -> None:
    runtime = HarnessRuntime()  # no body, not started: intents stay queued
    feedback, clock = MemoryFeedback(), Clock()
    bridge = QuestBridge(store=QuestStore(), policy=policy(), intents=RuntimeIntentSink(runtime), feedback=feedback, clock=clock,
                         heroes=[HeroSlot(agent="kirito", body_id=HERO_BODY, name="桐人")])
    quest, _ = run(bridge.offer(commission()))
    run(bridge.assign())
    stored = bridge.store.get(quest.id)
    assert stored is not None and stored.intent_id in runtime.intents
    intent = runtime.intents[stored.intent_id]
    assert intent.agent == "kirito" and intent.steps == [] and quest.id in intent.goal
    clock.advance(hours=2)
    run(bridge.tick())
    assert runtime.intents[stored.intent_id].state == "cancelled"
    events = runtime.pull_events()["events"]
    assert any(e.kind == "intent_state" and e.data.get("state") == "cancelled" for e in events)


def test_cli_once_round_trip(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    spool = SpoolIntake(tmp_path)
    (spool.inbox / "c.json").write_text((EXAMPLES / "commission.example.json").read_text(encoding="utf-8"), encoding="utf-8")
    args = ["once", "--policy", str(EXAMPLES / "policy.example.json"), "--spool", str(tmp_path), "--hero", f"kirito:{HERO_BODY}:桐人"]
    assert cli_main(args) == 0
    first = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert first["quests"][0]["status"] == "accepted"
    (tmp_path / "signals.jsonl").write_text(
        "\n".join(json.dumps({**kill(f"k-{i}", at=datetime.now(UTC)).to_wire()}) for i in range(5)) + "\n", encoding="utf-8")
    assert cli_main(args) == 0
    second = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert second["quests"][0]["status"] == "completed"
    outbox = [json.loads(line) for line in (tmp_path / "outbox.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [o["kind"] for o in outbox] == ["offered", "accepted", "completed"] and outbox[-1]["rewardGrant"]["reward"]["emeralds"] == 2
    assert cli_main(["schema"]) == 0 and "Commission" in capsys.readouterr().out
