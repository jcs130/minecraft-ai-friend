"""Move the existing maid LLM site to the internal QwenPaw text adapter.

Backups retain the original private configuration. ASR/TTS and saved maid
identities are not modified. Reload with `tlm ai_chat reload` after applying.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import secrets
import shutil

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://npc:8091/v1/chat/completions'


def configure(root=ROOT, apply=False):
    root = Path(root).resolve()
    target = root / 'server/mc/config/touhou_little_maid/sites/llm.json'
    secret = root / 'server/mcdata/village/maid-agent-token'
    old = json.loads(target.read_text(encoding='utf-8-sig'))
    if not isinstance(old, dict) or not isinstance(old.get('codingplan'), dict):
        raise ValueError('existing_maid_site_required')
    token = secret.read_text(encoding='ascii').strip() if secret.exists() else secrets.token_urlsafe(48)
    if (not 32 <= len(token) <= 256 or not token.isascii()
            or any(not 33 <= ord(c) <= 126 for c in token)):
        raise ValueError('invalid_existing_adapter_token')
    # Saved maids may still name a disabled historical site. Keep every ID,
    # but never copy provider credentials, endpoints, headers or unknown fields.
    proposed = {}
    for site_id, previous in old.items():
        if not isinstance(previous, dict):
            raise ValueError('invalid_existing_maid_site')
        name = previous.get('name')
        name = name if isinstance(name, str) and name.strip() else site_id
        name = name if name.endswith(' · QwenPaw') else name + ' · QwenPaw'
        site = {'id': site_id, 'api_type': 'openai',
                'enabled': site_id == 'codingplan' or previous.get('enabled') is True,
                'name': name, 'url': URL, 'secret_key': token,
                'models': ['qd-maid-dialogue'], 'headers': {},
                # OpenAI's native CODEC requires icon. Addon default entries
                # may omit it; omission makes reload restore the addon site.
                'icon': 'touhou_little_maid:textures/gui/ai_chat/openai.png'}
        if isinstance(previous.get('icon'), str):
            site['icon'] = previous['icon']
        proposed[site_id] = site
    changed = proposed != old or not secret.exists()
    result = {'project': 'qiandengji', 'ok': True, 'mode': 'apply' if apply else 'check',
              'changed': changed, 'endpoint': URL, 'agentId': 'qd-maid-dialogue', 'modelCalls': 0,
              'reloadCommand': 'tlm ai_chat reload', 'textOnly': True}
    if apply and changed:
        folder = root / 'runtime/model-routing-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        folder.mkdir(parents=True, exist_ok=False)
        shutil.copy2(target, folder / 'maid-llm.json')
        if secret.exists():
            shutil.copy2(secret, folder / 'maid-agent-token')
        secret.parent.mkdir(parents=True, exist_ok=True)
        if not secret.exists():
            with secret.open('x', encoding='ascii') as output:
                output.write(token)
        pending = target.with_suffix('.json.agent.tmp')
        with pending.open('x', encoding='utf8') as output:
            output.write(json.dumps(proposed, ensure_ascii=False, indent=2) + '\n')
        pending.replace(target)
        result['backup'] = str(folder)
        result['configSha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(configure(apply=bool(args.apply)), ensure_ascii=False))
