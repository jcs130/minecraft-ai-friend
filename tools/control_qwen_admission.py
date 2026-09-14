"""Pause fresh NPC model submissions inside the existing game NPC container.

Original requests keep their native status and may still be polled. This is an
operator maintenance control, not an Agent tool or a new scheduler.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time


def change(root, action, operation_id):
    from qwen_tasks import read_json, state_lock, write_json
    if action not in ('pause', 'resume') or not re.fullmatch('[a-z0-9][a-z0-9-]{7,79}', operation_id):
        raise ValueError('invalid_maintenance_operation')
    path = Path(root) / 'admission.json'
    with state_lock(Path(root)):
        old = read_json(path) if path.exists() else None
        if old is not None and (not isinstance(old, dict) or old.get('schema') != 1
                or old.get('operator') != 'project-maintenance' or type(old.get('paused')) is not bool):
            raise ValueError('invalid_existing_admission')
        if action == 'resume' and (old is None or old.get('operationId') != operation_id):
            raise ValueError('maintenance_operation_not_owned')
        if old and old['paused'] and old.get('operationId') != operation_id:
            raise ValueError('another_maintenance_is_active')
        if old and old.get('operationId') == operation_id and old['paused'] == (action == 'pause'):
            return old
        if old and old.get('operationId') == operation_id and action == 'pause':
            raise ValueError('completed_maintenance_requires_new_operation')
        value = {'schema': 1, 'operator': 'project-maintenance', 'operationId': operation_id,
                 'paused': action == 'pause', 'updatedAt': int(time.time() * 1000)}
        if old and old.get('operationId') == operation_id:
            value['pausedAt'] = old.get('pausedAt', old['updatedAt'])
        write_json(path, value)
        write_json(Path(root) / 'admission-history' / (operation_id + '-' + action + '.json'), value)
        return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('pause', 'resume'))
    parser.add_argument('operation_id')
    args = parser.parse_args()
    # No user-supplied path or host runtime: execute in Compose's NPC service.
    root = Path(os.environ.get('NPC_DATA_DIR', ''))
    if root != Path('/mcdata') or not (root / 'village/qwen-tasks').is_dir():
        raise ValueError('game_npc_container_required')
    sys.path.insert(0, '/opt/sidecar')
    print(json.dumps(change(root / 'village/qwen-tasks', args.action, args.operation_id)))


if __name__ == '__main__':
    main()
