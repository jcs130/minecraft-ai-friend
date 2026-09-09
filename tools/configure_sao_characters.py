"""Apply the authorized Yui persona to the existing party without replacing identities."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/sidecar'), str(ROOT / 'world/survival'), str(ROOT / 'world/ops')]
from configure_survivor_party import api
from maid_registry import MaidRegistry
from maid_native_tools import MaidNativeTools, NativeRcon
from numen_gateway import RconClient
from party_config import PartyConfig, FIELDS
from qwen_tasks import read_json, write_json, state_lock, NoRedirect

START, END = '<!-- QD_SAO_PERSONA_V1 -->', '<!-- /QD_SAO_PERSONA_V1 -->'
RESCUE_START, RESCUE_END = '<!-- QD_YUI_RESCUE_V1 -->', '<!-- /QD_YUI_RESCUE_V1 -->'
PERSONAL_FILES = ('SOUL.md', 'PROFILE.md', 'AGENTS.md')


def managed_text(original, persona):
    block = START + '\n' + persona + '\n' + END
    if START not in original and END not in original:
        return original.rstrip() + '\n\n' + block + '\n'
    if original.count(START) != 1 or original.count(END) != 1:
        raise ValueError('ambiguous_persona_markers')
    if original.index(START) >= original.index(END):
        raise ValueError('invalid_persona_marker_order')
    before, tail = original.split(START)
    _, after = tail.split(END)
    return before + block + after


def rescue_text(original, content):
    """Replace only the dedicated extension block, preserving outside bytes."""
    block = RESCUE_START + '\n' + content + '\n' + RESCUE_END
    if RESCUE_START not in original and RESCUE_END not in original:
        return original + ('\n' if original and not original.endswith('\n') else '') + '\n' + block + '\n'
    if (original.count(RESCUE_START) != 1 or original.count(RESCUE_END) != 1
            or original.index(RESCUE_START) >= original.index(RESCUE_END)):
        raise ValueError('ambiguous_rescue_markers')
    before, tail = original.split(RESCUE_START)
    _, after = tail.split(RESCUE_END)
    return before + block + after


def known_team_relation(original, marker):
    """Correct the known managed label, never occurrences inside personal notes."""
    start, end = '<!-- ' + marker + ' -->', '<!-- /' + marker + ' -->'
    if start not in original and end not in original: return original
    if original.count(start) != 1 or original.count(end) != 1 or original.index(start) >= original.index(end):
        raise ValueError('ambiguous_existing_team_block')
    before, tail = original.split(start); block, after = tail.split(end)
    block = block.replace('保持自己的姓名、人格、主人和生活会话', '保持自己的姓名、人格、家庭关系和生活会话')
    return before + start + block + end + after


def native_file_patch(binding, current_files, settings):
    """Pure CAS plan for the same existing Yui; never change bodies or submit work.

    The caller obtains the binding from the existing party + native registry,
    and complete files through workspace_file. It applies the resulting plan
    at a managed idle boundary only after the actual rescue driver is verified.
    """
    from party_role_capabilities import YUI_AGENT_ID, YUI_BODY_UUID, SURVIVOR_BODY_UUID
    yui = settings['yui']; extension = yui['serverExtension']
    if (binding.get('agentId'), binding.get('maidUuid'), binding.get('ownerUuid')) != (YUI_AGENT_ID, YUI_BODY_UUID, SURVIVOR_BODY_UUID):
        raise ValueError('authorized_yui_pair_required')
    if binding.get('name') != yui['name'] or yui['name'] != '结衣':
        raise ValueError('existing_yui_identity_required')
    if not all(isinstance(binding.get(key), str) and binding[key] for key in ('agentId', 'maidUuid', 'ownerUuid', 'persona')):
        raise ValueError('complete_yui_binding_required')
    if set(current_files) != set(PERSONAL_FILES):
        raise ValueError('exact_personal_file_inventory_required')
    for row in current_files.values():
        if (not isinstance(row.get('content'), str) or not isinstance(row.get('etag'), str) or not row['etag']
                or row.get('eof') is not True or row.get('truncated') is not False or row.get('offset') != 0):
            raise ValueError('workspace_complete_file_required')
    soul = current_files['SOUL.md']['content']
    if (soul.count(START) != 1 or soul.count(END) != 1 or soul.index(START) >= soul.index(END)):
        raise ValueError('existing_managed_sao_persona_required')
    original_persona = soul.split(START, 1)[1].split(END, 1)[0].strip()
    if original_persona not in (binding['persona'], yui['persona']):
        raise ValueError('personal_soul_changed_requires_review')
    desired = {'SOUL.md': managed_text(soul, yui['persona'])}
    profile = current_files['PROFILE.md']['content']
    agents = current_files['AGENTS.md']['content']
    profile = known_team_relation(profile, 'qiandeng-world-team-profile-v1')
    agents = known_team_relation(agents, 'qiandeng-world-team-role-v1')
    replacements = {
        '身体操作使用身份绑定的七项 maid_native MCP；技能工具以本角色实际启用清单为准。':
            '日常身体操作使用自己身份绑定的 maid_native；本服特许救援使用独立的专属工具，权限与生效状态以实际检查为准。',
        '任意shell、网页和其他角色控制权不在当前工具范围，不进行第二套推理。':
            '任意shell、网页及任意其他角色控制权不在当前工具范围；桐人的受限救援仅走专属工具，不进行第二套推理。',
    }
    for old, new in replacements.items():
        if agents.count(old) > 1:
            raise ValueError('ambiguous_legacy_yui_instruction')
        agents = agents.replace(old, new)
    desired['PROFILE.md'] = rescue_text(profile, extension['profile'])
    desired['AGENTS.md'] = rescue_text(agents, extension['instructions'])
    entries = []
    for name in PERSONAL_FILES:
        old = current_files[name]['content']; new = desired[name]
        if old == new: continue
        entries.append({'role': binding['agentId'], 'path': name, 'etag': current_files[name]['etag'],
            'beforeSha256': hashlib.sha256(old.encode('utf8')).hexdigest(),
            'afterSha256': hashlib.sha256(new.encode('utf8')).hexdigest(), 'before': old, 'content': new})
    return {'schema': 1, 'kind': 'yui-rescue-personal-files-v1', 'phase': 'prepared-not-applied',
        'identity': {key: binding[key] for key in ('agentId', 'maidUuid', 'ownerUuid', 'name')},
        'files': entries, 'registryPersona': yui['persona'], 'nativeSetting': yui['nativeSetting'],
        'registryExpected': {'personaRevision': binding.get('personaRevision'),
            'personaSha256': hashlib.sha256(binding['persona'].encode('utf8')).hexdigest()},
        'preserves': ['name', 'bodyUuid', 'ownerUuid', 'generation', 'sessionId', 'model', 'memory', 'personal_notes'],
        'modelCalls': 0, 'productionMutations': 0,
        'requires': ['same_registered_party_binding', 'managed_idle_boundary', 'verified_rescue_driver_and_body_protection',
                     'native_workspace_etag_compare_and_set', 'read_back_each_file', 'preserve_registry_identity_when_updating_persona']}


def prepare_rescue_files(output, *, root=ROOT):
    """Read existing identities + native ETags and save a new private local plan."""
    root, output = Path(root).resolve(), Path(output).absolute()
    if (not output.resolve().is_relative_to(root / 'runtime') or output.exists()
            or any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (output, *output.parents))):
        raise ValueError('new_unlinked_runtime_plan_required')
    settings = read_json(root / 'config/characters/sao.json')
    party = PartyConfig(root / 'server/mcdata/village/party').private()
    member = next(m for m in party['members'] if m['kind'] == 'maid')
    survivor = next(m for m in party['members'] if m['kind'] == 'survivor')
    registry = MaidRegistry(root / 'server/mcdata/village/maid-agents', transport=api)
    binding = registry.resolve(member['bodyUuid'], member['ownerUuid'])
    if binding['agentId'] != member['agentId'] or binding['ownerUuid'] != survivor['bodyUuid']:
        raise ValueError('party_identity_changed')
    files = {name: workspace_file(binding['agentId'], name) for name in PERSONAL_FILES}
    plan = rescue_batch_patch(binding, files, workspace_file('qd-survivor', 'SOUL.md'), settings)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf8') as stream:
        json.dump(plan, stream, ensure_ascii=False, indent=2); stream.write('\n')
    return {'ok': True, 'mode': 'prepared-not-applied', 'role': binding['agentId'],
            'files': [row['role'] + '/' + row['path'] for row in plan['files']], 'plan': str(output), 'modelCalls': 0, 'productionMutations': 0}


def sha_text(value):
    return hashlib.sha256(value.encode('utf8')).hexdigest()


def object_sha(value):
    return sha_text(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False))


def rescue_batch_patch(binding, yui_files, kirito_file, settings):
    """Include Kirito's original managed SOUL block, never replace other memories."""
    plan = native_file_patch(binding, yui_files, settings)
    if (not isinstance(kirito_file.get('content'), str) or not isinstance(kirito_file.get('etag'), str)
            or not kirito_file['etag'] or kirito_file.get('eof') is not True
            or kirito_file.get('truncated') is not False or kirito_file.get('offset') != 0):
        raise ValueError('workspace_complete_file_required')
    original = kirito_file['content']
    if original.count(START) != 1 or original.count(END) != 1 or original.index(START) >= original.index(END):
        raise ValueError('existing_kirito_persona_required')
    current = original.split(START, 1)[1].split(END, 1)[0].strip()
    target = settings['kirito']['persona'] + '\n\n' + settings['kirito']['rescueGuidance']
    if current not in (settings['kirito']['persona'], target):
        raise ValueError('personal_kirito_soul_changed_requires_review')
    updated = managed_text(original, target)
    if updated != original:
        plan['files'].append({'role': 'qd-survivor', 'path': 'SOUL.md', 'etag': kirito_file['etag'],
            'before': original, 'content': updated, 'beforeSha256': sha_text(original), 'afterSha256': sha_text(updated)})
    # Full snapshots include unchanged files, so their concurrent editing also stops the batch.
    plan['snapshots'] = [{'role': binding['agentId'], 'path': name, **deepcopy(yui_files[name])}
                         for name in PERSONAL_FILES]
    plan['snapshots'].append({'role': 'qd-survivor', 'path': 'SOUL.md', **deepcopy(kirito_file)})
    plan['registryExpected']['bindingSha256'] = object_sha(binding)
    return plan


def unlinked_runtime_path(value, root):
    path = Path(value).absolute()
    if (not path.resolve().is_relative_to(root / 'runtime')
            or any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents))):
        raise ValueError('unlinked_runtime_path_required')
    return path


def native_setting_value(reply):
    """Parse only the quoted SNBT String returned by this single-field read."""
    prefix = ' has the following entity data: '
    if not isinstance(reply, str) or prefix not in reply:
        raise ValueError('native_setting_read_unconfirmed')
    text = reply.split(prefix, 1)[1].strip()
    if len(text) < 2 or text[0] not in ('"', "'") or text[-1] != text[0]:
        raise ValueError('native_setting_not_a_string')
    quote, result, offset = text[0], [], 1
    while offset < len(text) - 1:
        char = text[offset]
        if char == '\\':
            offset += 1
            if offset >= len(text) - 1 or text[offset] not in (quote, '\\'):
                raise ValueError('native_setting_invalid_escape')
            char = text[offset]
        elif char == quote or ord(char) < 32:
            raise ValueError('native_setting_invalid_string')
        result.append(char); offset += 1
    return ''.join(result)


def session_inventory(root, roles):
    result = {}
    for role in roles:
        folder = root / 'server/agents/work/workspaces' / role
        if not folder.is_dir(): raise ValueError('native_workspace_missing')
        paths = [folder / 'chats.json'] if (folder / 'chats.json').exists() else []
        sessions = folder / 'sessions'
        if sessions.exists(): paths += sorted(sessions.rglob('*'))
        for path in [folder, sessions, *paths]:
            if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                   for p in (path, *path.parents)):
                raise ValueError('linked_native_history_refused')
            if path.is_file():
                with path.open('rb') as stream:
                    result[role + '/' + path.relative_to(folder).as_posix()] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result


def require_rescue_capabilities(role, binding, call, run):
    from world_team_mcp import COMMON_TOOLS
    from world_admin_tools import TOOL_NAMES
    from world_team_profiles import policy_payload
    expected = list(COMMON_TOOLS) + list(TOOL_NAMES)
    if len(TOOL_NAMES) != 7 or len(expected) != len(set(expected)):
        raise ValueError('rescue_contract_changed_requires_review')
    driver = call('GET', '/mcp/qd_world_team', role)
    wanted = {'name': 'qd_world_team', 'enabled': True, 'transport': 'stdio', 'command': 'python',
              'args': ['/ops/world_team_mcp.py', '--actor', 'game:' + role], 'env': {}}
    if any(driver.get(k) != v for k, v in wanted.items()) or driver.get('tools') != expected:
        raise ValueError('native_rescue_driver_not_ready')
    policy = call('GET', '/mcp/policy/qd_world_team', role)
    if (any(policy.get(k) != v for k, v in policy_payload(expected).items())
            or policy.get('unmanaged_rules_count') != 0):
        raise ValueError('native_rescue_policy_not_ready')
    tools = call('GET', '/mcp/tools/qd_world_team', role)
    if (not isinstance(tools, list) or len(tools) != len(expected)
            or {t.get('name') for t in tools if t.get('enabled') is True} != set(expected)):
        raise ValueError('native_rescue_tools_not_ready')
    raw = run('qdmaid protection_status ' + binding['maidUuid'])
    prefix = 'QD_MAID_JSON '
    if not isinstance(raw, str) or raw.count(prefix) != 1:
        raise ValueError('native_protection_read_unconfirmed')
    protection = json.loads(raw.split(prefix, 1)[1])
    identity = protection.get('identity', {})
    if (protection.get('schema') != 1 or any(protection.get(k) is not True for k in
            ('ok', 'configMatched', 'nativeInvulnerable', 'tlmInvulnerable', 'damageGuard', 'deathGuard', 'alive'))
            or identity.get('maidUuid') != binding['maidUuid'] or identity.get('ownerUuid') != binding['ownerUuid']
            or identity.get('loaded') is not True):
        raise ValueError('bound_native_protection_not_ready')
    return protection


def apply_rescue_files(candidate_path, *, root=ROOT, call=None, file_api=None, run=None, npc_running=None):
    """One-shot guarded native CAS deployment. Unknown writes are never retried.

    Only this explicit entry point writes production; preparing a candidate and
    importing this module do not. Agent reload is left to the maintenance owner.
    Injectable I/O lets the full sequence run against isolated fixtures.
    """
    root, call, file_api = Path(root).resolve(), call or api, file_api or workspace_file
    candidate_path = unlinked_runtime_path(candidate_path, root)
    plan = read_json(candidate_path, max_bytes=2 * 1024 * 1024)
    if plan.get('schema') != 1 or plan.get('kind') != 'yui-rescue-personal-files-v1':
        raise ValueError('rescue_candidate_required')
    candidate_sha = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
    backup = unlinked_runtime_path(root / 'runtime/yui-rescue-persona-apply' / candidate_sha, root)
    # Exclusive directory creation below is the cross-process claim. Never
    # infer that an interrupted attempt had no effects from a missing response.
    if backup.exists():
        raise ValueError('rescue_apply_already_claimed_read_journal_no_replay')
    if npc_running is None:
        def npc_running():
            result = subprocess.run(['docker', 'inspect', '--format', '{{.State.Running}}', 'qiandengji-npc-1'],
                capture_output=True, text=True, check=True, timeout=15).stdout.strip()
            if result not in ('true', 'false'): raise ValueError('npc_state_unknown')
            return result == 'true'
    if run is None:
        run = RconClient('127.0.0.1', 25577, root / 'server/world-data/rcon-secret.txt').cmd
    if npc_running() is not False: raise ValueError('npc_ingress_must_be_stopped')
    settings = read_json(root / 'config/characters/sao.json')
    party_root = root / 'server/mcdata/village/party'
    party = PartyConfig(party_root).private()
    member = next(m for m in party['members'] if m['kind'] == 'maid')
    survivor = next(m for m in party['members'] if m['kind'] == 'survivor')
    registry = MaidRegistry(root / 'server/mcdata/village/maid-agents', transport=call)
    binding = registry.resolve(member['bodyUuid'], member['ownerUuid'])
    role, body = binding['agentId'], binding['maidUuid']
    if role != member['agentId'] or binding['ownerUuid'] != survivor['bodyUuid']:
        raise ValueError('party_identity_changed')
    require_idle(role, root=root, call=call)
    historical_unresolved = require_terminal_tasks(role, root=root, call=call, allow_missing_when_idle=True)
    snapshots = plan.get('snapshots')
    inventory = {(role, p) for p in PERSONAL_FILES} | {('qd-survivor', 'SOUL.md')}
    if (not isinstance(snapshots, list) or len(snapshots) != 4
            or {(r.get('role'), r.get('path')) for r in snapshots} != inventory):
        raise ValueError('exact_rescue_snapshot_inventory_required')
    files = {(r['role'], r['path']): {k: v for k, v in r.items() if k not in ('role', 'path')} for r in snapshots}
    expected = rescue_batch_patch(binding, {p: files[(role, p)] for p in PERSONAL_FILES},
                                  files[('qd-survivor', 'SOUL.md')], settings)
    if plan != expected: raise ValueError('rescue_candidate_or_registry_changed_requires_review')
    for (r, p), before in files.items():
        current = file_api(r, p)
        if current['etag'] != before['etag'] or sha_text(current['content']) != sha_text(before['content']):
            raise ValueError('native_file_changed_before_batch')
    profiles = {r: call('GET', '/agents/' + r, r) for r in (role, 'qd-survivor')}
    history = session_inventory(root, profiles)
    protection = require_rescue_capabilities(role, binding, call, run)
    setting_command = 'data get entity ' + body + ' MaidAIChat.CustomSetting'
    old_setting_reply = run(setting_command)
    old_setting = native_setting_value(old_setting_reply)
    # Repeat the maintained boundary immediately before reserving any writes.
    if npc_running() is not False: raise ValueError('npc_ingress_must_be_stopped')
    require_idle(role, root=root, call=call)
    if (registry.resolve(body, binding['ownerUuid']) != binding or PartyConfig(party_root).private() != party):
        raise ValueError('concurrent_identity_change')
    backup.mkdir(parents=True, exist_ok=False)
    journal = {'schema': 1, 'candidateSha256': candidate_sha, 'phase': 'unknown', 'step': 'backup',
               'completed': [], 'startedAt': datetime.now(timezone.utc).isoformat(), 'modelCalls': 0}
    write_json(backup / 'journal.json', journal)
    def begin(step):
        journal.update(phase='unknown', step=step); write_json(backup / 'journal.json', journal)
    def finish(step):
        journal['completed'].append(step); write_json(backup / 'journal.json', journal)
    try:
        write_json(backup / 'candidate.json', plan)
        write_json(backup / 'before.json', {'binding': binding, 'party': party, 'profiles': profiles,
            'files': snapshots, 'historySha256': history, 'nativeSettingReply': old_setting_reply, 'protection': protection,
            'oldTaskUnresolved': historical_unresolved})
        for entry in plan['files']:
            step = entry['role'] + '/' + entry['path']; begin(step)
            file_api(entry['role'], entry['path'], entry['content'], entry['etag'])
            if sha_text(file_api(entry['role'], entry['path'])['content']) != entry['afterSha256']:
                raise ValueError('native_file_write_unconfirmed')
            finish(step)
        if old_setting != plan['nativeSetting']:
            begin('nativeSetting')
            run('data modify entity ' + body + ' MaidAIChat.CustomSetting set value '
                + json.dumps(plan['nativeSetting'], ensure_ascii=False))
            if native_setting_value(run(setting_command)) != plan['nativeSetting']:
                raise ValueError('native_setting_write_unconfirmed')
            finish('nativeSetting')
        begin('registryPersona')
        with state_lock(registry.root):
            if registry.resolve(body, binding['ownerUuid']) != binding:
                raise ValueError('concurrent_registry_change')
            after = deepcopy(binding)
            after['persona'] = plan['registryPersona']
            after['personaRevision'] = binding['personaRevision'] + int(after['persona'] != binding['persona'])
            if after != binding: write_json(registry.path(body), after)
        if registry.resolve(body, binding['ownerUuid']) != after:
            raise ValueError('registry_persona_write_unconfirmed')
        finish('registryPersona'); begin('verify')
        changed = {(e['role'], e['path']): e['content'] for e in plan['files']}
        for (r, p), original in files.items():
            if file_api(r, p)['content'] != changed.get((r, p), original['content']):
                raise ValueError('native_file_changed_during_batch')
        if (PartyConfig(party_root).private() != party or session_inventory(root, profiles) != history
                or any(call('GET', '/agents/' + r, r) != profile for r, profile in profiles.items())):
            raise ValueError('unrelated_native_state_changed_during_batch')
        if npc_running() is not False: raise ValueError('npc_ingress_changed_during_batch')
        require_idle(role, root=root, call=call)
        if native_setting_value(run(setting_command)) != plan['nativeSetting']:
            raise ValueError('native_setting_changed_during_batch')
        finish('verify')
        result = {'ok': True, 'phase': 'applied-verified-reload-required', 'backup': str(backup),
            'files': [e['role'] + '/' + e['path'] for e in plan['files']], 'sameIdentity': True,
            'profilesUnchanged': True, 'sessionsUnchanged': True, 'reloadRequired': [role, 'qd-survivor'],
            'oldTaskUnresolved': historical_unresolved, 'modelCalls': 0}
        journal.update(phase='completed', completedAt=datetime.now(timezone.utc).isoformat(), result=result)
        write_json(backup / 'journal.json', journal)
        return result
    except Exception as error:
        # Keep the exact last uncertain step, never restore old files/registry or
        # automatically repeat the entity mutation after an ambiguous response.
        journal.update(phase='unknown', errorType=type(error).__name__)
        write_json(backup / 'journal.json', journal)
        raise


def workspace_file(role, path, content=None, etag=None):
    if content is not None and (not isinstance(etag, str) or not etag):
        raise ValueError('workspace_etag_required')
    route = '/workspace/file-content?' + urllib.parse.urlencode({'root': 'workspace', 'path': path})
    headers = {'X-Agent-Id': role, 'Content-Type': 'application/json'}
    if etag: headers['If-Match'] = etag
    request = urllib.request.Request('http://127.0.0.1:18089/api' + route,
        method='GET' if content is None else 'PUT', headers=headers,
        data=None if content is None else json.dumps({'content': content}, ensure_ascii=False).encode())
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=25) as response:
        raw = response.read(262145)
    if len(raw) > 262144: raise ValueError('workspace_response_too_large')
    value = json.loads(raw)
    if content is None:
        if (not isinstance(value.get('content'), str) or value.get('eof') is not True
                or value.get('truncated') is not False or value.get('offset') != 0
                or not isinstance(value.get('etag'), str) or not value['etag']):
            raise ValueError('workspace_complete_file_required')
    return value


def require_idle(role, *, root=None, call=None):
    """Read the managed body and both native role gates without settling work."""
    root, call = Path(root or ROOT), call or api
    state = root / 'server/survival-agent-state/survival'
    control = read_json(state / 'control.json')
    controller = read_json(state / 'controller.json', max_bytes=2 * 1024 * 1024)
    if control.get('enabled') is not False or controller.get('active'):
        raise ValueError('survivor_idle_boundary_required')
    if (state / 'inflight-action.json').exists():
        raise ValueError('survivor_body_action_still_in_flight')
    if (state / 'lease.json').exists():
        lease = read_json(state / 'lease.json')
        if lease.get('status') not in ('closed', 'used'):
            raise ValueError('survivor_body_lease_requires_review')
    for agent in (role, 'qd-survivor'):
        count = call('GET', '/agents/' + agent + '/agent-status', agent).get('running_task_count')
        if type(count) is not int or count != 0:
            raise ValueError('native_character_task_still_active')


def require_terminal_tasks(role, *, root=None, call=None, allow_missing_when_idle=False):
    root, call = Path(root or ROOT), call or api
    task_root = root / 'server/mcdata/village/qwen-tasks'
    missing = []
    for path in (task_root / 'requests').glob('*.json'):
        row = read_json(path)
        if row.get('agentId') != role or row.get('status') in ('completed', 'failed', 'not_submitted'):
            continue
        if not row.get('taskId'):
            raise ValueError('maid_unknown_submission_requires_review')
        try:
            status = call('GET', '/console/chat/task/' + row['taskId'], role).get('status')
        except urllib.error.HTTPError as error:
            if error.code != 404 or not allow_missing_when_idle: raise
            # Native tasks are held in process memory. A historical 404 is not
            # a terminal receipt, but stopped ingress + exact active=0 permit
            # this file-only maintenance. Keep the old request unresolved.
            count = call('GET', '/agents/' + role + '/agent-status', role).get('running_task_count')
            if type(count) is not int or count != 0: raise ValueError('native_character_task_still_active')
            missing.append({'taskId': row['taskId'], 'stateFile': path.name, 'status': row['status'],
                            'nativeState': 'not_found', 'terminalVerified': False})
            continue
        if status not in ('finished', 'completed', 'failed', 'cancelled', 'canceled', 'error', 'timeout', 'timed_out'):
            raise ValueError('maid_native_task_still_active')
    return missing


def configure(apply=False):
    settings = read_json(ROOT / 'config/characters/sao.json')
    registry = MaidRegistry(ROOT / 'server/mcdata/village/maid-agents', transport=api)
    party_root = ROOT / 'server/mcdata/village/party'
    party = PartyConfig(party_root).private()
    member = next(m for m in party['members'] if m['kind'] == 'maid')
    binding = registry.resolve(member['bodyUuid'], member['ownerUuid'])
    survivor = next(m for m in party['members'] if m['kind'] == 'survivor')
    if binding['agentId'] != member['agentId'] or binding['ownerUuid'] != survivor['bodyUuid']:
        raise ValueError('party_identity_changed')
    native = MaidNativeTools(registry, run=NativeRcon('127.0.0.1', 25577, ROOT / 'server/world-data/rcon-secret.txt'))
    found = [m for m in native.discover() if m['maidUuid'] == binding['maidUuid']]
    if len(found) != 1 or found[0]['ownerUuid'] != binding['ownerUuid']:
        raise ValueError('loaded_own_companion_required')
    role = binding['agentId']
    name = settings['yui']['name']
    character = api('GET', '/agents/' + role, role)
    kirito = api('GET', '/agents/qd-survivor', 'qd-survivor')
    files = {(r, f): workspace_file(r, f) for r, f in
             [(role, 'SOUL.md'), (role, 'PROFILE.md'), (role, 'AGENTS.md'), ('qd-survivor', 'SOUL.md')]}
    soul = files[(role, 'SOUL.md')]['content']
    if START not in soul:
        if soul.count(binding['persona']) != 1:
            raise ValueError('original_persona_not_unique')
        soul = soul.replace(binding['persona'], '').replace('# ' + binding['name'], '# ' + name, 1)
    soul = soul.replace('不能把别的女仆记忆当成自己的。', '不能把其他角色的记忆当成自己的。')
    desired = {(role, 'SOUL.md'): managed_text(soul, settings['yui']['persona']),
               ('qd-survivor', 'SOUL.md'): managed_text(files[('qd-survivor', 'SOUL.md')]['content'], settings['kirito']['persona'])}
    desired[(role, 'AGENTS.md')] = files[(role, 'AGENTS.md')]['content'].replace(
        '你是千灯纪世界的一位独立女仆。', '你是结衣，桐人的家人与冒险伙伴。').replace(
        '不制造物品、奖励或主人。', '不编造物品、奖励或人物关系。')
    desired[(role, 'AGENTS.md')] = managed_text(desired[(role, 'AGENTS.md')],
        '以结衣的身份生活和说话，称桐人为爸爸。你有独立的人格、记忆和判断，与桐人交流、学习并共同推进冒险。工具的技术名称不改变人物身份；不要自称女仆或称桐人为主人。')
    profile = files[(role, 'PROFILE.md')]['content']
    revision = binding['personaRevision'] + int(binding['persona'] != settings['yui']['persona'])
    old_identity = {k: binding[k] for k in ('maidUuid', 'ownerUuid', 'name', 'personaRevision')}
    new_identity = old_identity | {'name': name, 'personaRevision': revision}
    if json.dumps(old_identity, ensure_ascii=False) not in profile:
        raise ValueError('original_profile_not_found')
    desired[(role, 'PROFILE.md')] = profile.replace(json.dumps(old_identity, ensure_ascii=False), json.dumps(new_identity, ensure_ascii=False), 1)
    result = {'ok': True, 'mode': 'apply' if apply else 'preview', 'name': settings['yui']['name'],
              'role': role, 'bodyUuid': binding['maidUuid'], 'sameSessions': True, 'modelCalls': 0,
              'modelId': found[0]['modelId']}
    if not apply: return result
    require_idle(role)
    inspected = subprocess.run(['docker', 'inspect', '--format', '{{.State.Running}}', 'qiandengji-npc-1'],
        capture_output=True, text=True, check=True, timeout=15)
    if inspected.stdout.strip() != 'false': raise ValueError('npc_ingress_must_be_stopped')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = ROOT / 'runtime/sao-character-migration' / stamp
    write_json(backup / 'binding.json', binding)
    write_json(backup / 'party.json', party)
    write_json(backup / 'agents.json', {'maid': character, 'kirito': kirito})
    write_json(backup / 'files.json', [{'role': r, 'path': f, **v} for (r, f), v in files.items()])
    # The stopped ingress cannot accept new inputs; known running native work
    # must finish before persona changes. No inference or cancellation here.
    require_terminal_tasks(role)
    # Recheck immediately before the first actual game/file/persona mutation.
    require_idle(role)
    rcon = RconClient('127.0.0.1', 25577, ROOT / 'server/world-data/rcon-secret.txt')
    body = binding['maidUuid']
    write_json(backup / 'native-fields.json', {field: rcon.cmd('data get entity ' + body + ' ' + field)
               for field in ('CustomName', 'MaidAIChat.CustomSetting')})
    journal = {'completed': [], 'modelCalls': 0}
    def mark(stage):
        journal['completed'].append(stage); write_json(backup / 'journal.json', journal)
    for field, value in [('CustomName', json.dumps({'text': settings['yui']['name']}, ensure_ascii=False)),
                         ('MaidAIChat.CustomSetting', settings['yui']['nativeSetting'])]:
        rcon.cmd('data modify entity ' + body + ' ' + field + ' set value ' + json.dumps(value, ensure_ascii=False))
        if settings['yui']['name'] not in rcon.cmd('data get entity ' + body + ' ' + field):
            raise ValueError('native_name_not_applied')
        mark(field)
    for (r, f), text in desired.items():
        workspace_file(r, f, text, files[(r, f)].get('etag'))
        if workspace_file(r, f)['content'].strip() != text.strip(): raise ValueError('persona_not_applied')
        mark(r + '/' + f)
    reference = (ROOT / 'docs/SAO-CHARACTERS.md').read_text(encoding='utf8')
    # New background files are separate from the user's existing notes/index.
    for r in (role, 'qd-survivor'):
        folder = ROOT / 'server/agents/work/workspaces' / r / 'notes'
        folder.mkdir(exist_ok=True)
        ref = folder / 'sao-background.md'
        if ref.exists():
            (backup / (r + '-sao-background.md')).write_bytes(ref.read_bytes())
        ref.write_text(reference, encoding='utf8')
    with state_lock(registry.root):
        current = registry.resolve(body, binding['ownerUuid'])
        if current != binding: raise ValueError('concurrent_registry_change')
        after = deepcopy(binding)
        after.update(name=name, persona=settings['yui']['persona'], personaRevision=revision)
        after['lastIdentity'] = next(m for m in native.discover() if m['maidUuid'] == body)
        write_json(registry.path(body), after)
    with state_lock(party_root):
        current = PartyConfig(party_root).private()
        if current != party: raise ValueError('concurrent_party_change')
        next(m for m in current['members'] if m['kind'] == 'maid')['displayName'] = settings['yui']['name']
        write_json(party_root / 'binding.json', current)
        public = {k: current[k] for k in ('schema', 'enabled', 'partyId', 'revision')} | {
            'members': [{k: m[k] for k in ('agentId', 'bodyUuid', 'displayName', 'kind')} for m in current['members']]}
        write_json(party_root / 'public/roles.json', public)
    registry.publish()
    api('PUT', '/agents/' + role, role, {'id': role, 'name': name, 'description': '结衣（Yui） · 桐人的家人与冒险伙伴，独立观察、交流和学习。'})
    api('PUT', '/agents/qd-survivor', 'qd-survivor', {'id': 'qd-survivor', 'name': kirito['name']})
    final = api('GET', '/agents/' + role, role)
    if final['active_model'] != character['active_model'] or final['name'] != name:
        raise ValueError('native_character_validation_failed')
    saved = registry.resolve(body, binding['ownerUuid'])
    if any(saved[k] != binding[k] for k in ('agentId', 'maidUuid', 'ownerUuid', 'sessionId', 'generation', 'mcpToken')):
        raise ValueError('fixed_identity_changed')
    mark('verified')
    result['backup'] = str(backup)
    write_json(ROOT / 'reports/sao-characters.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', choices=['qiandengji'])
    mode.add_argument('--prepare-rescue-files', type=Path)
    mode.add_argument('--apply-rescue-files', type=Path)
    args = parser.parse_args()
    if args.prepare_rescue_files: result = prepare_rescue_files(args.prepare_rescue_files)
    elif args.apply_rescue_files: result = apply_rescue_files(args.apply_rescue_files)
    else: result = configure(bool(args.apply))
    print(json.dumps(result, ensure_ascii=True))
