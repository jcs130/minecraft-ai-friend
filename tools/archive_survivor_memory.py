"""Offline, reversible memory-generation cutover for the existing Kirito only.

Run preview first; --apply requires drained/stopped game Qwen, survivor and NPC.
Archives live outside the Qwen workspace/mount. No model calls, world mutations,
credential printing, database edits, session replay or agent identity replacement.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from numen_gateway import read_json, write_json

EXPERIENCE = ('memory', 'digest', 'notes', 'mem_agent', 'mem_session', 'mem_metadata',
              'resource', 'sessions', 'dialog', 'tool_results', 'checkpoints',
              'jobs_history', 'life-review', 'drafts', 'learning', 'state',
              'history.db', 'history.db-wal', 'history.db-shm', 'MEMORY.md', 'chats.json',
              '.last-action.json', '.action-result.json')
STATE_EXPERIENCE = ('memory.json', 'behavior-context.json', 'conversation-intent.json',
                    'life-cycle.json',
                    'focus-notes', 'crystallization-hint.json', 'stagnation-state.json',
                    'pattern-cooldown.json', 'environment-penalty-cooldown.json')


def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            raise ValueError('archive_links_not_supported')
        if path.is_file():
            data = path.read_bytes()
            result[path.relative_to(root).as_posix()] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    return result


def require_stopped(root):
    for container in ('qiandengji-qwenpaw-1', 'qiandengji-survivor-1', 'qiandengji-npc-1'):
        value = subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Running}}', container],
                                        timeout=15, text=True).strip()
        if value != 'false':
            raise ValueError('offline_archive_requires_stopped_' + container)


def _move_exact(source_root, destination_root, name):
    source = (source_root / name).resolve()
    destination = (destination_root / name).resolve()
    # Verify both resolved absolute targets before any directory move.
    if (source == source_root.resolve() or not source.is_relative_to(source_root.resolve())
            or not destination.is_relative_to(destination_root.resolve())):
        raise ValueError('archive_path_escape')
    if source.exists():
        if destination.exists():
            raise ValueError('archive_destination_exists')
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.rename(destination)


def archive(root, *, apply=False, stopped=require_stopped):
    root = Path(root).resolve()
    workspace = root / 'server/agents/work/workspaces/qd-survivor'
    state = root / 'server/survival-agent-state/survival'
    settings = read_json(state / 'settings.json')
    profile = read_json(workspace / 'agent.json')
    if profile.get('id') != 'qd-survivor' or profile.get('workspace_dir') != '/state/work/workspaces/qd-survivor':
        raise ValueError('original_survivor_required')
    memory = profile.get('running', {}).get('reme_light_memory_config', {})
    expected = {'metadata_dir': 'mem_metadata', 'session_dir': 'mem_session', 'mem_session_dir': 'mem_agent',
                'resource_dir': 'resource', 'daily_dir': 'memory', 'digest_dir': 'digest'}
    if any(memory.get(key) != value for key, value in expected.items()):
        raise ValueError('review_actual_memory_paths_before_archiving')
    if profile.get('running', {}).get('light_context_config', {}).get('scroll_config', {}).get('db_filename') != 'history.db':
        raise ValueError('review_actual_history_path_before_archiving')
    marker = workspace / 'embodiment.json'
    if settings.get('brainProtocol') == 1:
        if not marker.is_file() or read_json(marker).get('memoryEpoch') != settings.get('memoryEpoch'):
            raise ValueError('incomplete_memory_cutover')
        return {'ok': True, 'alreadyApplied': True, 'memoryEpoch': settings['memoryEpoch'], 'modelCalls': 0}
    result = {'ok': True, 'applied': False, 'role': 'qd-survivor', 'modelCalls': 0,
              'worldActions': 0, 'archivePaths': [name for name in EXPERIENCE if (workspace / name).exists()],
              'preserves': ['identity', 'personality', 'body', 'inventory', 'model', 'skills', 'raw_action_receipts', 'usage']}
    if not apply:
        return result
    stopped(root)
    control, controller = read_json(state / 'control.json'), read_json(state / 'controller.json')
    job = read_json(state / 'skill-job.json') if (state / 'skill-job.json').exists() else {}
    if (control.get('enabled') is not False or controller.get('active') or controller.get('dialogueActive')
            or job.get('status') in ('pending', 'running', 'dispatching')
            or (state / 'unknown.json').exists() or (state / 'inflight-action.json').exists()
            or (read_json(state / 'lease.json') or {}).get('status') not in ('closed', 'used')):
        raise ValueError('drained_idle_controller_required')
    existing = root / 'runtime/embodied-agent-cutover.json'
    if existing.exists() and read_json(existing).get('phase') != 'completed':
        raise ValueError('previous_cutover_needs_recovery')
    now = datetime.now(timezone.utc)
    epoch = 'embodied-' + uuid.uuid4().hex
    backup = root / 'runtime/embodied-agent-archives' / (now.strftime('%Y%m%dT%H%M%S%fZ') + '-' + epoch)
    if backup.is_relative_to(workspace) or not backup.is_relative_to(root / 'runtime'):
        raise ValueError('archive_must_be_outside_workspace')
    backup.mkdir(parents=True, exist_ok=False)
    journal = {'schema': 1, 'phase': 'backing_up', 'memoryEpoch': epoch, 'archive': str(backup),
               'createdAt': int(now.timestamp() * 1000)}
    write_json(existing, journal)
    for name, directory in (('workspace', workspace), ('survival', state)):
        before = inventory(directory)
        shutil.copytree(directory, backup / name)
        if inventory(backup / name) != before or inventory(directory) != before:
            raise ValueError('archive_copy_verification_failed')
        write_json(backup / (name + '-manifest.json'), before)
    journal['phase'] = 'backed_up'
    write_json(existing, journal)
    stopped(root)
    if read_json(state / 'settings.json') != settings or read_json(workspace / 'agent.json') != profile:
        raise ValueError('concurrent_configuration_change')
    # All original bytes remain in the verified backup and the moved quarantine.
    for name in EXPERIENCE:
        _move_exact(workspace, backup / 'quarantine/workspace', name)
    for name in STATE_EXPERIENCE:
        _move_exact(state, backup / 'quarantine/survival', name)
    journal['phase'] = 'quarantined'
    write_json(existing, journal)
    write_json(workspace / 'chats.json', {'version': 1, 'chats': [], 'groups': []})
    (workspace / 'memory').mkdir(exist_ok=True)
    (workspace / 'notes').mkdir(exist_ok=True)
    (workspace / 'MEMORY.md').write_text('# 当前经验代\n\n旧经历已离线归档。先根据当前感知建立认识；来源与条件写入新记录。\n', encoding='utf8')
    (workspace / 'memory/goals.md').write_text('# 目标\n\n先观察当前身体和环境，再自主选择有限、可验证的阶段目标。尚无本代已完成目标。\n', encoding='utf8')
    (workspace / 'notes/index.md').write_text('# 资料索引\n\n本代尚无经验笔记。\n', encoding='utf8')
    (workspace / 'AGENTS.md').write_bytes((ROOT / 'world/survival/AGENT.md').read_bytes())
    reference = workspace / 'skills/qd-survivor-practice/references/embodiment.md'
    reference.parent.mkdir(parents=True, exist_ok=True)
    reference.write_bytes((ROOT / 'world/ops/skills/qd-survivor-practice/references/embodiment.md').read_bytes())
    # Keep budgeting/audit history, remove only cognition derived from old memory.
    for key in ('lastDecision', 'lastDecisionSignature', 'lastDecisionPosition', 'completedReviewId',
                'lastCompletedReviewId', 'nextReviewAt', 'lastReviewAt', 'slowVitalBaseline', 'observeAction',
                'crystallizationHint', 'stagnationHint', 'environmentPenaltyHint', 'adaptiveRouting'):
        controller.pop(key, None)
    controller.update(episodes=[], failures=0, nextDecisionAt=0, status='paused', memoryEpoch=epoch)
    write_json(state / 'controller.json', controller)
    if (state / 'perception.json').exists():
        perception = read_json(state / 'perception.json')
        perception.update(pending=[])
        # Keep cursors/seen IDs: deleting them would replay old world messages.
        perception.pop('view', None)
        write_json(state / 'perception.json', perception)
    session = read_json(state / 'life-session.json')
    session.pop('freshFromDeath', None)
    session.update(chatId=None, hasCompletedTask=False, memoryEpoch=epoch)
    write_json(state / 'life-session.json', session)
    settings.update(contextProtocol=2, brainProtocol=1, memoryEpoch=epoch, memoryStartedAt=journal['createdAt'])
    write_json(state / 'settings.json', settings)
    write_json(state / 'memory.json', {'schema': 1, 'source': 'agent_learning_data', 'memoryEpoch': epoch, 'history': []})
    write_json(marker, {'schema': 1, 'brainProtocol': 1, 'memoryEpoch': epoch,
                        'startedAt': journal['createdAt'], 'legacyMemoryRetrieval': False})
    if read_json(workspace / 'agent.json') != profile:
        raise ValueError('unrelated_profile_change')
    journal['phase'] = 'completed'
    write_json(existing, journal)
    result.update(applied=True, archive=str(backup), memoryEpoch=epoch, hashVerified=True)
    write_json(backup / 'receipt.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, default=ROOT)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(archive(args.project_root, apply=args.apply), ensure_ascii=False))
