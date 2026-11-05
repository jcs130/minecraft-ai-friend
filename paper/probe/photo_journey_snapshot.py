"""Export only one owner's photo from an isolated server COPY. Read-only to server.

Requires PyYAML. Use a consistent saved/cold copy; it does not pause/stop a server.
The export is evidence of saved records, not of rendering or model autonomy.
"""
import argparse
import hashlib
import json
from pathlib import Path
import uuid
import yaml


def snapshot(server, owner, job):
    owner, job = str(uuid.UUID(owner)), str(uuid.UUID(job))
    root = Path(server) / "plugins/AgentFriend"
    raw = {name: (root / name).read_bytes() for name in ("photo-tasks.json", "photo-journal.json", "config.yml")}
    tasks = json.loads(raw["photo-tasks.json"])
    journal = json.loads(raw["photo-journal.json"])
    config = yaml.safe_load(raw["config.yml"])
    album = journal.get("players", {}).get(owner, {}).get("photos", {}).get(job)
    if not album or album.get("owner") != owner or album.get("id") != job:
        raise ValueError("No exact owner/job album original; do not substitute another photo")
    image = album["imageIndex"]
    rewards = config.get("photo-rewards", {}).get(owner, {})
    reward = rewards.get(str(image), rewards.get(image))
    if not reward:
        raise ValueError("No original native reward receipt")
    def map_ids(items):
        result = []
        for item in items:
            if isinstance(item, dict) and item.get("type") == "FILLED_MAP":
                count = item.get("amount", 1)
                if not isinstance(count, int) or not 1 <= count <= 64:
                    raise ValueError("invalid native stack amount")
                result.extend([item.get("meta", {}).get("map-id")] * count)
        return result
    contents = config.get("dungeon-personal-stash", {}).get(owner, {})
    return {"scope": "Saved owner-scoped records only; no actual camera/model claim", "album": album,
            "task": tasks.get("players", {}).get(owner, {}).get("photoTask"),
            "stash": {"owner": owner, "imageIndex": image, "mapIds": reward["map-ids"],
                      "storedMapIds": map_ids(contents.values()), "pendingMapIds": map_ids(reward.get("pending", []))},
            "sourceSha256": {name: hashlib.sha256(value).hexdigest() for name, value in raw.items()}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--server-copy", type=Path, required=True)
    p.add_argument("--owner", required=True)
    p.add_argument("--job", required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    result = snapshot(args.server_copy, args.owner, args.job)
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(result, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(json.dumps({"owner": args.owner, "job": args.job, "exported": True}))


if __name__ == "__main__":
    main()
