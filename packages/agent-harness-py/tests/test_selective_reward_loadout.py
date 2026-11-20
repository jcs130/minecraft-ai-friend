"""Exercise the actual emitted Lua without a game process or a real inventory."""
import pytest

from agent_mc_harness.body.loadout import armor_lua

lupa = pytest.importorskip("lupa")


@pytest.mark.parametrize(("filtered", "stash", "phase", "expected_take"), [
    ("matching", False, "collected", "arena rewards take 21 " + "e" * 64),
    ("empty", True, "collected", "arena stash take 134 1"),
    ("legacy", True, "collected", "arena stash take 134 1"),
    ("legacy", False, "rewards_incomplete", None),
    ("bad_ref", False, "rewards_incomplete", None),
    ("empty", False, "shop_unavailable", None),
])
def test_one_matching_piece_before_any_purchase(filtered, stash, phase, expected_take):
    runtime = lupa.LuaRuntime()
    commands, output = [], []
    count = 0

    def run(line):
        nonlocal count
        cmd = line.removeprefix("/mycli ")
        commands.append(cmd)
        item = "minecraft:iron_chestplate"
        if cmd == "arena status --json":
            rows = ['MC_TRIAL_STATE {"recipient":"QaAdventurer","missingEquipment":["胸甲"]}']
        elif cmd == "arena rewards list chest":
            rows = {
                "legacy": ["未知参数"],
                "empty": ["MC_REWARD_SUMMARY visible=0 queuedBonus=30 queuedPhotos=0 filter=chest"],
                "matching": [f"MC_REWARD slot=21 id={item} count=1 ref=" + "e"*64,
                             "MC_REWARD_SUMMARY visible=1 queuedBonus=30 queuedPhotos=0 filter=chest"],
                "bad_ref": [f"MC_REWARD slot=21 id={item} count=1 ref=broken",
                            "MC_REWARD_SUMMARY visible=1 queuedBonus=30 queuedPhotos=0 filter=chest"],
            }[filtered]
        elif cmd == "arena rewards list":
            rows = ["MC_REWARD_SUMMARY visible=9 queuedBonus=30 queuedPhotos=0"]
        elif cmd == "arena stash summary --json":
            rows = ['MC_STASH_OVERVIEW {"armor":{"pages":[' + ("3" if stash else "") + ']}}']
        elif cmd == "arena stash list 3":
            rows = [f"MC_STASH slot=134 id={item} count=1", "MC_STASH_SUMMARY occupied=2/54"]
        elif cmd == expected_take:
            rows = []
            count += 1
        elif cmd == "trade shop list supplies 1 --json":
            rows = []
        else:
            pytest.fail(f"unexpected command {cmd}")
        return runtime.table_from({"output": runtime.table_from(rows)})

    runtime.globals().run = run
    runtime.globals().item_count = lambda _item: count
    runtime.globals().print = output.append
    runtime.execute("""numen_hosted={
      permission={rules=function() return {yours={'allow command(mycli) @QaAdventurer'}} end},
      mc={run=run}, inv={items=function() return {} end,count=item_count}
    }""")
    runtime.execute(armor_lua("chest", True, "QaAdventurer"))
    assert output[0].split()[1] == phase
    assert count == int(expected_take is not None)
    assert ("trade shop list supplies 1 --json" in commands) == (phase == "shop_unavailable")
