"""Load the explicitly selected existing QwenPaw provider into a child's environment only."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True);p.add_argument('--provider',required=True);p.add_argument('--goal-file',required=True)
    p.add_argument('--command',choices=['check','run','status','stop'],default='run')
    p.add_argument('--request-id',default='');a=p.parse_args()
    if a.command=='stop':
        import uuid
        try:uuid.UUID(a.request_id)
        except ValueError:raise ValueError('stop_requires_original_request_uuid') from None
    root=Path(a.root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    runtime=root/'kirito-runtime'
    env=os.environ.copy()
    if a.command in {'run','check'}:
        from qwenpaw.constant import SECRET_DIR
        from qwenpaw.security.secret_store import decrypt
        providers=(Path(SECRET_DIR)/'providers').resolve(strict=True);provider=(providers/a.provider).resolve(strict=True)
        if not provider.is_relative_to(providers):raise ValueError('explicit_native_provider_required')
        raw=json.loads(provider.read_text('utf-8-sig'));key=decrypt(raw['api_key'])
        if not isinstance(key,str)or not 20<len(key)<4096 or any(ord(c)<33 for c in key):raise ValueError('provider_credential_unavailable')
        env['SAO_KIRITO_MODEL_KEY']=key
    command=[str(runtime/'.venv/Scripts/python.exe'),'-X','utf8','-m','agent_mc_autonomy.cli',a.command,'--config',str(runtime/'config.toml'),'--entry',str(runtime/'core/node_modules/agent-mc-world/bin/minecraft-agent-mcp.mjs'),'--goal',Path(a.goal_file).read_text('utf-8')]
    if a.request_id:command.extend(['--request-id',a.request_id])
    return subprocess.call(command,env=env,cwd=runtime)

if __name__=='__main__':raise SystemExit(main())
