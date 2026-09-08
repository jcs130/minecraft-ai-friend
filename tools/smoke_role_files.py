"""Exercise each project's real Qwen file tools without an LLM.

The installed native workspace loader supplies the tools and the installed
permission wrapper checks every call. Only two uniquely reserved QA files per
role are changed; cleanup refuses links, foreign paths or unexpected content.
Native governance audit records go to a disposable QA directory. Existing
policies, roles, model settings and game state are never changed.
"""
from __future__ import annotations
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
FILE_TOOLS = ('write_file', 'append_file', 'edit_file', 'read_file')
CONTAINERS = {'game': 'qiandengji-qwenpaw-1', 'operations': 'qiandengji-qwenpaw-ops-1'}


def require(value, message):
    if not value: raise ValueError(message)


def unlinked(path):
    path = Path(path)
    require(not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                    for p in (path, *path.parents)), 'linked_path_rejected')


def qa_path(folder, directory, nonce):
    require(directory in ('notes', 'memory') and re.fullmatch(r'[a-f0-9]{32}', nonce), 'invalid_qa_path')
    folder = Path(folder)
    path = folder / directory / ('qd-file-smoke-' + nonce + '.md')
    unlinked(path)
    require(path.resolve().is_relative_to(folder.resolve()), 'qa_path_outside_role')
    return path


def reserve(path):
    unlinked(path)
    created_directory = False
    try:
        path.parent.mkdir()
        created_directory = True
    except FileExistsError:
        require(path.parent.is_dir(), 'qa_parent_not_directory')
    unlinked(path)
    with path.open('x', encoding='utf-8'):
        pass
    return created_directory


def clean_file(folder, directory, nonce, known_contents, *, created_directory=False):
    path = qa_path(folder, directory, nonce)
    require(path.is_file() and path.stat().st_size < 8192, 'qa_cleanup_file_missing_or_large')
    require(path.read_text(encoding='utf-8-sig') in known_contents, 'qa_cleanup_content_changed')
    path.unlink()
    if created_directory:
        try:
            path.parent.rmdir()  # Exact directory, and only if still empty.
        except OSError:
            pass
    return not path.exists()


async def exercise_file(folder, directory, nonce, invoke):
    path = qa_path(folder, directory, nonce)
    marker = 'QIANDENG-FILE-QA:' + nonce
    initial = marker + '\n初始观察：fixture_only\n'
    appended = initial + '复盘记录：native_append\n'
    final = appended.replace('fixture_only', 'verified_edit')
    owned = False; made_dir = False
    row = {'directory': directory, 'qaFile': str(path), 'nativeCalls': [], 'ok': False, 'cleaned': False}
    try:
        made_dir = reserve(path); owned = True
        # Cover relative and absolute native path resolution in every role.
        argument = str(path.relative_to(folder)) if directory == 'notes' else str(path)
        steps = [('write_file', {'file_path': argument, 'content': initial}),
                 ('append_file', {'file_path': argument, 'content': '复盘记录：native_append\n'}),
                 ('edit_file', {'file_path': argument, 'old_text': 'fixture_only', 'new_text': 'verified_edit'}),
                 ('read_file', {'file_path': argument})]
        for name, arguments in steps:
            result = await invoke(name, arguments)
            state = getattr(result.state, 'value', result.state)
            row['nativeCalls'].append({'tool': name, 'state': state})
            require(state == 'success', name + '_native_failed')
        text = '\n'.join(c.text for c in result.content if getattr(c, 'type', None) == 'text')
        require(all(line in text for line in final.splitlines()) and 'fixture_only' not in text,
                'native_readback_mismatch')
        require(path.read_text(encoding='utf-8-sig') == final, 'filesystem_readback_mismatch')
        row.update(ok=True, readbackSha256=hashlib.sha256(final.encode()).hexdigest())
    except Exception as exc:
        row['error'] = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
    finally:
        if owned:
            try:
                row['cleaned'] = clean_file(folder, directory, nonce, {'', initial, appended, final}, created_directory=made_dir)
            except Exception as exc:
                row.update(ok=False, cleanupError=str(exc) if isinstance(exc, ValueError) else type(exc).__name__)
    return row


async def container_check(runtime, nonce, check_only):
    require(os.environ.get('QIANDENG_ROLE_FILES_QA') == '1', 'qa_entrypoint_only')
    require(runtime in CONTAINERS and re.fullmatch(r'[a-f0-9]{32}', nonce), 'qa_arguments_invalid')
    sys.path.insert(0, '/ops')
    from qwenpaw.config.config import load_agent_config
    from qwenpaw.config.context import set_current_workspace_dir
    from qwenpaw.governance.resource_governor import ResourceGovernor
    from qwenpaw.governance.policy import load_governance_policy
    from qwenpaw.runtime.tool_registry import ToolRegistry, get_builtin_tool_funcs
    from qwenpaw.app.workspace.local_workspace import QwenPawLocalWorkspace
    from agentscope.permission import PermissionBehavior
    from role_learning_profiles import roles, validate_guard
    import qwenpaw.agents.tools  # Registers the real official descriptors.
    import native_tool_runtime
    base = Path('/state/work')
    require(validate_guard(base, runtime), 'running_native_guard_unverified')
    native_tool_runtime.install(runtime)
    expected_roles = roles(runtime)
    enabled = {k for k, v in json.loads((base / 'config.json').read_text())['agents']['profiles'].items() if v.get('enabled') is True}
    require(enabled == set(expected_roles), 'registered_role_set_mismatch')
    registry = ToolRegistry()
    registry.register_many(fn._tool_descriptor for fn in get_builtin_tool_funcs())
    rows = []
    with tempfile.TemporaryDirectory(prefix='qd-role-file-audit-') as audit:
        for role in expected_roles:
            folder = base / 'workspaces' / role
            set_current_workspace_dir(folder)
            profile = load_agent_config(role)
            governor = ResourceGovernor(str(folder))
            policy_before = hashlib.sha256(governor._policy_path.read_bytes()).hexdigest() if governor._policy_path.exists() else None
            # Load the exact current native policy, avoiding start()'s policy
            # rewrite. Only audit storage is redirected; decisions are native.
            governor._policy = load_governance_policy(str(governor._policy_dir), str(folder))
            governor._governance_dir = Path(audit)
            workspace = QwenPawLocalWorkspace(registry, workdir=str(folder), workspace_id=role)
            workspace.set_governor(governor)
            request = {'agent_id': role, 'session_id': 'file-qa-' + nonce,
                       'approval_level': profile.approval_level}
            tools = {t.name: t for t in await workspace.list_tools(agent_config=profile,
                agent_id=role, request_context=request)}
            require(set(FILE_TOOLS) <= tools.keys(), 'native_file_tools_not_exposed_' + role)
            permissions = []
            for directory in ('notes', 'memory'):
                for name in FILE_TOOLS:
                    args = {'file_path': str(qa_path(folder, directory, nonce)),
                            'content': 'fixture', 'old_text': 'fixture', 'new_text': 'verified'}
                    decision = await asyncio.wait_for(tools[name].check_permissions(args), 5)
                    permissions.append({'directory': directory, 'tool': name, 'allowed': decision.behavior == PermissionBehavior.ALLOW})
            require(all(p['allowed'] for p in permissions), 'native_permission_blocked_' + role)
            other = next(value for value in expected_roles if value != role)
            for name, target in [('read_file', str(base / 'workspaces' / other / 'notes/qd-file-qa.md')),
                                 ('write_file', 'agent.json')]:
                decision = await asyncio.wait_for(tools[name].check_permissions({'file_path': target, 'content': 'fixture'}), 5)
                require(decision.behavior == PermissionBehavior.DENY, 'native_boundary_not_denied_' + role)
            async def invoke(name, arguments):
                decision = await asyncio.wait_for(tools[name].check_permissions(arguments), 5)
                require(decision.behavior == PermissionBehavior.ALLOW, 'native_permission_denied_' + name)
                return await asyncio.wait_for(tools[name](**arguments), 8)
            files = [] if check_only else [await exercise_file(folder, directory, nonce, invoke) for directory in ('notes', 'memory')]
            policy_after = hashlib.sha256(governor._policy_path.read_bytes()).hexdigest() if governor._policy_path.exists() else None
            require(policy_after == policy_before, 'policy_changed_during_qa')
            rows.append({'role': role, 'nativeExposedTools': list(FILE_TOOLS), 'permissions': permissions,
                'crossRoleReadDenied': True, 'managedWriteDenied': True, 'policyUnchanged': True,
                'policySource': 'existing native policy' if policy_before else 'native defaults for uninitialized role',
                'files': files, 'ok': all(f['ok'] and f['cleaned'] for f in files)})
            set_current_workspace_dir(None)
    return {'runtime': runtime, 'ok': all(r['ok'] for r in rows), 'roles': rows,
            'guardRuntimeMarkerVerified': True, 'modelCalls': 0, 'gameActions': 0,
            'checkOnly': check_only, 'evidence': 'Native workspace tool loader, real permission wrapper and native file implementations in existing container; no model session',
            'nativeAuditLocation': 'disposable QA directory; current policy loaded without rewriting'}


def run(runtime, nonce, check_only):
    command = ['docker', 'exec', '-i', '-e', 'QIANDENG_ROLE_FILES_QA=1',
               '-e', 'PYTHONDONTWRITEBYTECODE=1', CONTAINERS[runtime], 'python', '-',
               '--container-check', runtime, '--nonce', nonce]
    if check_only: command.append('--check-only')
    result = subprocess.run(command, input=Path(__file__).read_text(encoding='utf-8'),
        capture_output=True, text=True, encoding='utf-8', timeout=60,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    require(result.returncode == 0, 'native_qa_process_failed_' + runtime + ':' + result.stderr[-1400:])
    output = [line for line in result.stdout.splitlines() if line.startswith('{')]
    require(output, 'native_qa_receipt_missing')
    return json.loads(output[-1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--container-check', choices=list(CONTAINERS), help=argparse.SUPPRESS)
    parser.add_argument('--nonce', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.container_check:
        print(json.dumps(asyncio.run(container_check(args.container_check, args.nonce, args.check_only)), ensure_ascii=False))
        return 0
    nonce = uuid.uuid4().hex
    receipts = [run(runtime, nonce, args.check_only) for runtime in CONTAINERS]
    report = {'schema': 1, 'ok': all(r['ok'] for r in receipts), 'recordedAt': datetime.now(timezone.utc).isoformat(),
              'nonce': nonce, 'modelCalls': 0, 'gameActions': 0, 'runtimes': receipts,
              'toolSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    target = ROOT / 'reports/role-files-smoke.json'
    unlinked(target); target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'roles': sum(len(r['roles']) for r in receipts),
        'qaFiles': sum(len(row['files']) for r in receipts for row in r['roles']),
        'modelCalls': 0, 'gameActions': 0, 'report': str(target)}, ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
