"""Prepare a one-line sidebar label delta without editing a running configuration."""
from pathlib import Path
import argparse
import hashlib
import json

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
assert args.source.resolve() != args.output.resolve() and not args.output.exists()
before = args.source.read_bytes()
old = '<gray>委托</gray> <yellow>{quests_active}/{quests_max}</yellow>'.encode()
new = '<gray>接单</gray> <yellow>{quests_active}/{quests_max}</yellow>'.encode()
assert before.count(old) == 1 and new not in before, "Unexpected current sidebar; inspect instead of overwriting"
after = before.replace(old, new)
args.output.parent.mkdir(parents=True, exist_ok=True)
with args.output.open("xb") as stream:
    stream.write(after)
print(json.dumps(dict(beforeSha256=hashlib.sha256(before).hexdigest(), sha256=hashlib.sha256(after).hexdigest(),
                      changedOccurrences=1, sourceUnchanged=args.source.read_bytes()==before)))
