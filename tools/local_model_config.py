"""Restore this user's existing model settings only into ignored local runtime.

Does not put credentials into the client pack, source tree, console or reports.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\config\touhou_little_maid\sites")
TARGET = ROOT / "server/mc/config/touhou_little_maid/sites"


def restore(source, target):
    if isinstance(source, dict) and isinstance(target, dict):
        for key, value in source.items():
            if key in ("secret_key", "api_key", "apiKey") and key in target:
                target[key] = value
            elif key in target:
                restore(value, target[key])
    elif isinstance(source, list) and isinstance(target, list):
        for left, right in zip(source, target):
            restore(left, right)


def main():
    changed = []
    for name in ("llm.json", "stt.json"):
        source = SOURCE / name
        target = TARGET / name
        if not source.is_file() or not target.is_file():
            continue
        original = json.loads(source.read_text(encoding="utf-8-sig"))
        local = json.loads(target.read_text(encoding="utf-8-sig"))
        restore(original, local)
        target.write_text(json.dumps(local, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        changed.append(name)
    print(json.dumps({"local_model_config_restored": changed,
                      "destination": str(TARGET), "included_in_distribution": False}))


if __name__ == "__main__":
    main()
