"""Opt-in checks against the owned loopback fixture, never the live server.

NUMEN_KIRITO_TEST_CONFIG points to its private stage-controller.json. No model
call is made and no task is accepted, skill learned, item moved or reward claimed.
"""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import unittest

from numen_controller import Controller, result_text


def records(text, prefix):
    return [json.loads(line[len(prefix) + 1:]) for line in text.splitlines() if line.startswith(prefix + " ")]


@unittest.skipUnless(os.environ.get("NUMEN_KIRITO_TEST_CONFIG"), "requires the owned isolated fixture")
class InformationLiveTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        cfg = json.loads(Path(os.environ["NUMEN_KIRITO_TEST_CONFIG"]).read_text(encoding="utf-8-sig"))
        self.assertEqual(cfg["upstream_url"], "http://127.0.0.1:25978/mcp")
        self.assertEqual(cfg["companion_uuid"], "8e7b99e0-595d-3402-935c-7139ac6814e3")
        self.temp = tempfile.TemporaryDirectory(prefix="kirito-information-")
        cfg.update(auto_wake=False, journal_dir=self.temp.name)
        self.controller = Controller(cfg)
        # These independent query cases deliberately open fresh sessions. Do not
        # leave a 10-second server long-poll in flight after each case closes;
        # actual background event delivery is verified separately on one session.
        async def no_background_poll():
            await asyncio.Event().wait()
        self.controller.poll_events = no_background_poll
        self.context = self.controller.connected()
        await self.context.__aenter__()
        for _ in range(100):
            if self.controller.session:
                break
            await asyncio.sleep(.1)
        self.assertIsNotNone(self.controller.session)

    async def asyncTearDown(self):
        await self.context.__aexit__(None, None, None)
        evidence = os.environ.get("NUMEN_KIRITO_TEST_EVIDENCE")
        if evidence:
            with Path(evidence).open("a", encoding="utf-8") as output:
                output.write((Path(self.temp.name) / "controller.jsonl").read_text(encoding="utf-8"))
        self.temp.cleanup()

    async def query(self, line):
        value = await self.controller.call("command", {"line": line})
        self.assertFalse(value.isError, result_text(value))
        self.assertTrue(value.structuredContent["complete"])
        return result_text(value)

    async def test_real_identity_profession_and_mana_are_returned(self):
        state = records(await self.query("/mycli status --json"), "MC_STATUS")[0]
        self.assertEqual(state["playerUuid"], "8e7b99e0-595d-3402-935c-7139ac6814e3")
        self.assertEqual(state["profession"]["combat"], "warrior")
        self.assertEqual(state["manaStatus"], "known")
        self.assertGreaterEqual(state["mana"], 0)
        profession = records(await self.query("/mycli profession status"), "MC_PROFESSION")[0]
        self.assertEqual(profession["combat"], "warrior")

    async def test_tasks_report_conditions_and_supply_route_without_accepting(self):
        before = records(await self.query("/mycli tasks status --json"), "MC_TASKS")[0]
        self.assertTrue(before["adventure"]["joined"])
        self.assertEqual(before["adventure"]["completed"], 7)
        task = records(await self.query("/mycli tasks info tm_starter_blade --json"), "MC_TASKS")[0]
        self.assertTrue(task["readOnly"])
        self.assertEqual(task["steps"][0]["target"], 3)
        self.assertEqual(task["steps"][0]["combat"]["weapons"], ["SWORD"])
        self.assertIn("ZOMBIE", task["steps"][0]["combat"]["mobs"])
        self.assertTrue(task["steps"][0]["guidance"]["missingConditions"])
        self.assertEqual(task["suppliesCommand"], "/mycli guild shared")
        after = records(await self.query("/mycli tasks status --json"), "MC_TASKS")[0]
        self.assertEqual(before["adventure"], after["adventure"])

    async def test_all_skill_json_survives_old_stdout_limit_and_distinguishes_eligibility(self):
        text = await self.query("/mycli skills mine")
        self.assertGreater(len(text), 6000)
        skills = records(text, "MC_SKILL")
        self.assertGreater(len(skills), 20)
        parry = next(item for item in skills if item["id"] == "sword_parry")
        self.assertTrue(parry["unlocked"])
        self.assertFalse(parry["learned"])
        self.assertFalse(parry["prepared"])
        self.assertEqual(parry["cooldownMs"], 12000)
        self.assertEqual(parry["mana"], 4)
        self.assertTrue(records(text, "MC_SKILL_ASSESSMENT"), "the last receipt must also arrive")
        points = records(await self.query("/mycli skills points"), "MC_SKILL_POINTS")[0]
        self.assertEqual((points["earned"], points["spent"]), (7, 0))

    async def test_progress_pages_are_complete_and_separate_mainline_from_training(self):
        command = "/mycli progress all 1 --json"
        items, pages = [], set()
        while command:
            page = records(await self.query(command), "MC_PAGE")[0]
            self.assertNotIn(page["page"], pages)
            pages.add(page["page"])
            items.extend(page["items"])
            command = page.get("nextCommand", "")
            self.assertLessEqual(len(pages), 16)
        main = next(item for item in items if item.get("section") == "main")
        self.assertIn("graduated", main)
        self.assertTrue(any(item.get("section") == "training" for item in items))
        self.assertTrue(any(item.get("section") == "guild" for item in items))

    async def test_custom_item_name_is_available_beyond_vanilla_base_id(self):
        text = await self.query("/mycli arena stash inventory")
        self.assertRegex(text, r"MC_INVENTORY slot=\d+ .*id=minecraft:player_head .*name=大背包")
        self.assertIn("MC_INVENTORY_SUMMARY", text)
        self.assertIn("MC_STASH_SUMMARY", await self.query("/mycli arena stash list"))

    async def test_native_container_can_read_own_backpack_and_close_without_moving_items(self):
        await self.query("/minepacks:backpack open")
        try:
            result = await self.controller.call("lua", {"code": 'local w=numen.gui.view(); local n=0; for _,s in ipairs(w.slots) do if s.side=="container" then n=n+1 end end; print("CONTAINER_SLOTS="..n); print("CURSOR="..tostring(w.cursor)); return w.menu'})
            self.assertFalse(result.isError, result_text(result))
            self.assertIn("CONTAINER_SLOTS=54", result_text(result))
            self.assertIn("CURSOR=nil", result_text(result))
        finally:
            closed = await self.controller.call("lua", {"code": "return numen.gui.close()"})
            self.assertFalse(closed.isError, result_text(closed))


if __name__ == "__main__":
    unittest.main()
