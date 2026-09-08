"""Prepare a NEW isolated survivor from the current operations coordinator model.

Never copies another role, session, prompt, job or tool. Credentials are decrypted
in memory and re-encrypted only under the ignored target state directory.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
from urllib.parse import urlsplit

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'server/operations-agent-state'
TARGET = ROOT / 'server/survival-agent-state'
SETTINGS = ROOT / 'config/survival-agent.json'
IMAGE = 'qiandengji-survivor:2.2.0-qd1'
PROJECT = 'qiandengji-survivor'
ROLE = 'qd-survivor'


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    path.chmod(0o600)


def selected_source(source=SOURCE):
    """Read only the coordinator's selected model and its single provider."""
    config_bytes = (source / 'work/workspaces/default/agent.json').read_bytes()
    profile = json.loads(config_bytes.decode('utf-8-sig'))
    active = profile.get('active_model')
    if not isinstance(active, dict):
        raise ValueError('source_model_missing')
    pid, model = active.get('provider_id'), active.get('model')
    if not isinstance(pid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', pid):
        raise ValueError('invalid_provider_id')
    if not isinstance(model, str) or not 1 <= len(model) <= 160 or any(ord(c) < 32 for c in model):
        raise ValueError('invalid_model_id')
    # This initializer has reviewed the project's existing Coding Plan source.
    # A future provider switch requires review; never silently fall back to an old choice.
    if pid != 'aliyun-codingplan':
        raise ValueError('coordinator_provider_changed_review_required')
    found = [(kind, source / 'secret/providers' / kind / (pid + '.json'))
             for kind in ('builtin', 'custom')]
    found = [(kind, path) for kind, path in found if path.is_file()]
    if len(found) != 1:
        raise ValueError('ambiguous_provider')
    kind, path = found[0]
    provider = json.loads(path.read_text(encoding='utf-8-sig'))
    url = urlsplit(provider.get('base_url', ''))
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.query or url.fragment or url.hostname.lower() in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('unreviewed_provider_endpoint')
    if provider.get('chat_model', 'OpenAIChatModel') != 'OpenAIChatModel':
        raise ValueError('unreviewed_provider_adapter')
    key = provider.get('api_key', '')
    if not isinstance(key, str) or not key:
        raise ValueError('provider_key_missing')
    if key.startswith('ENC:'):
        old_master = (source / 'secret/.master_key').read_text(encoding='ascii').strip()
        old_cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(old_master)))
        key = old_cipher.decrypt(key[4:].encode('ascii')).decode('utf8')
    if not key:
        raise ValueError('provider_key_missing')
    selected = {'provider_id': pid, 'model': model}
    return selected, kind, provider, key, hashlib.sha256(config_bytes).hexdigest()


def initialize_command(target, image=IMAGE):
    command = ['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python']
    for key, value in {
        'HOME': '/state/home', 'QWENPAW_WORKING_DIR': '/state/work', 'COPAW_WORKING_DIR': '/state/work',
        'QWENPAW_SECRET_DIR': '/state/secret', 'COPAW_SECRET_DIR': '/state/secret',
        'QWENPAW_DISABLE_KEYRING': '1', 'QWENPAW_KEYRING_ACCOUNT': PROJECT,
        'QWENPAW_AUTH_ENABLED': '0',
    }.items():
        command.extend(['-e', key + '=' + value])
    command.extend(['-v', target.as_posix() + ':/state', '-v', (ROOT / 'world/survival').as_posix()
                    + ':/survival:ro', image, '/survival/init_runtime.py'])
    return command


def body_name(settings=SETTINGS):
    value = json.loads(settings.read_text(encoding='utf-8-sig'))
    name = value.get('bodyName')
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,16}', name):
        raise ValueError('invalid_body_name')
    return name


def prepare(source=SOURCE, target=TARGET, execute=False, run=subprocess.run, settings=SETTINGS):
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ValueError('target_not_empty')
    body = body_name(settings)
    active, kind, provider, key, source_digest = selected_source(source)
    summary = {'project': PROJECT, 'ok': True, 'role': ROLE, 'bodyName': body,
               'model': active, 'image': IMAGE, 'mode': 'execute' if execute else 'check',
               'copiedSessions': 0, 'copiedOtherRoles': 0, 'modelCalls': 0}
    if not execute:
        return summary
    # No source validation/decryption errors can leave a partial target.
    master = secrets.token_hex(32)
    cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(master)))
    selected_provider = {
        'id': active['provider_id'], 'name': active['provider_id'], 'base_url': provider['base_url'],
        'chat_model': 'OpenAIChatModel', 'api_key': 'ENC:' + cipher.encrypt(key.encode()).decode('ascii'),
        'is_custom': kind == 'custom', 'is_local': False, 'require_api_key': True,
        'support_model_discovery': False, 'models': [],
        'extra_models': [{'id': active['model'], 'name': active['model']}],
        'generate_kwargs': {'max_tokens': 2048},
    }
    private = target / 'secret'
    private.mkdir(parents=True, exist_ok=False)
    private.chmod(0o700)
    (private / '.master_key').write_text(master, encoding='ascii')
    (private / '.master_key').chmod(0o600)
    write_private(private / 'providers' / kind / (active['provider_id'] + '.json'), selected_provider)
    write_private(target / 'init-manifest.json', {
        'schema': 1, 'project': PROJECT, 'bodyName': body, 'image': IMAGE,
        'profiles': [{'id': ROLE, 'name': '桐人', 'active_model': active, 'provider_kind': kind}],
        'source': {'runtime': 'qiandengji-ops', 'role': 'default', 'configSha256': source_digest},
        'copiedSessions': 0, 'copiedOtherRoles': 0,
    })
    # The native service can boot in a read-only paused state immediately after
    # preparation. Selecting a work area and waking the existing body are separate.
    runtime_settings = json.loads(Path(settings).read_text(encoding='utf-8-sig'))
    write_private(target / 'survival/settings.json', runtime_settings)
    write_private(target / 'survival/control.json', {'schema': 1, 'enabled': False})
    result = run(initialize_command(target), capture_output=True, text=True, encoding='utf8', timeout=180)
    reports = []
    for line in result.stdout.splitlines():
        try:
            value = json.loads(line)
            if isinstance(value, dict) and value.get('project') == PROJECT:
                reports.append(value)
        except ValueError:
            pass
    if result.returncode or not reports or not reports[-1].get('ok'):
        raise RuntimeError('offline_initialization_failed_private_staging_retained')
    return {**summary, 'offlineInitializationVerified': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--execute', choices=['qiandengji'])
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(execute=bool(args.execute)), ensure_ascii=False))
    except Exception as exc:
        # Third-party errors can include URLs or credentials; only classify them.
        print(json.dumps({'project': PROJECT, 'ok': False, 'errorType': type(exc).__name__,
                          'error': 'Preparation failed; no running service was changed'}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
