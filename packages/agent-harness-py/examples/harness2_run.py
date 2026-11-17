"""End-to-end: failure reflections -> Harness² optimisation target -> Propose/Probe/Compose on the offline physics
practice body -> held-out gate -> staged method version + reflection fact with provenance.

    python examples/harness2_run.py --out /workspace/.data/harness2-run [--proposer llm|deterministic]

LLM proposer reads the key from the env var named by --key-env (default DEEPSEEK_API_KEY); it is never printed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

from agent_mc_harness.learning.harness2 import WALK_BASELINE, WALK_TASK, DeterministicProposer, Harness2Optimizer, LLMProposer
from agent_mc_harness.learning.reflection import ReflectionInput, ReflectionLoop
from agent_mc_harness.learning.strategies import StrategyStore
from agent_mc_harness.memory import LocalMemory, MemoryRouter
from agent_mc_harness.models import BodyIdentity, Scope, WorldRef


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/workspace/.data/harness2-run")
    ap.add_argument("--proposer", choices=["llm", "deterministic"], default="llm")
    ap.add_argument("--key-env", default="DEEPSEEK_API_KEY")
    ap.add_argument("--python", default="/workspace/.venvs/harness2/bin/python")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--rounds", type=int, default=3)
    args = ap.parse_args()
    out = Path(args.out)
    if args.fresh and out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    identity = BodyIdentity(kind="numen", body_id="6f0c1d2e-3a4b-4c5d-8e9f-001122334455", name="practice-demo",
                            world=WorldRef(server_id="qiandengji", world_key="main"), scope=Scope(realm="live", account="zhongli", agent="harness-py"))
    group = identity.group_id()
    memory = MemoryRouter(LocalMemory(out / "memory.sqlite"))
    strategies = StrategyStore(out / "strategies.sqlite")
    llm = LLMProposer(api_key_env=args.key_env)
    deterministic = DeterministicProposer()
    proposer = llm if args.proposer == "llm" and llm.available else deterministic
    optimizer = Harness2Optimizer(directory=out / "h2", python=args.python, proposer=proposer,
                                  fallback=deterministic if proposer is llm else None, strategies=strategies, memory=memory)
    runs: list[dict] = []
    done = asyncio.Event()

    async def on_optimize(target: dict) -> None:
        method = target["methodKey"].split(":", 1)[1]
        lessons: list[dict] = []
        for round_ in range(1, args.rounds + 1):
            result = await optimizer.optimize(job_id=f"{method}-r{round_}-{int(time.time())}", method_id=f"{method}-method", task=WALK_TASK,
                                              baseline=WALK_BASELINE, group_id=group, lessons=lessons,
                                              live={"instanceId": "numen-live-qiandengji", "realm": "live", "account": "zhongli", "agent": "harness-py"})
            runs.append({"round": round_, "target": target, **result})
            res = result.get("result") or {}
            if not result.get("ok") or res.get("gate", {}).get("eligible"):
                break
            # Self-iteration across jobs: the next job recalls the measured outcome of this one (bounded, evidence-linked).
            exp = res.get("experience") or {}
            dist = [h["candidate"]["measurements"].get("distance") for h in res.get("holdout", [])]
            lessons.append({"cue": "walking to mc.state().target on flat practice ground",
                            "lesson": (f"Previous candidate ended {dist} blocks from the target (radius 0.8): one open-loop move is not enough. "
                                       f"{exp.get('lesson', '')}")[:1500], "evidenceRefs": res.get("evidenceRefs", [])[:4] or [res["jobHash"]]})
        done.set()

    loop = ReflectionLoop(memory=memory, group_id=lambda: group, strategies=strategies, optimize_after=3, on_optimize=on_optimize, cooldown=0)
    # Three failed walks (as the runtime would report them) -> three failure reflections -> one optimisation target.
    for i in range(3):
        await loop.reflect(ReflectionInput(trigger="failure", goal="walk to the marked target", intent_id=f"in_demo_{i}", state="failed",
                                           receipts=[{"requestId": f"hs_demo_walk_{i:04d}", "verb": "move", "status": "failed",
                                                      "text": f"stopped {2 + i} blocks short of the target"}]))
    await done.wait()
    run = runs[-1]
    facts = await memory.search(group, "harness2 walk method held-out", 10)
    report = {"proposer": proposer.id, "proposerUsage": getattr(proposer, "usage", None), "queued": list(loop.queue), "reflectionStats": dict(loop.stats),
              "rounds": [{"round": r["round"], "ok": r.get("ok"), "gate": (r.get("result") or {}).get("gate"),
                          "train": (r.get("result") or {}).get("train"), "holdout": (r.get("result") or {}).get("holdout"),
                          "selectedCode": ((r.get("result") or {}).get("selected") or {}).get("code"), "staged": r.get("staged"),
                          "elapsedSeconds": r.get("elapsedSeconds"), "transcript": r.get("transcript")} for r in runs],
              "run": {k: run.get(k) for k in ("ok", "error", "elapsedSeconds", "staged", "transcript", "fixtures", "stats")},
              "result": run.get("result"), "strategyVersions": strategies.export(run["staged"]["key"]) if run.get("staged") else [],
              "memoryFacts": [f.model_dump() for f in facts]}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": run.get("ok"), "error": run.get("error"), "proposer": proposer.id, "gate": (run.get("result") or {}).get("gate"),
                      "staged": run.get("staged"), "report": str(out / "report.json")}, ensure_ascii=False))
    await memory.close()
    return 0 if run.get("ok") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
