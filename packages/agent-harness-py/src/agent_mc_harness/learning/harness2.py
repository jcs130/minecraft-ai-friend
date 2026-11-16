"""Harness² as the deep self-iteration mechanism of the reflection loop (Propose -> Probe -> Compose).

Reflection queues optimisation targets (repeated failures of a method); ``Harness2Optimizer.optimize`` runs one job:

  Python (this module: model port + staging + memory)
    -> node h2_driver.mjs  (EXISTING agent-mc-world Harness2Runner: journal, budgets, held-out gate;
                            EXISTING createPhysicsMethodPractice: MethodRunner sandbox + prismarine physics,
                            isolated practice binding != live instance/realm)
      -> python bridges/harness2/worker.py  (EXISTING bridge to pinned google-research/harness2 1cfe254e)

Boundaries kept from agent-mc-world docs/harness2.md: practice binding is a dedicated instance AND realm different
from the live one; one job per runner, trials serial; success only from independent observation (assessPracticeTrial);
held-out fixtures re-run for baseline AND candidate; only run.js / params.json / SKILL.md are mutable; ``adopted`` is
always false - an eligible candidate is STAGED as a ``method`` version in the StrategyStore (status candidate) and a
reflection episode linking it is written to memory. Adoption is a later, evidence-gated trial; rollback = earlier version.

Model port: ``LLMProposer`` (OpenAI-compatible, e.g. DeepSeek; key read from the env var NAMED by ``api_key_env``) or
``DeterministicProposer`` (offline; tests). The worker subprocess never receives model credentials (the TS runner
filters its environment).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Protocol

from .._reuse import repo_root
from ..memory.base import MemoryEpisode
from .strategies import StrategyStore

CODE = "skills/minecraft-method/scripts/run.js"
PARAMS = "skills/minecraft-method/scripts/params.json"
SKILL = "skills/minecraft-method/SKILL.md"
DRIVER = Path(__file__).with_name("node") / "h2_driver.mjs"

WALK_TASK = ("Walk to mc.state().target. mc.state() returns {snapshot:{position,health,velocity,onGround}, target:{x,y,z}}; "
             "snapshot.position is observed. Use await bot.look(yaw,pitch) (yaw = Math.atan2(-dx,-dz)), "
             "await bot.setControlState(key,bool), await bot.waitForTicks(n) and await bot.clearControlStates(); at most 32 calls. "
             "Java 1.21.1 flat supported practice terrain. Success = within the goal radius, measured independently.")
WALK_BASELINE = {"code": "return (await mc.state()).snapshot.position;", "params": {},
                 "guidance": "A bounded method; release keys when finished."}


class Proposer(Protocol):
    id: str

    async def __call__(self, request: dict[str, Any]) -> dict[str, Any]: ...


def _skill(description: str, body: str) -> str:
    return f"---\nname: minecraft-method\ndescription: {description}\n---\n{body}"


class DeterministicProposer:
    """Offline model stand-in (clearly labelled). Proposes measured-steering walk variants, selects the candidate
    whose probe evidence shows the goal achieved (falls back to the first ID), and writes a bounded lesson."""
    id = "deterministic-walk-proposer/v1"

    VARIANTS = [
        # 0: forward without steering (plausible but usually wrong heading)
        ("Walk forward for a fixed time", "try {\n  await bot.setControlState('forward', true);\n  await bot.waitForTicks(params.ticks ?? 40);\n"
         "} finally { await bot.clearControlStates(); }\nreturn (await mc.state()).snapshot.position;", {"ticks": 40}),
        # 1: closed-loop steering from the measured position
        ("Steer from the measured position toward the target",
         "const target = (await mc.state()).target;\ntry {\n  await bot.setControlState('forward', true);\n"
         "  for (let i = 0; i < (params.maxSteps ?? 7); i++) {\n    const p = (await mc.state()).snapshot.position;\n"
         "    const dx = target.x - p.x, dz = target.z - p.z;\n    if (Math.hypot(dx, dz) < (params.arrive ?? 0.65)) break;\n"
         "    await bot.look(Math.atan2(-dx, -dz), 0);\n    await bot.waitForTicks(Math.min(20, Math.max(1, Math.floor(Math.hypot(dx, dz) / 0.22))));\n"
         "  }\n} finally { await bot.clearControlStates(); }\nreturn (await mc.state()).snapshot.position;", {"maxSteps": 7, "arrive": 0.65}),
    ]

    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, request: dict[str, Any]) -> dict[str, Any]:
        stage, files = str(request["stage"]), request.get("files") or {}
        self.calls += 1
        if stage.startswith("select."):
            ids = sorted(m[1] for n in files if (m := re.fullmatch(r"candidates/([A-Z]+)\.md", n)))
            good = [i for i in ids if re.search(r'"achieved"\s*:\s*true', files.get(f"candidates/{i}.md", ""))]
            return {"choice": (good or ids)[0]}
        if stage.startswith("experience."):
            return {"experience": {"cue": "Walking to a public target on supported flat ground",
                                   "lesson": "Read the target, steer from the measured position each step, release keys in finally.",
                                   "evidence": "Probe positions reached the target radius; the read-only baseline did not move.",
                                   "confidence": "Limited to isolated flat-grid practice fixtures"}}
        description, code, params = self.VARIANTS[min(self.calls - 1, len(self.VARIANTS) - 1) if not stage.startswith("agg") else 1]
        return {"files": {CODE: code, PARAMS: json.dumps(params), SKILL: _skill(description, "Use measured positions only; release keys in finally.")}}


class LLMProposer:
    """System 2 model port over an OpenAI-compatible /chat/completions (DeepSeek by default). JSON-only replies."""

    def __init__(self, *, base_url: str = "https://api.deepseek.com", model: str = "deepseek-chat", api_key_env: str = "DEEPSEEK_API_KEY",
                 timeout: float = 120.0, http: Any = None) -> None:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", api_key_env):
            raise ValueError("api_key_env must be an environment variable NAME")
        self.url, self.model, self.api_key_env, self.timeout, self._http = base_url.rstrip("/") + "/chat/completions", model, api_key_env, timeout, http
        self.id = f"openai-compatible:{model}"
        self.usage = {"inputTokens": 0, "outputTokens": 0, "calls": 0}

    @property
    def available(self) -> bool:
        return bool(os.environ.get(self.api_key_env))

    async def __call__(self, request: dict[str, Any]) -> dict[str, Any]:
        key = os.environ.get(self.api_key_env)
        if not key:
            raise RuntimeError("proposer key not set")
        if self._http is None:
            import httpx
            self._http = httpx.AsyncClient(timeout=self.timeout, trust_env=False)
        stage = str(request["stage"])
        if stage.startswith("select."):
            shape = '{"choice": "<one anonymous candidate ID such as A>"}'
        elif stage.startswith("experience."):
            shape = '{"experience": {"cue": "...", "lesson": "...", "evidence": "...", "confidence": "..."}} or {"notes": "no entry"}'
        else:
            shape = ('{"files": {"' + CODE + '": "<JavaScript function BODY; await bot/mc calls; release keys in finally>", "' + PARAMS +
                     '": "<JSON object string>", "' + SKILL + '": "---\\nname: minecraft-method\\ndescription: ...\\n---\\n<guidance>"}}')
        prompt = (f"{request['mission']}\n\nReply with ONLY a JSON object of this shape: {shape}\n"
                  "Only the three method files may be changed. Never write other files.\n\nFILES:\n" +
                  "\n".join(f"### {name}\n{text}" for name, text in sorted((request.get("files") or {}).items())))
        response = await self._http.post(self.url, headers={"Authorization": f"Bearer {key}"}, json={
            "model": self.model, "messages": [{"role": "user", "content": prompt[:300_000]}], "temperature": 0.3,
            "response_format": {"type": "json_object"}, "max_tokens": 4000})
        if response.status_code != 200:
            raise RuntimeError(f"proposer HTTP {response.status_code}")
        data = response.json()
        usage = data.get("usage") or {}
        self.usage["calls"] += 1
        self.usage["inputTokens"] += int(usage.get("prompt_tokens") or 0)
        self.usage["outputTokens"] += int(usage.get("completion_tokens") or 0)
        text = data["choices"][0]["message"]["content"]
        reply = json.loads(text[text.find("{"): text.rfind("}") + 1])
        if not isinstance(reply, dict):
            raise ValueError("model reply is not an object")
        reply["usage"] = {"inputTokens": usage.get("prompt_tokens"), "outputTokens": usage.get("completion_tokens"),
                          "cachedTokens": usage.get("prompt_cache_hit_tokens")}
        return reply


class Harness2Optimizer:
    def __init__(self, *, directory: str | Path, python: str, proposer: Proposer, fallback: Proposer | None = None,
                 strategies: StrategyStore | None = None, memory: Any = None, node: str = "node", world: Path | None = None,
                 binding: dict[str, Any] | None = None, seeds: tuple[int, ...] = (1, 2, 3)) -> None:
        self.directory, self.python, self.proposer, self.fallback = Path(directory), python, proposer, fallback
        self.strategies, self.memory, self.node = strategies, memory, node
        self.world = world or repo_root() / "packages" / "agent-mc-world"
        self.binding = binding or {"instanceId": "harness-py-practice", "realm": "practice-fixtures", "account": "practice-bot",
                                   "agent": "harness-py", "isolated": True}
        self.seeds = seeds
        self.transcript: list[dict[str, Any]] = []  # stage, proposer used, reply kind (no prompts/secrets)
        self._lock = asyncio.Lock()  # one job per runner

    async def _model(self, request: dict[str, Any]) -> dict[str, Any]:
        for proposer in (self.proposer, self.fallback):
            if proposer is None:
                continue
            try:
                reply = await proposer(request)
                self.transcript.append({"stage": request["stage"], "proposer": proposer.id, "reply": sorted(k for k in reply if k != "usage"),
                                        "files": sorted((reply.get("files") or {}).keys()), "choice": reply.get("choice")})
                return reply
            except Exception as error:
                self.transcript.append({"stage": request["stage"], "proposer": proposer.id, "error": type(error).__name__})
        raise RuntimeError("no proposer answered")

    async def optimize(self, *, job_id: str, method_id: str, task: str, baseline: dict[str, Any], live: dict[str, Any],
                       group_id: str | None = None, mode: str = "parallel", k: int = 2,
                       budget: dict[str, int] | None = None, lessons: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """``live`` = {"instanceId", "realm", "account", "agent"} of the body being improved (must differ from practice)."""
        async with self._lock:
            started = time.time()
            self.transcript = []
            self.directory.mkdir(parents=True, exist_ok=True)
            job = {"id": job_id, "methodId": method_id, "sourceInstanceId": live["instanceId"],
                   "scope": {"realm": live["realm"], "account": live["account"], "agent": live["agent"]}, "task": task, "baseline": baseline,
                   **({"lessons": lessons[:8]} if lessons else {}), "mode": mode, "k": k, "budget": budget or {"modelCalls": 14, "trials": 12, "wallMs": 900_000, "trialMs": 10_000, "contextBytes": 600_000}}
            first = {"world": str(self.world), "directory": str(self.directory / "jobs"), "modelId": getattr(self.proposer, "id", "proposer"),
                     "worker": {"command": self.python, "script": str(self.world / "bridges" / "harness2" / "worker.py"),
                                "workspace": str(self.directory / "workspace")},
                     "practice": {"directory": str(self.directory / "practice-methods"), "seeds": list(self.seeds), "binding": self.binding}, "job": job}
            proc = await asyncio.create_subprocess_exec(self.node, str(DRIVER), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                        stderr=asyncio.subprocess.DEVNULL, limit=8 * 1024 * 1024,
                                                        env={k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "TMPDIR")})
            assert proc.stdin is not None and proc.stdout is not None
            proc.stdin.write((json.dumps(first) + "\n").encode())
            await proc.stdin.drain()
            final: dict[str, Any] | None = None
            while line := await proc.stdout.readline():
                message = json.loads(line)
                if message.get("type") == "model":
                    try:
                        reply = {"id": message["id"], "reply": await self._model(message["request"])}
                    except Exception as error:
                        reply = {"id": message["id"], "error": type(error).__name__}
                    proc.stdin.write((json.dumps(reply) + "\n").encode())
                    await proc.stdin.drain()
                elif message.get("type") in ("result", "error"):
                    final = message
            await proc.wait()
            if final is None or final["type"] == "error":
                return {"ok": False, "error": (final or {}).get("message", "driver exited"), "transcript": self.transcript}
            result = final["result"]
            out: dict[str, Any] = {"ok": True, "result": result, "fixtures": final.get("fixtures"), "stats": final.get("stats"),
                                   "elapsedSeconds": round(time.time() - started, 1), "transcript": self.transcript, "staged": None, "memory": None}
            if result["gate"]["eligible"] and self.strategies is not None and group_id:
                staged = self.strategies.propose(f"{group_id}:method:{method_id}", "method",
                                                 {"code": result["selected"]["code"], "params": result["selected"]["params"],
                                                  "guidance": result["selected"]["guidance"]},
                                                 provenance={"harness2JobHash": result["jobHash"], "selectedTrialId": result["selectedTrialId"],
                                                             "upstreamRevision": result["upstreamRevision"], "gate": result["gate"]["reason"]},
                                                 start_trial=False)
                out["staged"] = {"key": staged.key, "version": staged.version, "status": staged.status}
            if self.memory is not None and group_id:
                holdout = "; ".join(f"{h['caseId']}: baseline {h['baseline']['achieved']} -> candidate {h['candidate']['achieved']}" for h in result["holdout"])
                exp = result.get("experience") or {}
                body = (f"Harness² job {job_id} on method {method_id}: gate eligible={result['gate']['eligible']} ({result['gate']['reason']}). "
                        f"Held-out: {holdout}. " + (f"Lesson: {exp.get('lesson')} (cue: {exp.get('cue')})" if exp else ""))
                prov = {"trigger": "harness2", "harness2JobHash": result["jobHash"], "evidenceRefs": result["evidenceRefs"][:8]}
                if out["staged"]:
                    prov["strategy"] = f"{out['staged']['key']}@v{out['staged']['version']}"
                episode = MemoryEpisode(id=f"harness2-{result['jobHash'][:16]}", kind="reflection", name=f"harness2: {method_id}", body=body[:20_000],
                                        source_description="harness2 practice (isolated)", provenance=prov)
                out["memory"] = await self.memory.add(group_id, episode)
            return out
