"""Merge only this world's namespaced starter contracts; preserve other quests."""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import shutil

from prepare import HERE, safe_child, write_json


def merge_quests(before, additions, update_owned=False):
    for key, value in additions.items():
        if not key.startswith("maw:"):
            raise ValueError("Unexpected quest namespace")
        if key in before and before[key] != value and not update_owned:
            raise ValueError("Existing quest differs: " + key)
    return {**before, **additions}


def install(root, additions, update_owned=False):
    root = Path(root).resolve()
    if not (root / "fabric263-lab.json").is_file():
        raise ValueError("Not the isolated instance")
    target = safe_child(root, "world/justquests/custom-quests.json")
    before = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
    after = merge_quests(before, additions, update_owned)
    if before == after:
        return {"changed": False, "quests": len(additions)}
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = target.with_name("custom-quests.before-" + stamp + ".json")
        with target.open("rb") as source, backup.open("xb") as copy:
            shutil.copyfileobj(source, copy)
    write_json(target, after)
    return {"changed": True, "quests": len(additions), "reload": "cold-start-recommended"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update-owned", action="store_true", help="Explicitly update only existing maw: quest definitions; backup first")
    args = parser.parse_args()
    config = json.loads((HERE / "deployment.local.json").read_text())
    additions = json.loads((HERE / "starter-quests.json").read_text(encoding="utf-8"))
    print(json.dumps(install(Path(config["server"]), additions, args.update_owned)))


if __name__ == "__main__":
    main()
