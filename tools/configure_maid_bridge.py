"""Prepare/migrate existing TLM site IDs to the signed maid bridge; never edits entities or calls models."""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
TYPE = 'qiandeng-qwen'
URL = 'http://npc:8091/v1/maid/chat/completions'
ICON = 'touhou_little_maid:textures/gui/ai_chat/openai.png'


def guarded(path, root):
    path, root = Path(path).absolute(), Path(root).resolve()
    if not path.resolve().is_relative_to(root):
        raise ValueError('path_outside_project')
    for parent in (path, *path.parents):
        if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)():
            raise ValueError('linked_project_path')
        if parent == root:
            break
    return path


def model_labels(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 64:
        raise ValueError('invalid_model_labels')
    names = []
    for row in value:
        if isinstance(row, str):
            name = row
        elif (isinstance(row, dict) and set(row) == {'name', 'reasoning'}
              and type(row['reasoning']) is bool):
            name = row['name']
        else:
            raise ValueError('unsupported_model_label_shape')
        if (not isinstance(name, str) or not 1 <= len(name) <= 256
                or any(ord(c) < 32 or ord(c) == 127 for c in name)):
            raise ValueError('invalid_model_label')
        names.append(name)
    if len(names) != len(set(names)):
        raise ValueError('duplicate_model_label')
    return deepcopy(value)


def proposal(old):
    if not isinstance(old, dict) or not 1 <= len(old) <= 64 or 'codingplan' not in old:
        raise ValueError('existing_maid_sites_required')
    output = {}
    for site_id, row in old.items():
        if (not isinstance(site_id, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', site_id)
                or not isinstance(row, dict) or row.get('id') != site_id
                or type(row.get('enabled')) is not bool
                or row.get('api_type') not in ('openai', TYPE)):
            raise ValueError('unexpected_existing_site_shape')
        icon = row.get('icon')
        if not isinstance(icon, str) or not re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+', icon):
            raise ValueError('native_codec_icon_required')
        # Preserve identities, enablement, actual display model labels and icon.
        # Unknown old fields are preserved in the byte-exact backup, not sent to clients.
        output[site_id] = {'id': site_id, 'api_type': TYPE, 'enabled': row['enabled'], 'icon': icon,
            'url': URL, 'secret_key': '', 'headers': {},
            'models': model_labels(row.get('models'))}
    return output


def _require_stopped():
    result = subprocess.run(['docker', 'inspect', '--format', '{{json .State.Running}}', 'qiandengji-mc-1'],
                            capture_output=True, text=True, timeout=15)
    if result.returncode != 0 or result.stdout.strip() != 'false':
        raise ValueError('stop_qiandengji_mc_before_site_migration')


def configure(root=ROOT, apply=False, ensure_stopped=None):
    root = Path(root).resolve()
    target = guarded(root / 'server/mc/config/touhou_little_maid/sites/llm.json', root)
    key = guarded(root / 'server/mc/config/qiandeng_maid_bridge/identity.key', root)
    if not target.is_file() or target.stat().st_size > 262144:
        raise ValueError('existing_maid_sites_required')
    original = target.read_bytes()
    old = json.loads(original.decode('utf-8-sig'))
    changed_sites = proposal(old)
    if key.exists():
        if not key.is_file() or key.stat().st_size > 258:
            raise ValueError('invalid_existing_identity_key')
        token = key.read_text('ascii').strip()
        if not 32 <= len(token) <= 256 or any(not 33 <= ord(c) <= 126 for c in token):
            raise ValueError('invalid_existing_identity_key')
    needs_key = not key.exists()
    changed = changed_sites != old
    result = {'ok': True, 'project': 'qiandengji', 'mode': 'apply' if apply else 'check',
        'changed': changed or needs_key, 'sitesChanged': changed, 'siteCount': len(old), 'siteIdsPreserved': True,
        'enabledStatesPreserved': True, 'modelLabelsPreserved': True, 'identityKeyCreated': False,
        'identityKeyNeeded': needs_key, 'endpoint': URL, 'apiType': TYPE,
        'nativeDefaultSiteMayBeAdded': TYPE, 'modelCalls': 0, 'entityChanges': 0,
        'requiresClientBridge': True, 'reloadCommand': 'tlm ai_chat reload'}
    if not apply or not result['changed']:
        return result
    (ensure_stopped or _require_stopped)()
    # Check again after runtime verification: do not replace a concurrent editor's change.
    if target.read_bytes() != original:
        raise ValueError('site_config_changed_during_check')
    folder = guarded(root / 'runtime/maid-bridge-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'), root)
    folder.mkdir(parents=True, exist_ok=False)
    (folder / 'maid-llm.json').write_bytes(original)
    result['backup'] = str(folder)
    if needs_key:
        key.parent.mkdir(parents=True, exist_ok=True)
        with key.open('x', encoding='ascii') as stream:
            stream.write(secrets.token_hex(32))
            stream.flush()
            os.fsync(stream.fileno())
        result['identityKeyCreated'] = True
    if changed:
        pending = guarded(target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp'), root)
        try:
            with pending.open('x', encoding='utf8', newline='\n') as stream:
                stream.write(json.dumps(changed_sites, ensure_ascii=False, indent=2) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            if target.read_bytes() != original:
                raise ValueError('site_config_changed_before_commit')
            pending.replace(target)
        finally:
            pending.unlink(missing_ok=True)
    result['configSha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(configure(apply=bool(args.apply)), ensure_ascii=False))
