"""Plugin <-> Python bridge round trip over the real file spool. Offline: no Minecraft server, no network.

    python run_bridge_roundtrip.py --jdk /path/to/jdk21 --gson /path/to/gson-2.10.1.jar [--python /venv/bin/python]

The Python side is ``python -m agent_mc_harness.quests once`` from packages/agent-harness-py (needs its deps).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

here = Path(__file__).resolve().parent
plugin = here.parent
repo = plugin.parents[2]
harness = repo / "packages/agent-harness-py"
HERO = "6f0c1d2e-3a4b-4c5d-8e9f-001122334455"

p = argparse.ArgumentParser()
p.add_argument("--jdk", type=Path, required=True)
p.add_argument("--gson", type=Path, required=True)
p.add_argument("--python", default="python")
a = p.parse_args()

with tempfile.TemporaryDirectory() as tmp:
    classes = Path(tmp) / "classes"
    spool = Path(tmp) / "spool"
    sources = [*map(str, (plugin / "src/org/qiandengji/villagerquests/core").glob("*.java")),
               str(here / "org/qiandengji/villagerquests/core/CoreRulesTest.java"),
               str(here / "org/qiandengji/villagerquests/core/BridgeRoundtrip.java")]
    subprocess.run([str(a.jdk / "bin/javac"), "-encoding", "UTF-8", "--release", "21", "-proc:none", "-cp", str(a.gson), "-d", str(classes), *sources], check=True)
    cp = os.pathsep.join([str(classes), str(a.gson)])

    def java(step: str) -> str:
        return subprocess.run([str(a.jdk / "bin/java"), "-cp", cp, "org.qiandengji.villagerquests.core.BridgeRoundtrip", step, str(spool), HERO],
                              check=True, capture_output=True, text=True).stdout.strip()

    def bridge() -> dict:
        env = {**os.environ, "PYTHONPATH": str(harness / "src")}
        out = subprocess.run([a.python, "-m", "agent_mc_harness.quests", "once", "--policy", str(harness / "examples/villager_quests/policy.example.json"),
                              "--spool", str(spool), "--hero", f"kirito:{HERO}:桐人"], check=True, capture_output=True, text=True, env=env).stdout
        return json.loads(out.strip().splitlines()[-1])

    print(java("handoff"))
    first = bridge()
    assert first["offered"] and first["assigned"] and not first["rejected"], first
    assert (spool / "done/qinghe-20261120-night-01.json").exists(), "bridge accepted the plugin's inbox file"
    print(java("kills"))
    second = bridge()
    quest = second["quests"][0]
    assert quest["status"] == "completed" and quest["progress"] == 3, second
    assert second["badSignalLines"] == 0, second
    print(java("consume"))
    print("roundtrip passed: inbox accepted, signals counted by the bridge, outbox completed, table reward owed once")
