"""Resident reflection + self-iteration store."""
from __future__ import annotations

from typing import Any

from simbody import SimBody
from test_memory import DownGraph
from test_runtime import settle

from agent_mc_harness import Flags, create_harness
from agent_mc_harness.learning.reflection import LLMReflector, ReflectionInput, ReflectionLoop
from agent_mc_harness.learning.strategies import StrategyStore
from agent_mc_harness.memory import LocalMemory, MemoryRouter

FAIL = ReflectionInput(trigger="failure", goal="mine 3 iron", intent_id="in_1", state="failed",
                       receipts=[{"requestId": "hs_req_0001", "verb": "mine", "status": "failed", "text": "no pickaxe equipped"}])


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_failure_event_reflects_into_memory_with_provenance_via_runtime(run: Any, tmp_path: Any) -> None:
    async def go() -> None:
        body = SimBody(fail={"mine"})
        env = {"AGENT_HARNESS_PY_ENABLED": "1", "AGENT_HARNESS_PY_EXECUTE": "1", "AGENT_HARNESS_PY_MEMORY": "local",
               "AGENT_HARNESS_PY_MEMORY_PATH": str(tmp_path / "m.sqlite")}
        rt = create_harness(body, Flags.from_env(env))
        assert rt is not None and rt.reflection is not None, "reflection is resident when the harness is enabled"
        await rt.body.spawn()  # type: ignore[union-attr]
        i = rt.submit_intent("mine 3 iron", steps=[{"tool": "body:mine", "args": {}}])
        rt.start()
        assert (await settle(rt, i.id)).state == "failed"
        for _ in range(50):
            if rt.reflection.stats["failure"]:
                break
            import asyncio
            await asyncio.sleep(0.02)
        g = body.identity().group_id()  # type: ignore[union-attr]
        facts = await rt.memory.search(g, "mine iron failed", 5)  # type: ignore[union-attr]
        refl = [f for f in facts if f.data.get("kind") == "reflection"]
        assert refl and refl[0].provenance["intentId"] == i.id and refl[0].provenance["trigger"] == "failure"
        assert refl[0].provenance["requestIds"] == [rt.intents[i.id].receipts[0].request_id]
        assert refl[0].provenance["reflector"] == "deterministic"
        assert any(e.kind == "reflection" for e in rt.events)
        await rt.close()
    run(go())


def test_milestone_and_periodic_triggers(run: Any) -> None:
    async def go() -> None:
        mem = MemoryRouter(LocalMemory())
        loop = ReflectionLoop(memory=mem, group_id=lambda: "g1")
        ok = await loop.reflect(ReflectionInput(trigger="milestone", goal="build hut", receipts=[{"requestId": "hs_x_00000001", "verb": "place", "status": "completed"}]))
        assert ok is not None and "place" in ok.lesson
        periodic = await loop.periodic(["death: fell", "death: lava", "task_failed: mine"])
        assert periodic is not None and "deathx2" in periodic.lesson
        assert loop.stats["milestone"] == 1 and loop.stats["periodic"] == 1
    run(go())


def test_dedupe_and_cooldown(run: Any) -> None:
    async def go() -> None:
        clock = Clock()
        loop = ReflectionLoop(memory=MemoryRouter(LocalMemory()), group_id=lambda: "g1", cooldown=60, clock=clock)
        assert await loop.reflect(FAIL) is not None
        same_shape = FAIL.model_copy(update={"intent_id": "in_2", "goal": "mine 5 iron"})  # numbers normalised away
        assert await loop.reflect(same_shape) is None and loop.stats["deduped"] == 1
        clock.t += 61
        assert await loop.reflect(same_shape) is not None
    run(go())


def test_llm_reflector_missing_key_or_error_falls_back(run: Any, monkeypatch: Any) -> None:
    async def go() -> None:
        monkeypatch.delenv("REFLECT_TEST_KEY", raising=False)
        llm = LLMReflector("https://api.example.invalid", "m", "REFLECT_TEST_KEY")
        loop = ReflectionLoop(memory=MemoryRouter(LocalMemory()), group_id=lambda: "g1", reflector=llm)
        r = await loop.reflect(FAIL)
        assert r is not None and r.reflector == "deterministic" and loop.stats["reflector_error_llm"] == 1

        class Resp:
            status_code = 200

            def json(self) -> dict[str, Any]:
                return {"choices": [{"message": {"content": '{"cue": "mining without a tool", "lesson": "equip a pickaxe first", "confidence": 0.8}'}}]}

        class Http:
            async def post(self, *a: Any, **k: Any) -> Resp:
                assert k["headers"]["Authorization"] == "Bearer k-test"
                return Resp()
        monkeypatch.setenv("REFLECT_TEST_KEY", "k-test")
        loop2 = ReflectionLoop(memory=MemoryRouter(LocalMemory()), group_id=lambda: "g1",
                               reflector=LLMReflector("https://api.example.invalid", "m", "REFLECT_TEST_KEY", http=Http()))
        r2 = await loop2.reflect(FAIL)
        assert r2 is not None and r2.reflector == "llm" and r2.lesson == "equip a pickaxe first"
    run(go())


def test_graphiti_down_reflection_still_lands_locally(run: Any) -> None:
    async def go() -> None:
        mem = MemoryRouter(LocalMemory(), DownGraph())
        loop = ReflectionLoop(memory=mem, group_id=lambda: "g1")
        assert await loop.reflect(FAIL) is not None
        assert loop.stats["written_local_only"] == 1
        facts = await mem.search("g1", "pickaxe", 3)
        assert facts and facts[0].source == "local" and facts[0].provenance["signature"]
    run(go())


def test_repeated_failures_queue_a_harness2_target(run: Any) -> None:
    async def go() -> None:
        targets: list[dict[str, Any]] = []

        async def on_optimize(t: dict[str, Any]) -> None:
            targets.append(t)
        loop = ReflectionLoop(memory=MemoryRouter(LocalMemory()), group_id=lambda: "g1", optimize_after=3, on_optimize=on_optimize)
        for n in range(4):
            await loop.reflect(FAIL.model_copy(update={"intent_id": f"in_{n}"}))
        import asyncio
        await asyncio.sleep(0)
        assert [t["methodKey"] for t in targets] == ["method:mine"] and len(loop.queue) == 1
    run(go())


def test_strategy_adoption_gate_and_rollback() -> None:
    s = StrategyStore(min_trials=3)
    v1 = s.propose("g:lesson:mine", "lesson", {"lesson": "A"})
    assert v1.status == "trial" and s.active("g:lesson:mine").version == 1  # type: ignore[union-attr]
    for ok in (True, True, None, False):  # None (unverified/unknown) is never evidence
        s.record("g:lesson:mine", 1, ok)
    assert s.get("g:lesson:mine", 1).status == "adopted"  # type: ignore[union-attr]  # 2/3 >= no-baseline 0.5
    v2 = s.propose("g:lesson:mine", "lesson", {"lesson": "B"})
    assert v2.parent == 1 and s.active("g:lesson:mine").version == 2  # type: ignore[union-attr]
    for ok in (False, False, True):
        s.record("g:lesson:mine", 2, ok)
    assert s.get("g:lesson:mine", 2).status == "rolled_back"  # type: ignore[union-attr]  # 1/3 < 2/3
    assert s.active("g:lesson:mine").version == 1, "previous version is active again"  # type: ignore[union-attr]
    v3 = s.propose("g:lesson:mine", "lesson", {"lesson": "C"})
    for ok in (True, True, True):
        s.record("g:lesson:mine", 3, ok)
    assert s.get("g:lesson:mine", 3).status == "adopted" and s.get("g:lesson:mine", 1).status == "retired"  # type: ignore[union-attr]
    s.rollback("g:lesson:mine", "operator")
    assert s.active("g:lesson:mine").version == 1  # type: ignore[union-attr]
    m = s.propose("g:method:walk", "method", {"code": "x"}, start_trial=False)
    assert m.status == "candidate" and s.active("g:method:walk") is None, "Harness² methods are staged, never auto-used"
    assert v3.version == 3


def test_runtime_records_verified_outcomes_for_lessons_in_use(run: Any) -> None:
    from agent_mc_harness.runtime import HarnessRuntime

    async def go() -> None:
        body = SimBody()
        await body.spawn()
        s = StrategyStore(min_trials=1)
        g = body.identity().group_id()  # type: ignore[union-attr]
        s.propose(f"{g}:lesson:method:chat", "lesson", {"cue": "c", "lesson": "l"})

        async def verifier(intent: Any, snap: Any) -> bool:
            return True

        async def planner(intent: Any, ctx: Any) -> list[Any]:
            from agent_mc_harness.runtime import Step
            return [Step(tool="body:chat", args={"text": "hi"})]
        rt = HarnessRuntime(body=body, execute=True, planner=planner, strategies=s, verifier=verifier)
        i = rt.submit_intent("greet")
        rt.start()
        await settle(rt, i.id)
        assert s.get(f"{g}:lesson:method:chat", 1).status == "adopted"  # type: ignore[union-attr]
        assert rt.metrics.goals["completed_verified"] == 1
        await rt.close()
    run(go())
