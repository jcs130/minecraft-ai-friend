"""Install verified official/community documents through Qwen's native skill API."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
import zipfile
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'world/ops')]
from configure_world_team import api, native_host, members, write, NoRedirect, PORTS
from team_recruitment import install_builtin


def install(actors):
    source = ROOT / 'world/ops/community-skills/game-production'
    lock = json.loads((source / 'source-lock.json').read_text(encoding='utf-8'))
    for row in lock['files']:
        assert hashlib.sha256((source / row['path']).read_bytes()).hexdigest() == row['sha256']
    blob = io.BytesIO()
    with zipfile.ZipFile(blob, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in source.rglob('*'):
            if path.is_file():
                archive.write(path, 'game-production/' + path.relative_to(source).as_posix())
    builtin = subprocess.check_output(['docker', 'exec', 'qiandengji-qwenpaw-1', 'cat',
        '/usr/local/lib/python3.11/site-packages/qwenpaw/agents/skills/chat_with_agent-zh/SKILL.md']).decode('utf-8')
    pool = {s['name']: s for s in api('game', 'GET', '/skills/pool', 'mc-god')}
    backup = ROOT / 'runtime/team-collaboration' / ('official-pool-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S'))
    for name in ('make-skill', 'file_reader', 'cron', 'chat_with_agent'):
        if name not in pool:
            continue
        assert pool[name]['source'] == 'builtin' and pool[name].get('auto_sync') is False
        before = api('game', 'GET', '/skills/pool/' + name, 'mc-god')
        expected = subprocess.check_output(['docker', 'exec', 'qiandengji-qwenpaw-1', 'cat',
            '/usr/local/lib/python3.11/site-packages/qwenpaw/agents/skills/' + name + '-zh/SKILL.md']).decode('utf-8')
        if before['content'] != expected:
            write(backup / (name + '.json'), before)
            api('game', 'POST', '/skills/pool/' + name + '/update-builtin', 'mc-god', {'language': 'zh'})
            assert api('game', 'GET', '/skills/pool/' + name, 'mc-god')['content'] == expected
    results = []
    for actor in actors:
        assert actor in members(), 'unknown_role'
        host = native_host(actor); runtime, role = host['runtime'], host['agentId']
        assert api(runtime, 'GET', '/agents/' + role + '/agent-status', role)['running_task_count'] == 0
        entries = {s['name']: s for s in api(runtime, 'GET', '/skills', role)}
        if runtime == 'game' and role in ('mc-god', 'qd-engineer', 'qd-guild-planner'):
            if 'chat_with_agent' not in entries:
                install_builtin(lambda rt, aid, method, path, body=None: api(rt, method, path, aid, body),
                                role, 'chat_with_agent', builtin)
            else:
                # Preserve a user's existing official skill language/version.
                assert entries['chat_with_agent']['enabled'] is True
        if 'game-production' not in entries:
            boundary = 'qiandeng-community-skill-package'
            data = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="game-production.zip"\r\n'
                'Content-Type: application/zip\r\n\r\n').encode() + blob.getvalue() + f'\r\n--{boundary}--\r\n'.encode()
            req = urllib.request.Request(f'http://127.0.0.1:{PORTS[runtime]}/api/skills/upload?enable=true',
                data=data, method='POST', headers={'X-Agent-Id': role, 'Content-Type': 'multipart/form-data; boundary=' + boundary})
            with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=60) as response:
                uploaded = json.loads(response.read(65536))
            assert uploaded.get('imported') == ['game-production'] and uploaded.get('enabled') is True, uploaded
        current = api(runtime, 'GET', '/skills/game-production', role)
        assert current['enabled'] is True and current['content'] == (source / 'SKILL.md').read_text(encoding='utf-8')
        results.append({'actor': actor, 'skill': 'game-production', 'verified': True, 'sourceCommit': lock['commit']})
        print(json.dumps(results[-1], ensure_ascii=False), flush=True)
    write(ROOT / 'runtime/team-collaboration/skill-install-receipt.json', {'modelCalls': 0, 'roles': results,
        'officialChatSkillSha256': hashlib.sha256(builtin.encode()).hexdigest()})
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', action='append', required=True)
    args = parser.parse_args()
    install(args.actor)
