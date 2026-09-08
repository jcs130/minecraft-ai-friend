"""Offline registration/configuration checks; no RCON, game accounts, or production files."""
import ast
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

WORLD = Path(__file__).resolve().parents[1]
BRIDGE = WORLD / "sidecar" / "guard" / "mcp_numen.py"


class BridgePathsTest(unittest.TestCase):
    def test_default_paths_follow_checkout_and_node_path(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch("shutil.which", return_value="node-found-on-path"), \
                patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            spec = importlib.util.spec_from_file_location("qiandeng_mcp_defaults_test", BRIDGE)
            bridge = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(bridge)
            self.assertEqual(bridge.REPO_ROOT, str(WORLD))
            self.assertEqual(bridge.NODE_EXE, "node-found-on-path")
            self.assertEqual(bridge.SKILLS_DIR, str(WORLD / "sidecar" / "guard" / "skills"))
            self.assertEqual(bridge.DATA, str(WORLD / "data"))
            self.assertIsNone(bridge._R)

    def test_bridge_loads_all_existing_tools_with_isolated_paths(self):
        tree = ast.parse(BRIDGE.read_text(encoding="utf-8"), filename=str(BRIDGE))
        declared = {
            node.name for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
            and any(isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                    and isinstance(d.func.value, ast.Name) and d.func.value.id == "mcp"
                    and d.func.attr == "tool" for d in node.decorator_list)
        }
        self.assertEqual(len(declared), 54, "Integration should preserve the existing tool surface")
        with tempfile.TemporaryDirectory(prefix="qiandeng-mcp-test-") as td:
            root = Path(td)
            env = {
                "NUMEN_REPO_ROOT": str(root / "source"),
                "MC_DATA_DIR": str(root / "runtime"),
                "NUMEN_DATA_DIR": str(root / "guard-output"),
                "NUMEN_SKILLS_DIR": str(root / "skills"),
                "NUMEN_COMPANION": "OfflineFixture",
                "NUMEN_DISPLAY": "Offline fixture",
                "NODE_EXE": "node-for-offline-test",
                "TSX_CLI": str(root / "tsx.mjs"),
            }
            with patch.dict(os.environ, env, clear=True), \
                    patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                spec = importlib.util.spec_from_file_location("qiandeng_mcp_test", BRIDGE)
                bridge = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(bridge)
                self.assertEqual(bridge.REPO_ROOT, env["NUMEN_REPO_ROOT"])
                self.assertEqual(bridge.WORLD_DATA, env["MC_DATA_DIR"])
                self.assertEqual(bridge.DATA, env["NUMEN_DATA_DIR"])
                self.assertEqual(bridge.SKILLS_DIR, env["NUMEN_SKILLS_DIR"])
                self.assertEqual(bridge.NODE_EXE, env["NODE_EXE"])
                self.assertEqual(bridge.TSX_CLI, env["TSX_CLI"])
                self.assertEqual(Path(bridge.CHANT_REQ).parent, root / "runtime")
                self.assertIsNone(bridge._R, "Loading the tools must not instantiate RCON")
                # Use a synchronous loop driver: no event-loop socketpair is needed.
                def complete(coro):
                    try:
                        coro.send(None)
                    except StopIteration as result:
                        return result.value
                    finally:
                        coro.close()
                    self.fail("Unexpected I/O suspension in read-only tool")
                self.assertEqual(complete(bridge.list_skills()), "技能篇目录不存在")
                skills = root / "skills" / "fixture"
                skills.mkdir(parents=True)
                (skills / "SKILL.md").write_text("---\nname: fixture\ndescription: Offline\n---\nFixture instructions.", encoding="utf-8")
                self.assertIn("Fixture instructions.", complete(bridge.read_skill("fixture")))
                self.assertIn("fixture", complete(bridge.list_skills()))
                self.assertIsNone(bridge._safe_skill_path("fixture", "../outside.md"))
            # SDK metadata listing completes locally, so no event-loop socketpair is needed.
            with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                registered = {tool.name for tool in complete(bridge.mcp.list_tools())}
            self.assertEqual(registered, declared)


if __name__ == "__main__":
    unittest.main()
