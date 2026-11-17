"""Harness² end to end: pinned upstream worker + existing TS runner/physics practice + Python proposer/staging/memory.
Runs when the pinned harness2 venv exists (AGENT_HARNESS_PY_H2_PYTHON or /workspace/.venvs/harness2/bin/python)."""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

import pytest

from agent_mc_harness.learning.harness2 import CODE, SKILL, WALK_BASELINE, WALK_TASK, DeterministicProposer, Harness2Optimizer
from agent_mc_harness.learning.strategies import StrategyStore
from agent_mc_harness.memory import LocalMemory, MemoryRouter

PY = os.environ.get("AGENT_HARNESS_PY_H2_PYTHON", "/workspace/.venvs/harness2/bin/python")
LIVE = {"instanceId": "numen-live", "realm": "live", "account": "acc", "agent": "harness"}


def test_deterministic_proposer_shapes(run: Any) -> None:
    p = DeterministicProposer()
    patch = run(p({"stage": "dom1.a1", "mission": "m", "files": {}}))
    assert set(patch["files"]) >= {CODE, SKILL} and patch["files"][SKILL].startswith("---\nname: minecraft-method\n")
    pick = run(p({"stage": "select.agg1", "mission": "m", "files": {"candidates/A.md": '"achieved":false', "candidates/B.md": '"achieved": true'}}))
    assert pick == {"choice": "B"}
    assert "experience" in run(p({"stage": "experience.agg1", "mission": "m", "files": {}}))


@pytest.mark.skipif(not Path(PY).exists() or shutil.which("node") is None, reason="pinned harness2 venv / node not available")
def test_propose_probe_compose_gate_stage_and_remember(run: Any, tmp_path: Path) -> None:
    async def go() -> dict[str, Any]:
        memory, strategies = MemoryRouter(LocalMemory()), StrategyStore()
        opt = Harness2Optimizer(directory=tmp_path, python=PY, proposer=DeterministicProposer(), strategies=strategies, memory=memory)
        out = await opt.optimize(job_id="walk-test", method_id="walk-method", task=WALK_TASK, baseline=WALK_BASELINE, group_id="g1", live=LIVE)
        out["facts"] = await memory.search("g1", "harness2 walk-method", 3)
        out["versions"] = strategies.versions("g1:method:walk-method")
        return out
    out = run(go())
    assert out["ok"], out.get("error")
    res = out["result"]
    assert res["upstreamRevision"].startswith("1cfe254e") and res["adopted"] is False
    assert res["train"]["baseline"]["achieved"] is False and res["train"]["candidate"]["achieved"] is True
    assert all(h["baseline"]["achieved"] is False and h["candidate"]["achieved"] is True for h in res["holdout"])
    assert res["gate"] == {"eligible": True, "reason": "isolated-comparison-passed", "adopted": False}
    assert [(v.version, v.status) for v in out["versions"]] == [(1, "candidate")], "staged, never auto-adopted"
    assert out["versions"][0].provenance["harness2JobHash"] == res["jobHash"]
    fact = out["facts"][0]
    assert fact.provenance["harness2JobHash"] == res["jobHash"] and fact.provenance["strategy"] == "g1:method:walk-method@v1"
    assert any(t["stage"].startswith("select.") for t in out["transcript"]) and any(t["stage"].startswith("agg") for t in out["transcript"])


@pytest.mark.skipif(not Path(PY).exists() or shutil.which("node") is None, reason="pinned harness2 venv / node not available")
def test_practice_must_be_isolated_from_live(run: Any, tmp_path: Path) -> None:
    async def go() -> dict[str, Any]:
        opt = Harness2Optimizer(directory=tmp_path, python=PY, proposer=DeterministicProposer())
        return await opt.optimize(job_id="walk-bad", method_id="walk-method", task=WALK_TASK, baseline=WALK_BASELINE,
                                  live={**LIVE, "realm": "practice-fixtures"})
    out = run(go())
    assert out["ok"] is False and "separate instance and realm" in out["error"]
