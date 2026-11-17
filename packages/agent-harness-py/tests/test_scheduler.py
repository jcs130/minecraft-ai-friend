"""System 0 / 1 / 2 tiers, typed-choice protocol, thinking tier, lease, worker pool."""
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from simbody import SimBody
from test_runtime import settle

from agent_mc_harness.fastslow import FastSlow, FastSlowConfig
from agent_mc_harness.runtime import HarnessRuntime, Intent, PlanContext, Step
from agent_mc_harness.scheduler import BodyLease, WorkerPool
from agent_mc_harness.typed_choice import SystemOneClient, TypedChoice, parse_typed_choice

CANDIDATES = [{"id": "eat", "description": "eat bread now", "step": {"tool": "body:eat", "args": {"tag": "eat"}}},
              {"id": "mine", "description": "keep mining", "step": {"tool": "body:mine", "args": {"tag": "mine"}}}]


class Typed:
    """Fake /systemone service."""

    def __init__(self, choice: str = "mine", p: float = 0.9, delay: float = 0.0, reasoning: str | None = None) -> None:
        self.choice, self.p, self.delay, self.reasoning, self.calls = choice, p, delay, reasoning, []

    async def request(self, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(list(questions))
        await asyncio.sleep(self.delay)
        out = {}
        for key, q in questions.items():
            keys = list(q["criteria"])
            pick = self.reasoning if key == "reasoning" and self.reasoning else self.choice
            rest = (1 - self.p) / (len(keys) - 1)
            out[key] = TypedChoice(pick, self.p, self.p, {k: (self.p if k == pick else rest) for k in keys})
        return {"answers": out, "model": "fake-jev"}


class Planner:
    def __init__(self) -> None:
        self.contexts: list[PlanContext] = []

    async def __call__(self, intent: Intent, ctx: PlanContext) -> list[Step]:
        self.contexts.append(ctx)
        return [Step(tool="body:chat", args={"text": "system2 plan"})]


def runtime(body: SimBody, planner: Planner, typed: Any = None, **cfg: Any) -> HarnessRuntime:
    fs = FastSlow(FastSlowConfig(use_router=cfg.pop("use_router", False), system_one_deadline=cfg.pop("deadline", 0.3)), typed=typed)
    return HarnessRuntime(body=body, execute=True, planner=planner, fastslow=fs, defer_seconds=0.05, **cfg)


def test_system0_reflex_is_not_preempted(run: Any) -> None:
    async def go() -> None:
        body, planner = SimBody(), Planner()
        await body.spawn()
        body.health_ = 5.0  # low HP: the body's native survival owns the moment
        rt = runtime(body, planner, Typed(), max_defers=2)
        i = rt.submit_intent("mine iron", candidates=CANDIDATES)
        rt.start()
        done = await settle(rt, i.id, ("paused",))
        assert body.acts == [] and planner.contexts == [], "neither System 1 nor System 2 acted over the reflex"
        assert rt.metrics.deferred and "native" in (done.reason or "")
        body.health_, body.native_busy = 20.0, True  # native work running -> still waits
        j = rt.submit_intent("mine iron again", candidates=CANDIDATES)
        await asyncio.sleep(0.03)
        assert rt.intents[j.id].state == "queued" and body.acts == []
        await rt.close()
    run(go())


def test_system1_choice_executes_without_system2(run: Any) -> None:
    async def go() -> None:
        body, planner, typed = SimBody(), Planner(), Typed("mine", 0.9)
        await body.spawn()
        rt = runtime(body, planner, typed)
        i = rt.submit_intent("mine iron", candidates=CANDIDATES)
        rt.start()
        assert (await settle(rt, i.id)).state == "completed"
        assert [a.verb for a in body.acts] == ["mine"] and planner.contexts == []
        assert rt.intents[i.id].decision.tier == "system1"  # type: ignore[union-attr]
        assert rt.metrics.system1["ok"] == 1
        await rt.close()
    run(go())


@pytest.mark.parametrize("typed,code", [(Typed(delay=1.0), "policy_unavailable"), (Typed(p=0.55), "policy_escalated"), (None, "system_one_not_configured")])
def test_system1_timeout_or_low_confidence_falls_back_to_system2(typed: Any, code: str, run: Any) -> None:
    async def go() -> None:
        body, planner = SimBody(), Planner()
        await body.spawn()
        rt = runtime(body, planner, typed)
        i = rt.submit_intent("mine iron", candidates=CANDIDATES)
        rt.start()
        assert (await settle(rt, i.id)).state == "completed"
        d = rt.intents[i.id].decision
        assert d is not None and d.tier == "system2" and d.system1 is not None and d.system1["code"] == code
        assert [a.verb for a in body.acts] == ["chat"] and len(planner.contexts) == 1
        await rt.close()
    run(go())


def test_stale_scene_discards_system1_answer(run: Any) -> None:
    async def go() -> None:
        body, planner = SimBody(), Planner()
        await body.spawn()

        class Moving(Typed):
            async def request(self, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, Any]:
                out = await super().request(state, questions)
                if "action" in questions:
                    body.pos = {**body.pos, "x": body.pos["x"] + 5}  # the world moved while System 1 thought
                return out
        rt = runtime(body, planner, Moving("eat", 0.95))
        i = rt.submit_intent("mine iron", candidates=CANDIDATES)
        rt.start()
        await settle(rt, i.id)
        d = rt.intents[i.id].decision
        assert d is not None and d.tier == "system2" and d.system1["code"] == "policy_premise_changed"  # type: ignore[index]
        assert "eat" not in [a.verb for a in body.acts]
        await rt.close()
    run(go())


def test_thinking_tier_per_request(run: Any) -> None:
    async def go() -> None:
        body, planner = SimBody(), Planner()
        await body.spawn()
        rt = runtime(body, planner, Typed(reasoning="deliberate", p=0.9), use_router=True)
        i = rt.submit_intent("plan a nether trip")
        rt.start()
        await settle(rt, i.id)
        d = planner.contexts[0].decision
        assert d is not None and d.route is not None and d.requested_tier == "complex" and d.effective_tier == "complex"
        assert rt.metrics.requested["complex"] == 1 and rt.metrics.effective["complex"] == 1
        await rt.close()
        fs = FastSlow(FastSlowConfig(use_router=False), typed=Typed(reasoning="immediate", p=0.5))
        req, eff = await fs.thinking_tier(None, {"profile": "complex"}, {})
        assert (req, eff) == ("complex", "complex"), "low-confidence judge inherits; a complex profile never lowers"
    run(go())


def test_lease_and_worker_pool(run: Any) -> None:
    async def go() -> None:
        lease = BodyLease()
        async with lease.hold("a") as epoch:
            assert lease.valid(epoch)
            lease.preempt("reflex")
            assert not lease.valid(epoch)
        pool, live, peak = WorkerPool(2), [0], [0]

        async def job() -> None:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
            await asyncio.sleep(0.02)
            live[0] -= 1
        await asyncio.gather(*(pool.submit("research", job) for _ in range(5)))
        assert peak[0] == 2 and pool.done["research"] == 5
    run(go())


def test_parse_typed_choice_matches_cormy_rules() -> None:
    ok = {"choice": "a", "confidence": 0.8, "probabilities": {"a": 0.8, "b": 0.2}}
    assert parse_typed_choice(ok, ["a", "b"]) is not None
    above = {"choice": "a", "confidence": 0.6, "probabilities": {"a": 0.8, "b": 0.2}}  # (0.8-0.5)/0.5
    assert parse_typed_choice(above, ["a", "b"]).confidence == 0.6  # type: ignore[union-attr]
    for bad in ({**ok, "choice": "b"}, {**ok, "probabilities": {"a": 0.8, "b": 0.5}}, {**ok, "probabilities": {"a": 0.8}},
                {**ok, "confidence": 0.3}, {**ok, "type": "text"}):
        assert parse_typed_choice(bad, ["a", "b"]) is None


def test_system_one_client_protocol(run: Any) -> None:
    for bad in ("http://10.0.0.5/v1/systemone", "https://x/v1/other", "https://u:p@x/v1/systemone"):
        with pytest.raises(ValueError):
            SystemOneClient(bad, "jev")

    class Resp:
        status_code = 200

        def json(self) -> dict[str, Any]:
            return {"answers": {"q": {"choice": "a", "confidence": 0.9, "probabilities": {"a": 0.9, "b": 0.1}}}, "model": "jev-1"}

    class Http:
        def __init__(self) -> None:
            self.sent: list[Any] = []

        async def post(self, url: str, json: Any, headers: dict[str, str]) -> Resp:
            self.sent.append((url, json, headers))
            return Resp()

    http = Http()
    client = SystemOneClient("http://127.0.0.1:8090/v1/systemone", "jev-1", api_key_env="NO_SUCH_KEY_FOR_TEST", http=http)
    out = run(client.request({"x": 1}, {"q": {"type": "choice", "instructions": "pick", "criteria": {"a": "A", "b": "B"}}}))
    assert out["answers"]["q"].choice == "a" and http.sent[0][1]["model"] == "jev-1" and "Authorization" not in http.sent[0][2]
