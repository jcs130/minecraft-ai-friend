"""Synchronize selected managed qd skills via native Qwen APIs; preview by default.

Use from a managed idle maintenance boundary. Each write checks native task
count, existing files use If-Match, new references use exclusive native upload,
and native enable scans the complete skill before it becomes available again.
No model request, direct workspace write, daemon, history reset or deleted file.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from configure_world_team import api, members, native_host, require_host, NoRedirect, PORTS
from role_learning_profiles import skill_references


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha(content):
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def unlinked(path):
    require(not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                    for p in (path, *path.parents)), 'linked_sync_path')
    return path


def sources(name, root=ROOT):
    require(isinstance(name, str) and re.fullmatch(r'qd-[a-z0-9-]{1,70}', name), 'managed_qd_skill_required')
    folder = unlinked(root / 'world/ops/skills' / name)
    content = unlinked(folder / 'SKILL.md').read_text(encoding='utf-8')
    require(0 < len(content.encode('utf-8')) <= 65536, 'managed_skill_size')
    result = {'SKILL.md': content}
    result.update({'references/' + p: v for p, v in skill_references(name, root / 'world/ops').items()})
    return result


def file_route(path):
    return '/workspace/file-content?' + urllib.parse.urlencode({'root': 'workspace', 'path': path, 'limit': 262144})


def read_file(call, runtime, role, path):
    try:
        row = call(runtime, 'GET', file_route(path), role)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    require(isinstance(row.get('content'), str) and row.get('eof') is True
            and row.get('truncated') is False and row.get('offset') == 0
            and isinstance(row.get('etag'), str) and row['etag'], 'complete_native_file_required')
    return row


def upload_reference(runtime, role, path, content):
    """No overwrite/rename policy: native O_EXCL reservation rejects collisions."""
    parent, name = path.rsplit('/', 1)
    require(re.fullmatch(r'[a-z0-9-]+\.md', name), 'managed_reference_name_required')
    boundary = 'qd-sync-' + uuid.uuid4().hex
    payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\n'
               'Content-Type: text/markdown; charset=utf-8\r\n\r\n').encode() + content.encode() + f'\r\n--{boundary}--\r\n'.encode()
    route = '/workspace/file-upload?' + urllib.parse.urlencode({'root': 'workspace', 'path': parent})
    request = urllib.request.Request(f'http://127.0.0.1:{PORTS[runtime]}/api' + route, method='POST',
        data=payload, headers={'X-Agent-Id': role, 'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=45) as response:
        raw = response.read(65537)
    require(len(raw) <= 65536, 'oversized_upload_response')
    row = json.loads(raw)
    require(row.get('files') and len(row['files']) == 1 and row['files'][0].get('status') == 'uploaded'
            and row['files'][0].get('path') == path, 'native_reference_creation_unconfirmed')


def sync(actors, names, *, apply=False, root=ROOT, call=api, upload=upload_reference):
    require(actors and len(actors) == len(set(actors)) and len(actors) <= 64, 'unique_selected_actors_required')
    require(names and len(names) == len(set(names)) and len(names) <= 32, 'unique_selected_skills_required')
    inventory = members()
    require(all(a in inventory for a in actors), 'registered_team_actor_required')
    desired = {name: sources(name, root) for name in names}
    rows = []
    for actor in actors:
        host = native_host(actor); runtime, role = host['runtime'], host['agentId']
        require_host(actor, runtime, role)
        profile = call(runtime, 'GET', '/agents/' + role, role)
        require(profile.get('id') == role, 'native_identity_mismatch')
        native_skills = call(runtime, 'GET', '/skills', role)
        existing = {s['name']: s for s in native_skills}
        status = call(runtime, 'GET', '/agents/' + role + '/agent-status', role)
        idle = type(status.get('running_task_count')) is int and status['running_task_count'] == 0
        for name, files in desired.items():
            old = {p: read_file(call, runtime, role, 'skills/' + name + '/' + p) for p in files}
            registered = name in existing
            require(registered == (old['SKILL.md'] is not None), 'skill_registration_file_disagrees')
            changes = [p for p, content in files.items() if old[p] is None or old[p]['content'] != content]
            if registered and changes:
                require(existing[name].get('enabled') is True, 'disabled_skill_update_requires_review')
                # Upload intentionally cannot create directories or silently overwrite.
                if any(p.startswith('references/') and old[p] is None for p in changes):
                    call(runtime, 'GET', '/workspace/tree?' + urllib.parse.urlencode(
                        {'root': 'workspace', 'path': 'skills/' + name + '/references', 'limit': 1}), role)
            rows.append({'actor': actor, 'nativeHost': host, 'name': name, 'idle': idle,
                         'existing': registered, 'enabledBefore': existing.get(name, {}).get('enabled'),
                         'changes': changes, 'before': old, 'profile': profile})
    public = lambda r: {k: r[k] for k in ('actor', 'nativeHost', 'name', 'idle', 'existing', 'enabledBefore', 'changes')}
    result = {'ok': True, 'mode': 'apply' if apply else 'preview', 'skills': [public(r) for r in rows],
              'modelCalls': 0, 'worldActions': 0, 'filesDeleted': 0, 'requiresManagedIdleBoundary': True}
    if not apply:
        return result
    require(all(r['idle'] for r in rows), 'native_role_busy')
    if not any(r['changes'] for r in rows):
        result['mode'] = 'noop'; return result
    folder = unlinked(root / 'runtime/team-skill-sync' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(parents=True, exist_ok=False)
    def write(name, value):
        (folder / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # The backup stays in ignored runtime and never prints credentials/profiles.
    write('before.json', {'rows': rows, 'sourceHashes': {n: {p: sha(v) for p, v in f.items()} for n, f in desired.items()}})
    journal = {'phase': 'claimed', 'completed': [], 'modelCalls': 0}
    write('journal.json', journal)
    def idle(r):
        host = r['nativeHost']; runtime, role = host['runtime'], host['agentId']
        require_host(r['actor'], runtime, role)
        current = call(runtime, 'GET', '/agents/' + role + '/agent-status', role)
        require(type(current.get('running_task_count')) is int and current['running_task_count'] == 0, 'native_role_became_busy')
    def mutation(r, method, route, payload=None, headers=None):
        idle(r)
        return call(r['nativeHost']['runtime'], method, route, r['nativeHost']['agentId'], payload, headers)
    try:
        for r in rows:
            if not r['changes']:
                continue
            name = r['name']; runtime, role = r['nativeHost']['runtime'], r['nativeHost']['agentId']
            require(sources(name, root) == desired[name], 'managed_sources_changed')
            journal['current'] = public(r); write('journal.json', journal)
            if not r['existing']:
                created = mutation(r, 'POST', '/skills', {'name': name, 'content': desired[name]['SKILL.md'],
                    'references': {p.removeprefix('references/'): v for p, v in desired[name].items() if p.startswith('references/')},
                    'enable': False})
                require(created.get('created') is True and created.get('name') == name, 'native_skill_creation_unconfirmed')
            else:
                disabled = mutation(r, 'POST', '/skills/' + name + '/disable')
                require(disabled.get('disabled') is True, 'native_skill_disable_unconfirmed')
                for p in r['changes']:
                    path = 'skills/' + name + '/' + p
                    old = r['before'][p]
                    if old is None:
                        idle(r); upload(runtime, role, path, desired[name][p])
                    else:
                        mutation(r, 'PUT', file_route(path), {'content': desired[name][p]}, {'If-Match': old['etag']})
                    current = read_file(call, runtime, role, path)
                    require(current and current['content'] == desired[name][p], 'native_file_readback_mismatch')
                    journal['completed'].append({'actor': r['actor'], 'skill': name, 'file': p, 'sha256': sha(current['content'])})
                    write('journal.json', journal)
                if 'SKILL.md' not in r['changes']:
                    # Qwen 2.2 scan cache keys use the skill directory and only
                    # its immediate files' mtimes. Editing references/ alone
                    # does not invalidate that signature. A native same-value
                    # save atomically replaces this immediate file without
                    # changing its content or bypassing optimistic concurrency.
                    path = 'skills/' + name + '/SKILL.md'
                    old = r['before']['SKILL.md']
                    mutation(r, 'PUT', file_route(path), {'content': old['content']}, {'If-Match': old['etag']})
                    current = read_file(call, runtime, role, path)
                    require(current and current['content'] == old['content']
                            and current['etag'] != old['etag'], 'native_scan_cache_invalidation_unconfirmed')
                    journal['completed'].append({'actor': r['actor'], 'skill': name, 'file': 'SKILL.md',
                        'sha256': sha(current['content']), 'nativeSameContentSaveForScan': True})
                    write('journal.json', journal)
            # This is a fresh native security scan, not merely manifest refresh.
            enabled = mutation(r, 'POST', '/skills/' + name + '/enable')
            require(enabled.get('enabled') is True, 'native_skill_scan_enable_unconfirmed')
            current_skills = call(runtime, 'GET', '/skills', role)
            require(any(v['name'] == name and v.get('enabled') is True for v in current_skills), 'skill_not_native_visible')
            for p, content in desired[name].items():
                row = read_file(call, runtime, role, 'skills/' + name + '/' + p)
                require(row and row['content'] == content, 'final_native_skill_drift')
            idle(r)
            current_profile = call(runtime, 'GET', '/agents/' + role, role)
            for key in ('id', 'name', 'language', 'workspace_dir', 'active_model', 'running', 'tools', 'mcp'):
                require(current_profile.get(key) == r['profile'].get(key), 'unrelated_role_configuration_changed:' + key)
            journal['completed'].append({'actor': r['actor'], 'skill': name, 'nativeScanAndReadbackVerified': True})
            write('journal.json', journal)
    except Exception as error:
        # Do not replay uncertain writes or restore over concurrent user edits.
        journal.update(phase='requires-review', errorType=type(error).__name__)
        write('journal.json', journal)
        raise
    journal['phase'] = 'verified'; write('journal.json', journal)
    result['backup'] = str(folder); write('result.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', action='append', required=True, help='Logical actor; repeat for multiple roles')
    parser.add_argument('--skill', action='append', required=True, help='Managed repository qd skill; repeat as needed')
    parser.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(sync(args.actor, args.skill, apply=bool(args.apply)), ensure_ascii=True))
