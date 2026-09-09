"""Persistent specialists use the existing game Qwen API; no new agent runner."""
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4

from agent_learning import locked, read, write, NoRedirect

MANAGERS = frozenset(('game:mc-god', 'operations:default', 'operations:mc-god', 'game:qd-guild-planner'))
SPECIALIST_SKILLS = ('qd-skill-evolution', 'qd-minecraft-guide', 'qd-world-team')


def registry_path():
    return Path(os.environ.get('TEAM_SPECIALISTS_FILE', '/team/specialists.json'))


def specialists(path=None, *, include_pending=False):
    path = Path(path or registry_path())
    if not path.exists():
        return {}
    doc = read(path, 262144)
    if doc.get('schema') != 1 or not isinstance(doc.get('specialists'), dict):
        raise ValueError('invalid_specialist_registry')
    result = {}
    for role, row in doc['specialists'].items():
        if (not re.fullmatch(r'qd-specialist-[a-z0-9][a-z0-9-]{2,35}', role)
                or row.get('agentId') != role or row.get('runtime') != 'game'
                or row.get('recruitedBy') not in MANAGERS
                or row.get('status') not in ('provisioning', 'active')
                or not isinstance(row.get('name'), str) or not 1 <= len(row['name']) <= 80
                or not isinstance(row.get('profession'), str) or not 1 <= len(row['profession']) <= 600):
            raise ValueError('invalid_specialist_binding')
        if row['status'] == 'active' or include_pending:
            result[role] = row
    return result


def api(runtime, role, method, path, body=None):
    # Hosts are fixed Docker service names, never supplied by a model.
    base = {'game': 'http://qwenpaw:8088', 'operations': 'http://qwenpaw-ops:8088'}[runtime]
    req = urllib.request.Request(base + '/api' + path, method=method,
        headers={'Content-Type': 'application/json', 'X-Agent-Id': role},
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode())
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=40) as response:
        raw = response.read(2097153)
    if len(raw) > 2097152:
        raise ValueError('native_team_response_too_large')
    return json.loads(raw) if raw else None


def _file(request, role, path, content):
    route = '/workspace/file-content?' + urllib.parse.urlencode({'root': 'workspace', 'path': path})
    request('game', role, 'PUT', route, {'content': content})
    actual = request('game', role, 'GET', route)
    if actual.get('content') != content or actual.get('truncated'):
        raise ValueError('specialist_file_not_saved')


def _owns_native(native, row):
    """A pending registry claim never grants ownership of a coincident ID."""
    return (native.get('id') == row['agentId'] and native.get('name') == row['name']
            and native.get('description') == row['profession']
            and native.get('workspace_dir') == '/state/work/workspaces/' + row['agentId']
            and native.get('backend_settings', {}).get('qiandeng_recruitment') == row.get('creationToken')
            and isinstance(row.get('creationToken'), str) and len(row['creationToken']) == 32)


def install_builtin(request, role, name, expected, *, exists=None):
    """Use the target instance's native pool, preserving its builtin provenance."""
    if exists is None:
        exists = any(row['name'] == name for row in request('game', role, 'GET', '/skills'))
    if not exists:
        try:
            pooled = request('game', role, 'GET', '/skills/pool/' + name)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            request('game', role, 'POST', '/skills/pool/import-builtin',
                {'imports': [{'skill_name': name, 'language': 'zh'}], 'overwrite_conflicts': False})
            pooled = request('game', role, 'GET', '/skills/pool/' + name)
        if pooled.get('source') != 'builtin' or pooled.get('content') != expected:
            raise ValueError('specialist_builtin_pool_mismatch')
        request('game', role, 'POST', '/skills/pool/download',
            {'skill_name': name, 'targets': [{'workspace_id': role}], 'overwrite': False})
    actual = request('game', role, 'GET', '/skills/' + name)
    if actual.get('source') != 'builtin' or actual.get('content') != expected:
        raise ValueError('specialist_builtin_workspace_mismatch')
    if not actual.get('enabled'):
        request('game', role, 'POST', '/skills/' + name + '/enable')
        actual = request('game', role, 'GET', '/skills/' + name)
    if actual.get('enabled') is not True:
        raise ValueError('specialist_builtin_not_enabled')


def recruit(actor, key, name, profession, *, request=api, path=None):
    """An idempotent occupation slot. No arbitrary templates, skills or credentials."""
    if actor not in MANAGERS:
        raise ValueError('recruitment_requires_team_manager')
    if not isinstance(key, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,35}', key):
        raise ValueError('invalid_profession_key')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise ValueError('invalid_specialist_name')
    if not isinstance(profession, str) or not 1 <= len(profession.strip()) <= 600:
        raise ValueError('invalid_specialist_profession')
    name, profession = name.strip(), profession.strip()
    role = 'qd-specialist-' + key
    path = Path(path or registry_path())
    # A lock prevents two managers creating different people for the same slot.
    # On a lost response the next call reads the exact native ID before retrying.
    with locked(path.parent / 'recruitment'):
        inventory = specialists(path, include_pending=True)
        row = inventory.get(role)
        if row and (row['name'], row['profession']) != (name, profession):
            raise ValueError('profession_slot_already_has_different_identity')
        if row and row['status'] == 'active':
            native = request('game', role, 'GET', '/agents/' + role)
            if not _owns_native(native, row):
                raise ValueError('specialist_native_identity_changed')
            return {'ok': True, 'created': False, **row}
        listed = request('game', 'mc-god', 'GET', '/agents')['agents']
        existing = next((a for a in listed if a['id'] == role), None)
        if existing and not row:
            raise ValueError('unmanaged_native_id_collision')
        if row is None:
            # Use the current planner's existing model route, not a copied API key.
            planner = request('game', 'qd-guild-planner', 'GET', '/agents/qd-guild-planner')
            model = planner['active_model']
            row = {'agentId': role, 'runtime': 'game', 'name': name, 'profession': profession,
                'recruitedBy': actor, 'status': 'provisioning', 'createdAt': time.time(), 'activeModel': model,
                'creationToken': uuid4().hex}
            inventory[role] = row
            write(path, {'schema': 1, 'specialists': inventory})
        if existing is None:
            request('game', role, 'POST', '/agents', {'id': role, 'name': name,
                'description': profession, 'language': 'zh', 'skill_names': [], 'active_model': row['activeModel'],
                'backend_settings': {'qiandeng_recruitment': row['creationToken']}})
        native = request('game', role, 'GET', '/agents/' + role)
        if not _owns_native(native, row):
            raise ValueError('specialist_creation_identity_mismatch')
        status = request('game', role, 'GET', '/agents/' + role + '/agent-status')
        if status.get('running_task_count', 0):
            return {'ok': False, 'code': 'specialist_busy_retry_same_key', **row}
        from native_role_capabilities import configure_native, NATIVE_SKILLS, native_content
        from role_learning_profiles import learning_client, skill_references
        from world_team_profiles import client, policy_payload
        from mcp_configuration import configure_client
        from llm_runtime_policy import unrestricted_running
        configured = configure_native(native, role, runtime='game')
        configured['running'] = unrestricted_running(native['running'])
        request('game', role, 'PUT', '/agents/' + role, {'id': role, 'name': name, 'language': 'zh',
            'description': profession, **{k: configured[k] for k in ('tools', 'security', 'approval_level', 'running')},
            'heartbeat': {**native['heartbeat'], 'enabled': False}})
        skills = {s['name']: s for s in request('game', role, 'GET', '/skills')}
        root = Path(__file__).parent
        for skill in (*NATIVE_SKILLS, *SPECIALIST_SKILLS):
            if skill in NATIVE_SKILLS:
                install_builtin(request, role, skill, native_content(skill), exists=skill in skills)
            elif skill not in skills:
                body = {'name': skill, 'enable': True,
                    'content': (root / 'skills' / skill / 'SKILL.md').read_text(encoding='utf-8'),
                    'references': skill_references(skill)}
                request('game', role, 'POST', '/skills', body)
            elif not skills[skill].get('enabled'):
                request('game', role, 'POST', '/skills/' + skill + '/enable')
        # Identity and duties are created once for this new person, never cloned
        # from Kirito/Yui/admin workspaces (which contain bodies and credentials).
        _file(request, role, 'SOUL.md', f'# {name}\n\n你是千灯纪项目组的独立专业成员。职业职责：{profession}\n'
            '以实际证据、合作和持续学习完成工作。你没有游戏身体，不冒充玩家或其他角色，不虚构实测结果。\n')
        _file(request, role, 'PROFILE.md', f'# 个人资料\n\n姓名：{name}\n职业：{profession}\n项目身份：game:{role}\n')
        _file(request, role, 'AGENTS.md', '# 工作方式\n\n先按需读取 qd-world-team 和本次任务需要的技能。'
            'team_cases/team_case 读取分派工作，team_report/team_update 保存证据与交付。'
            '可以用原生文件工具保存 notes、草案和复盘；已有经验按索引逐页查阅，成熟方法用 make-skill 沉淀。'
            '任务由已有 QwenPaw 会话和后台任务执行，不启动常驻循环；需要持续职业时由负责人按需要分派。'
            '收到其他 Agent 求助后在当前任务答复并更新工单，不回调发件人。代码交天神、世界管理交女神、发布交策划。\n')
        clients = {'qd_learning': learning_client(role, 'game'), 'qd_world_team': client(role, 'game')}
        present = {c['key'] for c in request('game', role, 'GET', '/mcp')}
        def call(method, route, selected, body=None):
            return request('game', selected, method, route, body)
        for key_, item in clients.items():
            configure_client(call, role, key_, item, policy_payload(item['tools']), exists=key_ in present)
        current = request('game', role, 'GET', '/agents/' + role)
        mcp = current['mcp']; mcp.setdefault('clients', {}).update(clients)
        request('game', role, 'PUT', '/agents/' + role, {'id': role, 'name': name, 'language': 'zh', 'mcp': mcp})
        from agent_learning import managed_job
        job = managed_job(role, 'game')
        request('game', role, 'PUT', '/cron/jobs/' + job['id'], job)
        actual = request('game', role, 'GET', '/agents/' + role)
        if actual.get('mcp', {}).get('clients') != mcp['clients']:
            raise ValueError('specialist_driver_mirror_changed')
        row['status'] = 'active'
        row['readyAt'] = time.time()
        write(path, {'schema': 1, 'specialists': inventory})
        return {'ok': True, 'created': True, **row, 'modelCalls': 0, 'newDaemonProcesses': 0}
