"""Offline truthfulness checks; never inspects live Docker/configuration."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "qwenpaw_inventory", Path(__file__).resolve().parents[1] / "tools/qwenpaw_inventory.py"
)
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)
AUDITED_ID = next(iter(inventory.AUDITED_IMAGE_PACKAGES))
PROJECT = Path("D:/offline-inventory-project")
HOME = Path("C:/offline-inventory-home")
BASE = PROJECT / "server/agents/work"
WORKSPACE = BASE / "workspaces/mc-god"


class InventoryTests(unittest.TestCase):
    def collect(self, config, profile=None, jobs=None, image_id=AUDITED_ID,
                image_tag="qwenpaw-mc:2.1.1"):
        sources = {
            BASE / "config.json": config,
            WORKSPACE / "agent.json": profile,
            WORKSPACE / "jobs.json": jobs,
        }

        def read(path):
            # Other runtime registrations are explicitly empty, not missing.
            return sources.get(path, {"agents": {"profiles": {}}})

        with patch.object(inventory, "_read_json", side_effect=read), \
                patch.object(inventory, "_container", return_value={
                    "state": "healthy", "image": image_tag, "imageId": image_id,
                }), patch.object(inventory, "_host_version", return_value="unknown"), \
                patch.object(Path, "glob", return_value=[]):
            return inventory.collect_qwenpaw_inventory(PROJECT, HOME)

    @staticmethod
    def config(**extra):
        return {"agents": {"profiles": {"mc-god": {"enabled": True}}}, **extra}

    @staticmethod
    def profile(**extra):
        return {"name": "Test Goddess", "tools": {"builtin_tools": {}},
                "mcp": {"clients": {}}, **extra}

    def test_container_reads_immutable_id_without_exposing_inspect_secrets(self):
        source = [{"Image": AUDITED_ID, "Config": {
            "Image": "renamed:mutable", "Env": ["TOKEN=private-sentinel"],
        }, "State": {"Running": True, "Status": "running",
                     "Health": {"Status": "healthy"}}}]
        completed = subprocess.CompletedProcess([], 0, stdout=json.dumps(source))
        with patch.object(inventory.subprocess, "run", return_value=completed) as run:
            observed = inventory._container("offline-container")
        self.assertEqual(observed, {"state": "healthy", "image": "renamed:mutable",
                                    "imageId": AUDITED_ID})
        self.assertEqual(run.call_args.args[0], ["docker", "inspect", "offline-container"])
        self.assertEqual(run.call_args.kwargs["creationflags"],
                         getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.assertNotIn("private-sentinel", json.dumps(observed))

    def test_mutable_tag_does_not_establish_package_version(self):
        result = self.collect(self.config(), image_id="sha256:" + "9" * 64)
        self.assertEqual(result["runtimes"][0]["version"], "unknown")
        self.assertIn("qiandengji_image_unverified", [x["code"] for x in result["issues"]])

    def test_audited_image_id_is_recognized_even_after_retagging(self):
        result = self.collect(self.config(), image_tag="unrelated:renamed")
        self.assertEqual(result["runtimes"][0]["version"],
                         inventory.AUDITED_IMAGE_PACKAGES[AUDITED_ID] + " (audited image package)")
        self.assertNotIn("qiandengji_image_unverified", [x["code"] for x in result["issues"]])

    def test_missing_config_or_profile_index_is_unknown_not_zero(self):
        for config in (None, {}, {"agents": {}}, {"agents": {"profiles": None}}):
            with self.subTest(config=config):
                result = self.collect(config)
                runtime = result["runtimes"][0]
                self.assertIsNone(runtime["agentCount"])
                self.assertIsNone(runtime["enabledAgentCount"])
                self.assertEqual(result["agents"], [])
                self.assertIn("qiandengji_config_unavailable",
                              [x["code"] for x in result["issues"]])

    def test_unreadable_profile_retains_identity_but_all_counts_are_unknown(self):
        result = self.collect(self.config(tools={"builtin_tools": {}}, mcp={"clients": {}}))
        agent = result["agents"][0]
        self.assertEqual((agent["id"], agent["enabled"]), ("mc-god", True))
        self.assertEqual(result["runtimes"][0]["agentCount"], 1)
        for field in ("toolCount", "mcpCount", "jobCount"):
            self.assertIsNone(agent[field], field)
        codes = [x["code"] for x in result["issues"]]
        self.assertIn("qiandengji_mc-god_profile_unavailable", codes)
        self.assertNotIn("D_team_not_migrated", codes)

    def test_explicit_empty_counts_are_still_zero(self):
        result = self.collect(self.config(), self.profile(), {"jobs": []})
        agent = result["agents"][0]
        self.assertEqual([agent[x] for x in ("toolCount", "mcpCount", "jobCount")], [0, 0, 0])

    def test_absent_inherited_tools_and_mcp_are_unknown(self):
        result = self.collect(self.config(), {"name": "Test Goddess"}, {"jobs": []})
        self.assertIsNone(result["agents"][0]["toolCount"])
        self.assertIsNone(result["agents"][0]["mcpCount"])

    def test_missing_or_malformed_jobs_are_unknown(self):
        for jobs in (None, {}, {"jobs": None}, {"jobs": {}}, {"jobs": ["invalid"]}):
            with self.subTest(jobs=jobs):
                result = self.collect(self.config(), self.profile(), jobs)
                self.assertIsNone(result["agents"][0]["jobCount"])

    def test_unreadable_driver_is_unknown_not_an_empty_mcp_count(self):
        driver = Path("offline/mcp/test.yaml")
        with patch.object(Path, "glob", return_value=[driver]), \
                patch.object(Path, "read_text", side_effect=PermissionError("denied")):
            self.assertIsNone(inventory._mcp_count(self.profile(), WORKSPACE))

    def test_shared_survivor_has_its_game_role_and_one_http_driver(self):
        self.assertIn('自主生存', inventory._role('qiandengji', 'qd-survivor'))
        body = json.dumps({'enabled': True, 'endpoint': {'headers': {'Authorization': 'private-fixture'}}})
        driver = Path('offline/mcp/numen_survival.yaml')
        for card in (body, 'enabled: true\nendpoint:\n  headers: private-fixture\n'):
            with self.subTest(format=card[:1]), patch.object(Path, 'glob', return_value=[driver]), \
                    patch.object(Path, 'read_text', return_value=card):
                self.assertEqual(inventory._mcp_count(self.profile(), WORKSPACE), 1)
        for card in ('{"enabled":"true"}', '{broken', '{"enabled":null}'):
            with self.subTest(invalid=card), patch.object(Path, 'glob', return_value=[driver]), \
                    patch.object(Path, 'read_text', return_value=card):
                self.assertIsNone(inventory._mcp_count(self.profile(), WORKSPACE))

    def test_json_read_failures_return_unknown(self):
        for failure in (FileNotFoundError("missing"), PermissionError("denied")):
            with self.subTest(failure=type(failure).__name__), \
                    patch.object(Path, "read_text", side_effect=failure):
                self.assertIsNone(inventory._read_json(Path("offline.json")))
        for body in ("{broken", "[]", "null"):
            with self.subTest(body=body), patch.object(Path, "read_text", return_value=body):
                self.assertIsNone(inventory._read_json(Path("offline.json")))

    def test_historical_version_note_and_public_projection(self):
        secret = "private-inventory-sentinel"
        result = self.collect(self.config(auth={"token": secret}),
                              self.profile(prompt=secret, api_key=secret),
                              {"jobs": [{"enabled": False, "prompt": secret}]})
        self.assertEqual(set(result), {"runtimes", "agents", "issues"})
        self.assertNotIn(secret, json.dumps(result))
        note = next(x for x in result["issues"] if x["code"] == "runtime_versions_differ")
        self.assertIn("历史", note["title"])
        self.assertIn("当时审计", note["detail"])


if __name__ == "__main__":
    unittest.main()
