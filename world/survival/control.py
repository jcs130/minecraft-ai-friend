"""Local operator commands inside the managed survivor container."""
import argparse
import time
from pathlib import Path
from numen_gateway import action_lock, read_json, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'pause', 'resume', 'mission', 'autonomy'])
    parser.add_argument('--text')
    args = parser.parse_args()
    state = Path('/state/survival')
    if args.action == 'status':
        import json
        print(json.dumps(read_json(Path('/public/survivor.json')), ensure_ascii=False))
        return
    with action_lock(state):
        control = read_json(state / 'control.json')
        if args.action == 'pause':
            control.update(enabled=False, pauseReason='operator_pause')
        elif args.action == 'resume':
            if (state / 'unknown.json').exists():
                raise ValueError('Reconcile the recorded uncertain action before resuming')
            current = read_json(state / 'controller.json')
            if current.get('active'):
                raise ValueError('Wait for native task cancellation before resuming')
            job = read_json(state / 'skill-job.json') if (state / 'skill-job.json').exists() else {}
            if job.get('status') == 'dispatching':
                raise ValueError('Reconcile interrupted skill dispatch before resuming')
            settings = read_json(state / 'settings.json')
            if not isinstance(settings.get('workArea'), dict):
                raise ValueError('Inspect and configure the work area first')
            control.update(enabled=True, pauseReason=None)
        elif args.action == 'autonomy':
            control.update(autonomous=True)
            control['mission'] = read_json(state / 'settings.json')['mission']
            control['missionChangedAt'] = int(time.time() * 1000)
        else:
            if not args.text or not 1 <= len(args.text) <= 1200:
                parser.error('--text must be a mission of 1–1200 characters')
            control['mission'] = args.text
            control['missionChangedAt'] = int(time.time() * 1000)
        write_json(state / 'control.json', control)
    print('Updated. The supervised loop will observe this within 15 seconds.')


if __name__ == '__main__':
    main()
