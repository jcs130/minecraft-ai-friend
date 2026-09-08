"""Check voice/ASR poll heartbeat without submitting speech or touching Minecraft."""
import argparse
import json
from pathlib import Path
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--max-age', type=float, default=120)
    args = parser.parse_args()
    try:
        data = json.loads(args.state.read_text(encoding='utf-8'))
        ok = 0 <= time.time() - data.get('updated_at', 0) <= args.max_age
    except (OSError, ValueError):
        ok = False
    print(json.dumps({'ok':ok}))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
