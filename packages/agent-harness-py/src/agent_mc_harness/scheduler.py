"""Single body lease, background worker pool and brain metrics (lightweight forms of cormy-private-bot
docs/task-workers.md + runtime/task-worker.ts + brain-metrics.ts, and the survivor/numen-hosting lease rules).

* ``BodyLease`` - exactly one holder may act on the body (the execution worker). Reflexes (safety stop, native
  emergencies) and System 1 do NOT queue for it: ``preempt()`` bumps the epoch so the current holder's late results
  are discarded, like numen-hosting's epoch fence / CONTROL_CHANGED.
* ``WorkerPool`` - research / reflection / review jobs run concurrently (``max_concurrent``) and never get the lease.
* ``BrainMetrics`` - requested vs effective thinking tier, decisions per tier, System 1 accept/escalate/latency,
  goals verified by environment evidence vs merely "steps returned ok".
"""
from __future__ import annotations

import asyncio
import contextlib
import time
from collections import Counter
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any


class LeaseLost(RuntimeError):
    pass


class BodyLease:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.epoch = 0
        self.holder: str | None = None

    @contextlib.asynccontextmanager
    async def hold(self, holder: str) -> AsyncIterator[int]:
        async with self._lock:
            self.epoch += 1
            self.holder = holder
            try:
                yield self.epoch
            finally:
                self.holder = None

    def valid(self, epoch: int) -> bool:
        return epoch == self.epoch and self.holder is not None

    def preempt(self, reason: str) -> int:
        """Reflex path: invalidate the holder's epoch without waiting for the lock."""
        self.epoch += 1
        return self.epoch


class WorkerPool:
    def __init__(self, max_concurrent: int = 2) -> None:
        self._sem = asyncio.Semaphore(max_concurrent)
        self.tasks: set[asyncio.Task[Any]] = set()
        self.done = Counter[str]()

    def submit(self, kind: str, job: Callable[[], Awaitable[Any]]) -> asyncio.Task[Any]:
        async def run() -> Any:
            async with self._sem:
                try:
                    return await job()
                finally:
                    self.done[kind] += 1
        task = asyncio.get_running_loop().create_task(run(), name=f"worker-{kind}")
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def close(self) -> None:
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)


class BrainMetrics:
    def __init__(self) -> None:
        self.decisions = Counter[str]()      # tier -> count (host/reflex/system1/system2)
        self.requested = Counter[str]()      # thinking tier asked for
        self.effective = Counter[str]()      # thinking tier actually used
        self.system1 = Counter[str]()        # ok / code
        self.system1_ms: list[float] = []
        self.goals = Counter[str]()          # completed_verified / completed_unverified / failed / paused
        self.deferred = Counter[str]()       # native-owned moments (focus survival / wait)
        self.started = time.time()

    def decision(self, tier: str, requested: str | None = None, effective: str | None = None) -> None:
        self.decisions[tier] += 1
        if requested:
            self.requested[requested] += 1
        if effective:
            self.effective[effective] += 1

    def system_one(self, result: dict[str, Any]) -> None:
        self.system1["ok" if result.get("ok") else str(result.get("code"))] += 1
        if isinstance(result.get("latencyMs"), int | float):
            self.system1_ms.append(float(result["latencyMs"]))
            del self.system1_ms[:-200]

    def view(self) -> dict[str, Any]:
        ms = sorted(self.system1_ms)
        return {"decisions": dict(self.decisions), "thinkingRequested": dict(self.requested), "thinkingEffective": dict(self.effective),
                "system1": dict(self.system1), "system1MedianMs": ms[len(ms) // 2] if ms else None, "goals": dict(self.goals),
                "deferredToNative": dict(self.deferred), "uptimeSeconds": round(time.time() - self.started)}
