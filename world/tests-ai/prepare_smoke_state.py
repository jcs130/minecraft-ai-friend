"""Prepare reserved QA data in this project's private snapshot only, while world is stopped."""
import argparse
import json
import os
from pathlib import Path
import time

QA_NAMES = ("QDSmokeProbe", "QDSmokeBody")


def prepare_project(project):
    project = Path(project).resolve()
    if "name: qiandengji" not in (project / "compose.yml").read_text(encoding="utf-8"):
        raise SystemExit("Refusing a non-qiandengji project")
    runtime = project / "server" / "world-data"
    mirror = project / "server" / "mcdata"
    paths = [runtime / "magic-state.json", mirror / "magic-state.json"]
    planned = []
    for path in paths:
        if not path.resolve().is_relative_to(project / "server"):
            raise SystemExit("State path escapes this project's private server directory")
        state = json.loads(path.read_text(encoding="utf-8"))
        if state.get("version") != 1 or not isinstance(state.get("players"), dict):
            raise SystemExit("Snapshot has no supported magic-state schema; import the complete save first")
        for name in QA_NAMES:
            old = state["players"].get(name)
            if old is not None:
                if old.get("fixtureOrigin") != "qiandengji-smoke":
                    raise SystemExit("Reserved QA name already has unowned state; refusing to overwrite it")
                # Upgrade only this fixture's retired test skill; preserve its other state.
                old['learned'] = list(dict.fromkeys(['feather_fall' if x == 'appraise' else x for x in old.get('learned', [])] + ['feather_fall']))
                old['skillbar'] = ['feather_fall' if x == 'appraise' else x for x in old.get('skillbar', [])]
                continue
            state["players"][name] = {
                "fixtureOrigin": "qiandengji-smoke", "mana": 100, "maxMana": 100,
                "maxManaBonus": 0, "learned": ["feather_fall"], "lastUpdate": int(time.time() * 1000),
                "innateSkill": None, "backstory": None, "level": 1, "hpRatio": 1,
                "foodRatio": 1, "passives": [], "passiveProgress": {}, "advancements": [],
                "advancementSkills": [], "skillbar": ["feather_fall"],
            }
        planned.append((path, state))
    for path, state in planned:
        temporary = path.with_name(path.name + f".smoke-{os.getpid()}.tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)
    (runtime / ".qiandengji-smoke").write_text("qiandengji\n", encoding="utf-8")
    return {"ok": True, "project": "qiandengji", "qaNames": QA_NAMES,
            "stateFilesPrepared": len(planned), "otherPlayerEntriesUnchanged": True}


def prepare():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world-stopped", action="store_true", required=True,
                        help="Confirm this project's world service is not running; never edit its live cache")
    parser.parse_args()
    print(json.dumps(prepare_project(Path(__file__).resolve().parents[2])))


if __name__ == "__main__":
    prepare()
