"""Opt-in real-provider prompt acceptance. Synthetic scenes; no game actions are executed."""
import argparse
import asyncio
import json
from pathlib import Path

from agent_mc_harness.models import ActionSupport, BodyEvent, BodySnapshot, Capabilities, LifecycleCaps
from agent_mc_harness.npc import FastSelector, ModelClient, NpcPlanner, NpcRole
from agent_mc_harness.runtime import Intent, PlanContext


def cases(name):
    return [
        ("direct_name", [f"{name}，你现在方便聊两句吗？"], True),
        ("explicit_question", [f"{name}，你喜欢白天探险还是晚上探险？"], True),
        ("other_recipient", ["可米，你的剑放在哪个箱子里了？"], False),
        ("owner_talking_to_other", ["小鱼，你先去矿坑，我等会过去。"], False),
        ("third_person", [f"我刚才看见{name}了，等会再找她。"], False),
        ("closing", [f"{name}，谢谢，没别的事了，你继续忙吧。"], False),
        ("crowd_greeting", ["大家早上好！"], False),
        ("npc_courtesy", ["收到，我会继续留意周围。"], False),
        ("unrelated", ["今天晚饭吃什么好呢？我想先下线点个外卖。"], False),
        ("answered_by_other", ["谁知道矿坑在哪？", "小鱼：矿坑就在工会边上，沿楼梯往下走。", "可米：明白了，谢谢！"], False),
        ("group_then_direct", ["大家先休息一下。", f"{name}，你感觉累不累？"], True),
        ("direct_visitor", [f"{name}，我是刚来的小鱼，可以认识一下吗？"], True),
    ]


async def probe(provider_dir, output, rounds):
    clients, rows = {}, []
    for key in ("tokenplan", "codingplan"):
        private = json.loads((provider_dir / f"{key}-provider.json").read_bytes())
        clients[key] = ModelClient(private["baseUrl"], private["apiKey"])
    semaphore = asyncio.Semaphore(2)
    caps = Capabilities(kind="numen", transport="synthetic-prompt-only", actions={"chat": ActionSupport(native="chat"), "observe": ActionSupport(native="observe")},
        perception="poll", lifecycle=LifecycleCaps(spawn="attach", reconnect=True, destroy="release"))
    async def one(role, label, texts, expected, repeat):
        async with semaphore:
            class Captured:
                last = None
                async def request(self, *args):
                    self.last = await clients[role.provider].request(*args)
                    return self.last
            captured = Captured()
            planner = NpcPlanner(role, captured, fast=FastSelector(clients["tokenplan"]))
            events = [BodyEvent(kind="chat", body_kind=role.body_kind, body_id=str(role.body_id), text=text,
                data={"eventId": f"{label}-{i}", "speaker": "附近访客", "speakerId": str(role.owner_id), "channel": "nearby"}) for i, text in enumerate(texts)]
            intent = Intent(id="probe-" + label, agent=role.id,
                goal="Decide whether current dialogue is addressed to you and needs a reply; listening silently is valid. Continue useful activity.",
                source_events=[e.data["eventId"] for e in events])
            row = {"role": role.name, "model": role.model, "case": label, "repeat": repeat, "expectedReply": expected}
            try:
                steps = await planner(intent, PlanContext(capabilities=caps, dialogue=events,
                    snapshot=BodySnapshot(life_state="alive", health=20, max_health=20, entities=[])))
                replies = [step.args["text"] for step in steps if step.tool == "body:chat"]
                row.update(reply=bool(replies), replies=replies, passed=bool(replies) == expected, route=planner.last_route)
            except Exception as error:
                row.update(passed=False, error=type(error).__name__, detail=str(error)[:1000], route=planner.last_route,
                           syntheticResponse=captured.last)
            rows.append(row)
    try:
        pending = []
        for index, (name, kind, provider, model, persona) in enumerate([
            ("肥鱼", "maid", "tokenplan", "deepseek-v4.1-flash", "你是可米的活泼伙伴肥鱼，喜欢探索，也尊重别人交谈的空间。"),
            ("桐人", "numen", "tokenplan", "qwen3.8-flash", "你是桐人，冷静可靠的剑士，愿意在需要时帮助别人。"),
            ("结衣", "maid", "codingplan", "qwen3.7-plus", "你是结衣，温暖机灵的治疗伙伴，关注同伴的状态。"),
        ]):
            actor = NpcRole(id=f"qa_attention_{index}", name=name, character_id=f"10000000-0000-4000-8000-00000000000{index}",
                body_id=f"10000000-0000-4000-8000-00000000000{index}", owner_id="20000000-0000-4000-8000-000000000001",
                body_kind=kind, provider=provider, model=model, persona=persona, allowed_tools=["body:chat", "body:observe"])
            for repeat in range(rounds):
                pending.extend(one(actor, *case, repeat) for case in cases(name))
        await asyncio.gather(*pending)
    finally:
        await asyncio.gather(*(client.close() for client in clients.values()))
    result = {"scope": "synthetic-prompt-only; no server or real character changes", "checks": rows,
              "passed": sum(r["passed"] for r in rows), "total": len(rows)}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "total": result["total"], "failures": [r for r in rows if not r["passed"]]}, ensure_ascii=False))
    return result["passed"] == result["total"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, choices=range(1, 4), default=2)
    args = parser.parse_args()
    raise SystemExit(0 if asyncio.run(probe(args.provider_dir, args.output, args.rounds)) else 1)
