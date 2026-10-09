"""Boundary tests for the narrow Goddess land tools; never contacts any server.

Uses the existing FastMCP 1.x API (mcp>=1,<2), without upgrading the live MCP runtime.
"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("goddess_land_tools", Path(__file__).with_name("goddess-mcp.py"))
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


class LandTools(unittest.TestCase):
    def test_read_has_no_mutation_or_audit(self):
        with patch.object(tools, "_rcon", return_value="members") as rcon, patch.object(tools, "_record") as audit:
            self.assertEqual(tools.land_members("sky_view_tower"), "members")
            rcon.assert_called_once_with("mycli admin land members sky_view_tower")
            audit.assert_not_called()

    def test_exact_action_and_account_are_audited(self):
        for action in ("trust", "untrust"):
            with self.subTest(action=action), patch.object(tools, "_rcon", return_value="receipt") as rcon, patch.object(tools, "_record") as audit:
                self.assertEqual(tools.manage_land_member("sky_view_tower", ".MicroKQ", action), "receipt")
                rcon.assert_called_once_with(f"mycli admin land member {action} sky_view_tower .MicroKQ")
                audit.assert_called_once_with("manage_land_member", {"land": "sky_view_tower", "player": ".MicroKQ", "action": action}, "receipt")

    def test_stable_uuid_is_preserved(self):
        uuid = "00000000-0000-0000-0009-00000d9f9c7b"
        with patch.object(tools, "_rcon", return_value="receipt") as rcon, patch.object(tools, "_record"):
            tools.manage_land_member("sky_view_tower", uuid, "trust")
            rcon.assert_called_once_with(f"mycli admin land member trust sky_view_tower {uuid}")

    def test_invalid_inputs_never_reach_rcon(self):
        attempts = [
            ("tower\nstop", "LittleFish0510", "trust"),
            ("tower other", "LittleFish0510", "trust"),
            ("tower", "@a", "trust"),
            ("tower", "LittleFish0510\rstop", "trust"),
            ("tower", "LittleFish0510 extra", "trust"),
            ("tower", "a" * 33, "trust"),
            ("tower", "LittleFish0510", "transfer"),
            ("tower", "LittleFish0510", "trust\nstop"),
        ]
        with patch.object(tools, "_rcon") as rcon, patch.object(tools, "_record"):
            for args in attempts:
                with self.subTest(args=args), self.assertRaises(ValueError):
                    tools.manage_land_member(*args)
            with self.assertRaises(ValueError):
                tools.land_members("tower\nstop")
            rcon.assert_not_called()

    def test_uncertain_submission_is_not_retried(self):
        with patch.object(tools, "_rcon", side_effect=TimeoutError("uncertain")) as rcon, patch.object(tools, "_record"):
            with self.assertRaises(TimeoutError):
                tools.manage_land_member("sky_view_tower", "LittleFish0510", "trust")
            self.assertEqual(rcon.call_count, 1)


if __name__ == "__main__":
    unittest.main()
