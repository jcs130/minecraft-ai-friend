"""Scoped offline repair of the operator-enabled survivor shell/tool guard.

The role's existing enabled tools, model, persona and MCP drivers are preserved.
Plan is read-only; apply requires both exact services stopped and body drained.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'world/ops'))
import native_role_capabilities as native
from sync_survivor_driver_scope import (FOLDER, atomic_bytes, read_document,
                                        require_idle, require_stopped, safe_path)

RELATIVE = FOLDER / 'agent.json'


def desired(agent, root=ROOT):
    marker = read_document(safe_path(root, Path('server/agents/work/learning-runtime.json')))[1]
    if marker.get('qwenVersion') != '2.2.1':
        raise ValueError('pinned_qwen_runtime_required')
    native_tools = (*native.FILE_TOOLS, 'get_current_time', 'execute_shell_command')
    with patch.object(native, 'package_version', return_value='2.2.1'), \
            patch.object(native, 'NATIVE_TOOLS', native_tools):
        expected = native.configure_native(agent, 'qd-survivor')
        native.validate_native(expected, 'qd-survivor')
    original = dict(expected)
    original['security'] = agent['security']
    if original != agent:
        raise ValueError('survivor_shell_scope_exceeded')
    actual_enabled = {name for name, row in agent['tools']['builtin_tools'].items()
                      if row.get('enabled') is True}
    if not native.SURVIVOR_EXTRA_TOOLS <= actual_enabled or 'execute_shell_command' not in actual_enabled:
        raise ValueError('operator_enabled_tools_changed')
    if ('execute_shell_command' in expected['security']['tool_guard']['guarded_tools']
            or set(expected['security']['tool_guard']['denied_tools']) & actual_enabled):
        raise ValueError('shell_guard_still_restricts_enabled_tools')
    return expected


def run(root=ROOT, *, apply=False):
    root = Path(root).absolute()
    path = safe_path(root, RELATIVE)
    raw, agent = read_document(path)
    expected = desired(agent, root)
    changed = expected != agent
    report = {'schema': 1, 'ok': True, 'mode': 'apply' if apply else 'plan',
              'role': 'qd-survivor', 'changed': changed,
              'allowedJsonPath': 'agent.json:/security', 'otherFieldsPreserved': True,
              'worldActions': 0, 'modelCalls': 0}
    if not apply:
        return report
    report['containers'] = require_stopped(root)
    report['bodyState'] = require_idle(root)
    if not changed:
        return report
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = safe_path(root, Path('runtime/survivor-shell-backups') / stamp)
    backup.mkdir(parents=True, exist_ok=False)
    saved = backup / 'agent.json'
    saved.write_bytes(raw)
    saved.chmod(0o600)
    if hashlib.sha256(saved.read_bytes()).digest() != hashlib.sha256(raw).digest():
        raise ValueError('survivor_shell_backup_mismatch')
    report['backup'] = str(backup)
    require_stopped(root); require_idle(root)
    if path.read_bytes() != raw:
        raise ValueError('survivor_agent_changed_during_plan')
    try:
        atomic_bytes(path, (json.dumps(expected, ensure_ascii=False, indent=2) + '\n').encode('utf8'))
        check = read_document(path)[1]
        if check != expected:
            raise ValueError('survivor_shell_readback_mismatch')
    except Exception:
        atomic_bytes(path, raw)
        raise
    report['updatedSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    (backup / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(run(apply=args.apply), ensure_ascii=False, indent=2))
