"""Shared role-skill, native driver and weekly-job contracts; no model requests."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re

from agent_learning import GAME_ROLES, OPS_ROLES, TOOL_NAMES, NAME, REV, LearningTools, managed_job
from native_role_capabilities import configure_native, validate_native, validate_native_skills

HERE = Path(__file__).resolve().parent
DRIVER = 'qd_learning'
SURVIVOR_QPM = 8
TEXT_ROLES = {'qd-villager-dialogue', 'qd-guild-planner', 'qd-maid-dialogue'}


def roles(runtime):
    if runtime not in ('game', 'operations'):
        raise ValueError('unknown_learning_runtime')
    return (*GAME_ROLES, *maid_roles()) if runtime == 'game' else OPS_ROLES


def maid_roles(path=None):
    path = Path(path or os.environ.get('MAID_ROLES_MANIFEST_FILE', '/maid-roles/roles.json'))
    if not path.exists():
        assert not os.environ.get('MAID_ROLES_MANIFEST_FILE'), 'registered maid manifest missing'
        return ()
    value = read_safe(path)
    ids = value['activeRoleIds']
    assert value['schema'] == 1 and value['bindingsValid'] is True and value['independentSessions'] is True
    assert isinstance(ids, list) and len(ids) <= 64 and len(ids) == len(set(ids)) == value['registeredCount']
    assert all(isinstance(role, str) and re.fullmatch(r'[A-Za-z0-9_-]{4,64}', role) and role not in GAME_ROLES for role in ids)
    return tuple(sorted(ids))


def role_skills(role, runtime, source=HERE):
    if role not in roles(runtime):
        raise ValueError('unknown_learning_role')
    filename = 'game-role-skills.json' if runtime == 'game' else 'operations-role-skills.json'
    manifest = json.loads((Path(source) / filename).read_text(encoding='utf-8-sig'))
    assert manifest['schema'] == 1 and set(manifest['roles']) == set(GAME_ROLES if runtime == 'game' else OPS_ROLES)
    result = manifest['roles'][role] if role in manifest['roles'] else manifest['roles']['qd-maid-dialogue']
    assert isinstance(result, list) and len(set(result)) == len(result) and 'qd-skill-evolution' in result
    assert all(isinstance(name, str) and re.fullmatch(r'qd-[a-z0-9-]{1,70}', name) for name in result)
    return result


def skill_references(name, source=HERE):
    """Small repository reference pages; native Qwen loads them only on demand."""
    assert re.fullmatch(r'qd-[a-z0-9-]{1,70}', name)
    root = Path(source) / 'skills' / name / 'references'
    assert not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (root, *root.parents))
    if not root.exists():
        return {}
    files = sorted(root.iterdir())
    assert len(files) <= 32
    result = {}
    for path in files:
        assert path.is_file() and not path.is_symlink() and re.fullmatch(r'[a-z0-9-]+\.md', path.name)
        assert 0 < path.stat().st_size <= 16384
        result[path.name] = path.read_text(encoding='utf-8')
    assert sum(len(body.encode('utf-8')) for body in result.values()) <= 131072
    return result


def learning_client(role, runtime):
    assert role in roles(runtime)
    return {'name': DRIVER, 'enabled': True, 'transport': 'stdio', 'command': 'python',
        'args': ['/ops/agent_learning_mcp.py', '--role', role, '--runtime', runtime], 'env': {}, 'tools': list(TOOL_NAMES)}


def learning_card(role, runtime):
    client = learning_client(role, runtime)
    return {'name': DRIVER, 'protocol': 'mcp', 'enabled': True,
        'endpoint': {key: client[key] for key in ('transport', 'command', 'args', 'env')}, 'credentials': {},
        'config': {'display_name': '本角色技能学习与每周维护', 'description': '角色固定；候选、校验、试用、反馈和受限市场参考'},
        'policy': {'default_effect': 'deny', 'rules': [
            {'subject': '*', 'effect': 'allow', 'target': {'kind': 'tool', 'name': name}} for name in TOOL_NAMES]}}


def with_learning(agent, role, runtime):
    assert agent['id'] == role and role in roles(runtime)
    result = deepcopy(agent)
    result.setdefault('mcp', {}).setdefault('clients', {})[DRIVER] = learning_client(role, runtime)
    if runtime == 'game' and role in TEXT_ROLES:
        result['running']['max_iters'] = 3
        result['running']['loop']['iteration'].update(enabled=True, max_iterations=3)
    if runtime == 'game' and role == 'qd-survivor':
        # Six-step progressive retrieval needs a final model response. The old
        # QPM4 limit timed out locally before step five; user authorized more
        # CodingPlan use for working functionality on 2026-09-08.
        result['running']['llm_max_qpm'] = SURVIVOR_QPM
    return configure_native(result, role)


def validate_learning_profile(agent, role, runtime):
    expected = learning_client(role, runtime)
    client = agent['mcp']['clients'][DRIVER]
    assert agent['id'] == role
    validate_native(agent, role)
    assert all(client.get(key) == value for key, value in expected.items())
    assert not client.get('url') and not client.get('headers') and not client.get('cwd')
    if runtime == 'game' and role in TEXT_ROLES:
        assert agent['running']['max_iters'] == 3
        assert agent['running']['loop']['iteration']['max_iterations'] == 3
    if runtime == 'game' and role == 'qd-survivor':
        assert agent['running']['llm_max_qpm'] == SURVIVOR_QPM


def validate_jobs(value, role, runtime):
    assert isinstance(value, dict) and isinstance(value.get('jobs'), list) and len(value['jobs']) == 1
    actual = value['jobs'][0]
    expected = managed_job(role, runtime)
    assert actual['id'] == expected['id'] and actual['meta'] == expected['meta']
    assert type(actual['enabled']) is bool and actual['task_type'] == expected['task_type']
    assert actual['text'] == expected['text'] and actual['save_result_to_inbox'] is False
    schedule = actual['schedule']
    assert schedule['type'] == 'cron' and schedule['timezone'] == 'Asia/Shanghai'
    assert re.fullmatch(r'20 (?:[0-9]|1[0-9]|2[0-3]) \* \* (?:mon|tue|wed|thu|fri|sat|sun)', schedule['cron'])
    assert all(actual['runtime'].get(key) == item for key, item in expected['runtime'].items())
    assert all(actual['dispatch'].get(key) == item for key, item in expected['dispatch'].items())
    assert not actual['dispatch'].get('meta')
    if runtime == 'game':
        assert actual.get('request') is None
    else:
        request = actual['request']
        assert request['input'] == expected['request']['input']
        for key in ('user_id', 'session_id'):
            assert request.get(key) in (None, expected['dispatch']['target'][key])


def read_safe(path):
    path = Path(path)
    assert not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents))
    assert path.is_file() and path.stat().st_size <= 262144
    return json.loads(path.read_text(encoding='utf-8-sig'))


def validate_guard(state, runtime, proc=Path('/proc')):
    """A stale startup marker or reused PID must not certify the cron guard."""
    marker = read_safe(Path(state) / 'learning-runtime.json')
    assert marker['schema'] == 1 and marker['runtime'] == runtime and marker['guardVersion'] == 1
    assert marker['nativeToolGuardVersion'] == 1
    assert marker['qwenVersion'] == '2.2.0' and marker['scheduler'] == 'native-qwen-cron'
    pid = marker['pid']
    assert type(pid) is int and pid > 0
    command = (Path(proc) / str(pid) / 'cmdline').read_bytes().split(b'\0')
    entry = b'/survival/game_service.py' if runtime == 'game' else b'/ops/learning_service.py'
    assert entry in command
    # Linux /proc start time disambiguates a recycled PID; boot time is seconds.
    boot = next(int(line.split()[1]) for line in (Path(proc) / 'stat').read_text().splitlines() if line.startswith('btime '))
    stat = (Path(proc) / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
    if 'processStartTicks' in marker or 'bootId' in marker:
        assert type(marker.get('processStartTicks')) is int and marker['processStartTicks'] == int(stat[19])
        assert marker.get('bootId') == (Path(proc) / 'sys/kernel/random/boot_id').read_text().strip()
    else:
        started = boot + int(stat[19]) / os.sysconf('SC_CLK_TCK')
        # Older startup markers use wall time. Docker/WSL boot-time rounding and
        # clock synchronization may shift the derived value a few seconds.
        assert -5 <= marker['startedAt'] - started < 120
    return True


def validate_role_skills(folder, role, runtime, source=HERE):
    folder = Path(folder)
    assert folder.name == role and read_safe(folder / 'agent.json')['id'] == role
    manifest = read_safe(folder / 'skill.json')
    entries = manifest['skills']
    expected = role_skills(role, runtime, source)
    for name in expected:
        row = entries[name]
        assert row['enabled'] is True and ('all' in row['channels'] or 'console' in row['channels'])
        path = folder / 'skills' / name / 'SKILL.md'
        assert not path.is_symlink() and path.read_bytes() == (Path(source) / 'skills' / name / 'SKILL.md').read_bytes()
        references = skill_references(name, source)
        deployed = skill_references(name, folder)
        assert deployed == references, 'managed skill references differ from repository'
    index_path = folder / 'learning/index.json'
    index = read_safe(index_path) if index_path.exists() else {'schema': 1, 'skills': {}}
    assert index['schema'] == 1 and isinstance(index['skills'], dict) and len(index['skills']) <= 8
    learned = index['skills']
    assert all(NAME.fullmatch(name) for name in learned)
    for name, row in entries.items():
        if name.startswith('qd-learned-'):
            assert name in learned and type(row['enabled']) is bool and row['enabled'] == learned[name]['enabled']
    for name, row in learned.items():
        assert name in entries and type(row['enabled']) is bool and entries[name]['enabled'] == row['enabled']
        revision = row['revision']
        assert isinstance(revision, str) and REV.fullmatch(revision)
        draft = read_safe(folder / 'learning/drafts' / name / (revision + '.json'))
        assert draft['name'] == name and draft['revision'] == revision
        body = {key: draft[key] for key in ('name', 'description', 'steps', 'tools', 'cases')}
        assert hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest() == revision
        assert (folder / 'skills' / name / 'SKILL.md').read_text(encoding='utf-8') == LearningTools.markdown(draft)
    native = validate_native_skills(folder, entries)
    return {'required': len(expected) + native, 'projectSkills': len(expected), 'builtinSkills': native,
            'referencePages': sum(len(skill_references(name, source)) for name in expected),
            'learned': len(learned), 'learnedEnabled': sum(row['enabled'] for row in learned.values())}


def validate_learning_workspace(folder, role, runtime, source=HERE):
    folder = Path(folder)
    validate_learning_profile(read_safe(folder / 'agent.json'), role, runtime)
    validate_jobs(read_safe(folder / 'jobs.json'), role, runtime)
    assert read_safe(folder / 'drivers/mcp/qd_learning.yaml') == learning_card(role, runtime)
    return validate_role_skills(folder, role, runtime, source)
