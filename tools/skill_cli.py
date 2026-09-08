"""Qiandengji Agent CLI: skill_cli.py --actor Naruto cast fireworks."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar/guard'))
from skill_cli_client import read_receipt, request_skill


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', default=os.environ.get('NUMEN_COMPANION'), help='Existing online player or Numen login; never spawns a body')
    parser.add_argument('--request-id', help='Reuse only to obtain the same command receipt, never replay')
    parser.add_argument('--receipt', help='Read an existing receipt without submitting')
    parser.add_argument('--timeout', type=float, default=20)
    parser.add_argument('command', nargs=argparse.REMAINDER, help='help | status | skills | spells [legacy|archive] | cast | cancel | skillbar | menu | waypoint | goto')
    args = parser.parse_args()
    try:
        if args.receipt:
            result = read_receipt(ROOT / 'server/world-data', args.receipt)
        else:
            if not args.actor:
                parser.error('--actor or NUMEN_COMPANION is required')
            # Quotes preserve a single shell argument containing spaces, including key=value.
            command = ' '.join(json.dumps(t, ensure_ascii=False) if any(c.isspace() for c in t) else t for t in args.command) or 'help'
            result = request_skill(ROOT / 'server/world-data', args.actor, command, args.timeout, args.request_id)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get('ok') else (75 if result.get('code') in ['pending', 'outcome_unknown'] else 1)
    except (OSError, ValueError) as e:
        print(json.dumps({'ok': False, 'code': 'client_error', 'summary': str(e)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError: pass
    raise SystemExit(main())
