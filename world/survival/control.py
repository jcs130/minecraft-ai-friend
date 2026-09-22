"""Local operator commands inside the managed survivor container."""
import argparse
import time
import uuid
from pathlib import Path
from numen_gateway import action_lock, read_json, read_controller_json, write_json


def update_control(state, action, text=None, clock=time.time):
    state = Path(state)
    # Drain may be requested while the current tool holds the action mutex.
    # Wait for that short critical section instead of losing the request.
    with action_lock(state, blocking=action == 'drain'):
        control = read_json(state / 'control.json')
        if action == 'pause':
            control.update(enabled=False, pauseReason='operator_pause')
        elif action == 'drain':
            if not control.get('drain') or control['drain'].get('status') != 'requested':
                current = read_controller_json(state / 'controller.json')
                active = current.get('active') or {}
                control['drain'] = {'requestId': uuid.uuid4().hex, 'status': 'requested',
                    'requestedAt': int(clock() * 1000), 'turnId': active.get('turnId'),
                    'taskId': active.get('taskId'), 'sessionId': active.get('sessionId')}
        elif action == 'resume':
            if (state / 'unknown.json').exists():
                raise ValueError('Reconcile the recorded uncertain action before resuming')
            current = read_controller_json(state / 'controller.json')
            if current.get('active') or current.get('dialogueActive'):
                raise ValueError('Wait for native task cancellation before resuming')
            job = read_json(state / 'skill-job.json') if (state / 'skill-job.json').exists() else {}
            if job.get('status') == 'dispatching':
                raise ValueError('Reconcile interrupted skill dispatch before resuming')
            settings = read_json(state / 'settings.json')
            if not isinstance(settings.get('workArea'), dict):
                raise ValueError('Inspect and configure the work area first')
            control.update(enabled=True, pauseReason=None)
            if control.get('drain'):
                control['lastDrain'] = control.pop('drain') | {'clearedAt': int(clock() * 1000)}
        elif action == 'autonomy':
            control.update(autonomous=True)
            control['mission'] = read_json(state / 'settings.json')['mission']
            control['missionChangedAt'] = int(clock() * 1000)
        else:
            if action != 'mission' or not text or not 1 <= len(text) <= 1200:
                raise ValueError('mission must be 1–1200 characters')
            control['mission'] = text
            control['missionChangedAt'] = int(clock() * 1000)
        write_json(state / 'control.json', control)
        return control


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'pause', 'drain', 'resume', 'mission', 'autonomy'])
    parser.add_argument('--text')
    args = parser.parse_args()
    if args.action == 'status':
        import json
        print(json.dumps(read_json(Path('/public/survivor.json')), ensure_ascii=False))
        return
    update_control(Path('/state/survival'), args.action, args.text)
    print('Updated. The supervised loop will observe this within 15 seconds.')


if __name__ == '__main__':
    main()
