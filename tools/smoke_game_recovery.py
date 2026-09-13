"""Read-only live checks for the restored D-drive Docker game services.

This report describes service/protocol readiness, not human gameplay, WebGL
visual inspection, or successful autonomous actions. No model requests run.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import urllib.request

from check_mc_endpoints import probe
from runtime_layout import layout
from project import DEFAULT_SERVICES

ROOT = Path(__file__).resolve().parents[1]


def request(path):
    with urllib.request.urlopen("http://127.0.0.1:19091" + path, timeout=8) as response:
        data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError("Oversized public response")
        return json.loads(data)


def main():
    checks = {}
    record = {"schema": 1, "project": "qiandengji", "checkedAt": datetime.now(timezone.utc).isoformat(),
              "modelRequests": 0, "playerActions": 0, "checks": checks}
    try:
        storage = layout()
        checks["d_project_storage"] = {"ok": storage["allGameBindsWithinProject"] and storage["activeImagesReady"],
                                       "projectRoot": storage["projectRoot"]}
        for name, port in (("direct_game", 25567), ("agent_gate", 25701)):
            checks[name] = probe(port)
        session = request("/api/manage/session")
        checks["passwordless_management"] = {"ok": session.get("configured") is True
            and session.get("authenticated") is True and session.get("authMode") == "local",
            "authMode": session.get("authMode")}
        services = request("/api/manage/services").get("services", [])
        active = {row["id"]: row for row in services}
        checks["current_services"] = {"ok": set(active) == set(DEFAULT_SERVICES) and all(
            row.get("owned") is True and row.get("state") == "running"
            and row.get("health") in (None, "", "healthy") and row.get("restart") == "unless-stopped"
            for row in services), "count": len(active), "services": services}
        renderer = request("/api/eye/renderer")
        checks["renderer_ready"] = {"ok": renderer.get("ok") is True and renderer.get("observerOnline") is True
            and renderer.get("worldAvailable") is True, "visualRenderingTested": False}
        result = subprocess.run(["docker", "compose", "exec", "-T", "mc", "rcon-cli", "gamerule keepInventory"],
                                cwd=ROOT, capture_output=True, text=True, timeout=15,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        checks["death_keeps_inventory"] = {"ok": result.returncode == 0 and "currently set to: true" in result.stdout}
        with urllib.request.urlopen("http://127.0.0.1:8100/health", timeout=5) as response:
            tts = json.load(response)
        checks["gpu_kokoro"] = {"ok": tts.get("ok") is True and tts.get("engine") == "Kokoro-82M-v1.1-zh"
            and tts.get("device") == "cuda:0" and tts.get("textEmotionModelLoaded") is False}
        control = json.loads((ROOT / "server/survival-agent-state/survival/control.json").read_text("utf8"))
        record["survivorAutonomy"] = {"enabled": control.get("enabled"), "pauseReason": control.get("pauseReason"),
                                       "changedByThisProbe": False}
        record["ok"] = all(row["ok"] for row in checks.values())
    except Exception as error:
        record["ok"] = False
        record["errorType"] = type(error).__name__
    report = ROOT / "runtime/game-recovery-20260913/live-smoke.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf8")
    print(json.dumps({"ok": record["ok"], "checks": {name: row["ok"] for name, row in checks.items()},
                      "errorType": record.get("errorType"), "report": str(report)}, ensure_ascii=False))
    return 0 if record["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
