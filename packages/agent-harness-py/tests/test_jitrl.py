"""JitRL port (cross-checked against the TS reweightJitRl), goal-conditioned shaping, mid-term credit."""
from __future__ import annotations

import json
import math
import shutil
import subprocess
from typing import Any

import pytest
from pydantic import ValidationError

from agent_mc_harness._reuse import repo_root
from agent_mc_harness.learning.jitrl import DEFAULT_WEIGHTS, GoalWeights, JitRL, MetricWeights, Observation, reweight, shaped_return

C = [{"id": "bread", "actionHash": "bread", "prior": 0.6, "ready": True}, {"id": "carrot", "actionHash": "carrot", "prior": 0.4, "ready": True}]
CASES = [
    (C, [{"id": "a", "actionHash": "bread", "value": -1}, {"id": "b", "actionHash": "carrot", "value": 1}]),
    (C, []),
    (C, [{"id": "a", "actionHash": "bread", "value": -1}, {"id": "a", "actionHash": "bread", "value": -1}]),
    ([{**C[0], "prior": 1}, {**C[1], "prior": 0}], []),
    ([{**C[0], "ready": False}, C[1]], []),
    (C, [{"id": "a", "actionHash": "bread", "value": 0.3}, {"id": "b", "actionHash": "bread", "value": 0.9}, {"id": "c", "actionHash": "carrot", "value": -0.2},
         {"id": "d", "actionHash": "other", "value": 1}, {"id": "e", "actionHash": "carrot", "value": 5}]),
]


def test_paper_formula_matches_ts_unit_expectations() -> None:
    r = reweight(*CASES[0])
    assert math.isclose(r["candidates"][1]["posterior"], 0.4 * math.exp(0.5) / (0.6 * math.exp(-0.5) + 0.4 * math.exp(0.5)), rel_tol=1e-12)
    assert math.isclose(reweight(*CASES[1])["candidates"][0]["posterior"], 0.6)
    r = reweight(*CASES[2])
    assert r["sampleSize"] == 1 and r["candidates"][1]["estimateSource"] == "unobserved-neutral"
    assert math.isclose(r["candidates"][1]["posterior"], 0.4 * math.exp(0.5) / (0.6 + 0.4 * math.exp(0.5)), rel_tol=1e-12)
    assert reweight(*CASES[3])["candidates"][1]["posterior"] == 0
    assert [c["id"] for c in reweight(*CASES[4])["candidates"]] == ["carrot"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node needed for the TS cross-check")
def test_numerically_identical_to_ts_reweightJitRl() -> None:
    module = repo_root() / "packages" / "agent-mc-world" / "dist" / "runtime" / "core" / "jitrl.js"
    if not module.exists():
        pytest.skip("agent-mc-world dist not built")
    script = (f"import {{ reweightJitRl }} from {json.dumps(module.as_uri())};"
              f"const cases = {json.dumps(CASES)};"
              "process.stdout.write(JSON.stringify(cases.map(([c, n]) => reweightJitRl(c, n, 0.5))));")
    ts = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True, timeout=60).stdout)
    for (cands, neigh), expected in zip(CASES, ts, strict=True):
        ours = reweight(cands, neigh, 0.5)
        assert ours["sampleSize"] == expected["sampleSize"]
        assert (ours["baseline"] is None) == (expected["baseline"] is None)
        for a, b in zip(ours["candidates"], expected["candidates"], strict=True):
            assert a["id"] == b["id"] and math.isclose(a["posterior"], b["posterior"], rel_tol=1e-12, abs_tol=1e-15)


def obs(**kw: Any) -> Observation:
    base: dict[str, Any] = {"dimension": "overworld", "health": 20.0, "food": 10.0, "position": (0.0, 64.0, 0.0), "inventory": {}, "at": 1.0}
    return Observation(**{**base, **kw})


def test_goal_weights_change_the_shaped_return() -> None:
    before = obs(health=12.0)
    wood = obs(health=10.0, inventory={"oak_log": 4}, at=2.0)       # gained logs, lost a little health
    rest = obs(health=18.0, at=2.0)                                  # healed, no items
    _, gather = DEFAULT_WEIGHTS.select("gather wood for a table")
    _, survive = DEFAULT_WEIGHTS.select("survive the night")
    assert shaped_return(before, wood, gather)[0] > shaped_return(before, rest, gather)[0]  # type: ignore[operator]
    assert shaped_return(before, rest, survive)[0] > shaped_return(before, wood, survive)[0]  # type: ignore[operator]
    assert shaped_return(before, obs(health=0.0, at=2.0), gather) == (-1.0, "observed-death")
    assert shaped_return(before, obs(dimension="the_nether", at=2.0), gather)[0] is None
    single = MetricWeights(food=1, targets={"food": 4})
    assert shaped_return(obs(), obs(food=14.0, health=16.0, at=2.0), single)[0] == pytest.approx(1 - 4 / 20)  # = TS single criterion


def test_weight_change_alters_action_ranking() -> None:
    chop = {"tool": "body:mine", "args": {"block": "oak_log"}}
    eat = {"tool": "body:eat", "args": {"item": "bread"}}

    def trained(goal: str) -> dict[str, Any]:
        jit = JitRL()
        for n in range(3):
            before = obs(health=12.0, at=float(n))
            jit.record_step(scope="g", goal=goal, step=chop, status="completed", before=before,
                            after=obs(health=11.0, inventory={"oak_log": 3}, at=n + 0.5), request_id=f"chop{n}")
            jit.record_step(scope="g", goal=goal, step=eat, status="completed", before=before, after=obs(health=16.0, at=n + 0.5), request_id=f"eat{n}")
        return jit.rank(scope="g", goal=goal, obs=obs(health=12.0), candidates=[{"id": "chop", "step": chop}, {"id": "eat", "step": eat}])
    wood, survive = trained("gather wood"), trained("survive the night")
    assert wood["suggestedChoice"] == "chop" and survive["suggestedChoice"] == "eat"
    assert wood["taskKey"] == "gather_wood" and survive["taskKey"] == "survive" and wood["bodyDispatched"] is False


def test_retrieval_is_scoped() -> None:
    jit = JitRL()
    step = {"tool": "body:eat", "args": {}}
    jit.record_step(scope="g1", goal="eat", step=step, status="completed", before=obs(), after=obs(food=14.0, at=2.0), request_id="r1")
    ranked = jit.rank(scope="g2", goal="eat", obs=obs(), candidates=[{"id": "a", "step": step}, {"id": "b", "step": {"tool": "body:chat"}}])
    assert ranked["sampleSize"] == 0, "another body/world/identity never contributes evidence"
    far = jit.rank(scope="g1", goal="eat", obs=obs(position=(100.0, 64.0, 0.0)), candidates=[{"id": "a", "step": step}, {"id": "b", "step": {"tool": "x"}}])
    assert far["sampleSize"] == 0
    assert jit.record_step(scope="g1", goal="eat", step=step, status="unknown", before=obs(), after=obs(), request_id="r2") is None


def test_midterm_discounted_credit_adds_tagged_samples(tmp_path: Any) -> None:
    jit = JitRL(path=tmp_path / "book.jsonl", window=3, gamma=0.5)
    for n in range(4):
        jit.record_step(scope="g", goal="mine iron", step={"tool": "body:mine", "args": {"n": n}}, status="completed",
                        before=obs(at=float(n)), after=obs(inventory={"iron_ore": 1}, at=n + 0.5), request_id=f"r{n}")
    originals = [s.model_copy() for s in jit.samples]
    credited = jit.credit(scope="g", goal="mine iron", outcome="failure")
    assert [c.value for c in credited] == [-1.0, -0.5, -0.25] and {c.credit_source for c in credited} == {"failure"}
    assert [s for s in jit.samples if s.credit_source == "step"] == originals, "past samples are never rewritten"
    assert credited[0].goal_version == originals[-1].goal_version
    assert jit.credit(scope="g", goal="mine iron", outcome="milestone") == [], "a trajectory is credited once"
    again = JitRL(path=tmp_path / "book.jsonl")
    assert len(again.samples) == 7 and again.stats()["bySource"] == {"step": 4, "failure": 3}


def test_weight_config_validation(tmp_path: Any) -> None:
    with pytest.raises(ValidationError):
        MetricWeights()  # all zero
    with pytest.raises(ValidationError):
        MetricWeights(food=1, targets={"mana": 3})
    with pytest.raises(ValidationError):
        MetricWeights(inventory={"Oak Log!": 1})
    with pytest.raises(ValidationError):
        GoalWeights.model_validate({"rules": [{"name": "x", "match": [], "weights": {"food": 1}}]})
    path = tmp_path / "w.json"
    path.write_text(json.dumps({"version": "7", "rules": [{"name": "fish", "match": ["fish", "钓鱼"], "weights": {"inventory": {"cod": 2}}}]}))
    table = GoalWeights.load(path)
    assert table.select("去钓鱼")[0] == "fish" and table.select("anything")[0] == "default"


def test_jitrl_is_the_system1_action_selection_hook(run: Any) -> None:
    import asyncio

    from simbody import SimBody
    from test_runtime import settle

    from agent_mc_harness.fastslow import FastSlow, FastSlowConfig
    from agent_mc_harness.runtime import HarnessRuntime

    async def go() -> None:
        body = SimBody()
        body.effects = {"eat": {"food": 2}, "mine": {"health": -3}}
        await body.spawn()
        body.food = 10.0
        jit = JitRL()
        fs = FastSlow(FastSlowConfig(use_router=False), jitrl=jit)
        planned: list[str] = []

        async def planner(intent: Any, ctx: Any) -> list[Any]:
            from agent_mc_harness.runtime import Step
            planned.append(intent.goal)
            return [Step(**intent.candidates[len(planned) % 2].step)]
        rt = HarnessRuntime(body=body, execute=True, planner=planner, fastslow=fs)
        cands = [{"id": "eat", "description": "eat", "step": {"tool": "body:eat", "args": {"tag": "eat"}}},
                 {"id": "mine", "description": "mine", "step": {"tool": "body:mine", "args": {"tag": "mine"}}}]
        rt.start()
        for _ in range(4):  # System 2 explores; every verified step is measured by the shaped return
            i = rt.submit_intent("eat something", candidates=cands)
            await settle(rt, i.id)
            body.health_, body.food = 20.0, 10.0
        assert jit.counters["steps"] == 4 and jit.counters["credited"] > 0
        i = rt.submit_intent("eat something", candidates=cands)
        await settle(rt, i.id)
        d = rt.intents[i.id].decision
        assert d is not None and d.tier == "system1" and d.system1["provider"] == "jitrl" and d.system1["choice"] == "eat"  # type: ignore[index]
        await asyncio.sleep(0)
        await rt.close()
    run(go())
