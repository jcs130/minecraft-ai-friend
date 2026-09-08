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
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/sidecar'), str(ROOT / 'world/survival')]
from configure_survivor_party import api
from maid_registry import MaidRegistry
from maid_native_tools import MaidNativeTools, NativeRcon
from numen_gateway import RconClient
from party_config import PartyConfig, FIELDS
from qwen_tasks import read_json, write_json, state_lock, NoRedirect

START, END = '<!-- QD_SAO_PERSONA_V1 -->', '<!-- /QD_SAO_PERSONA_V1 -->'


def managed_text(original, persona):
    block = START + '\n' + persona + '\n' + END
    if START not in original and END not in original:
        return original.rstrip() + '\n\n' + block + '\n'
    if original.count(START) != 1 or original.count(END) != 1:
        raise ValueError('ambiguous_persona_markers')
    before, tail = original.split(START)
    _, after = tail.split(END)
    return before + block + after


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


def require_terminal_tasks(role, *, root=None, call=None):
    root, call = Path(root or ROOT), call or api
    task_root = root / 'server/mcdata/village/qwen-tasks'
    for path in (task_root / 'requests').glob('*.json'):
        row = read_json(path)
        if row.get('agentId') != role or row.get('status') in ('completed', 'failed', 'not_submitted'):
            continue
        if not row.get('taskId'):
            raise ValueError('maid_unknown_submission_requires_review')
        status = call('GET', '/console/chat/task/' + row['taskId'], role).get('status')
        if status not in ('finished', 'completed', 'failed', 'cancelled', 'canceled', 'error', 'timeout', 'timed_out'):
            raise ValueError('maid_native_task_still_active')


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
    parser.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(configure(bool(args.apply)), ensure_ascii=True))
