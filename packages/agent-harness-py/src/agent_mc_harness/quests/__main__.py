"""Offline CLI. Never connects to a Minecraft server.

  python -m agent_mc_harness.quests schema                   # print the JSON Schema
  python -m agent_mc_harness.quests once --policy P --spool DIR --hero kirito:<body-uuid>:桐人
      reads DIR/inbox/*.json and DIR/signals.jsonl, writes DIR/outbox.jsonl and DIR/quests.sqlite3,
      and prints the goals a real HarnessRuntime would have received (no runtime, no body).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .bridge import HeroSlot, QuestBridge
from .feedback import JsonlFeedback
from .intake import SignalLog, SpoolIntake
from .models import quest_json_schema
from .policy import QuestPolicy
from .store import QuestStore


class PrintIntents:
    def __init__(self) -> None:
        self.n = 0

    async def submit(self, *, goal: str, agent: str, priority: int) -> str:
        self.n += 1
        print(json.dumps({"intent": f"dry_{self.n}", "agent": agent, "priority": priority, "goal": goal}, ensure_ascii=False))
        return f"dry_{self.n}"

    async def cancel(self, intent_id: str, reason: str) -> None:
        print(json.dumps({"cancel": intent_id, "reason": reason}, ensure_ascii=False))


def hero(value: str) -> HeroSlot:
    agent, body, name = (value.split(":", 2) + ["", ""])[:3]
    if not agent or not body:
        raise argparse.ArgumentTypeError("--hero agent:body-id[:name]")
    return HeroSlot(agent=agent, body_id=body, name=name or agent)


async def once(args: argparse.Namespace) -> int:
    root = Path(args.spool)
    store = QuestStore(args.db or root / "quests.sqlite3")
    bridge = QuestBridge(store=store, policy=QuestPolicy.load(args.policy), intents=PrintIntents(),
                         feedback=JsonlFeedback(root / "outbox.jsonl"), heroes=args.hero)
    try:
        pumped = await bridge.pump(SpoolIntake(root))
        signals = SignalLog(root / "signals.jsonl")
        advanced = await bridge.on_signals(signals.read())
        expired = await bridge.tick()
        summary = {"offered": pumped.offered, "duplicates": pumped.duplicates, "rejected": pumped.rejected,
                   "assigned": pumped.assigned, "advanced": [q.id for q in advanced], "expired": expired,
                   "badSignalLines": signals.bad,
                   "quests": [{"id": q.id, "status": q.status, "progress": q.progress, "quantity": q.commission.quantity}
                              for q in store.find()]}
        print(json.dumps(summary, ensure_ascii=False))
    finally:
        store.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m agent_mc_harness.quests")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("schema")
    run = sub.add_parser("once")
    run.add_argument("--policy", required=True)
    run.add_argument("--spool", required=True)
    run.add_argument("--db")
    run.add_argument("--hero", type=hero, action="append", default=[])
    args = parser.parse_args(argv)
    if args.cmd == "schema":
        json.dump(quest_json_schema(), sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0
    return asyncio.run(once(args))


if __name__ == "__main__":
    raise SystemExit(main())
