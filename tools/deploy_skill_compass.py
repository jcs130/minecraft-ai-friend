"""Deploy the reviewed skill catalogue and server JARs to the stopped D project."""
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
QA = ['QiandengTest', 'QDCatalogProbe']


def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, data):
    temp = path.with_suffix(path.suffix + '.qd-tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def stopped():
    result = subprocess.run(['docker', 'compose', '-p', 'qiandengji', 'ps', '--format', 'json'], cwd=ROOT, check=True, capture_output=True, text=True)
    if any(json.loads(line).get('Service') in ['mc', 'world', 'npc'] and json.loads(line).get('State') == 'running'
           for line in result.stdout.splitlines() if line.strip()):
        raise ValueError('Stop this project before replacing JARs or fixture state')
    if (ROOT/'server/world-data/.qiandengji-smoke.lock').exists():
        raise ValueError('QA smoke lock is active')


def deploy():
    stopped()
    catalog = read(ROOT/'config/skill-catalog.json')
    atoms = read(ROOT/'server/world-data/magic-atoms.json')['atoms']
    ids = {a['id'] for a in atoms}
    if catalog['schema'] != 1 or set(catalog['featured']) & set(catalog['archived']) or set(catalog['featured']) | set(catalog['archived']) != ids:
        raise ValueError('Catalogue coverage invalid')
    bot = read(ROOT/'world/botgate-src/build-record.json')
    native = read(ROOT/'world/irons-bridge-src/build/build-record.json')
    for record in [bot, native]:
        jar = Path(record['jar'])
        if not jar.resolve().is_relative_to(ROOT) or sha(jar) != record['sha256']:
            raise ValueError('Build artifact does not match record')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = ROOT/'runtime/backups'/('skill-compass-' + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    paths = ['server/mc/mods/botgate.jar', 'server/mc/mods/qiandeng-irons-bridge-0.1.0.jar',
             'server/world-data/magic-state.json', 'server/mcdata/magic-state.json',
             'server/world-data/waypoints.json', 'server/mcdata/waypoints.json',
             'server/world-data/skill-catalog.json', 'server/mcdata/skill-catalog.json']
    for relative in paths:
        source = ROOT/relative
        if source.exists():
            target = backup/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    for name in ['server/world-data/skill-catalog.json', 'server/mcdata/skill-catalog.json']:
        write(ROOT/name, catalog)
    shutil.copy2(bot['jar'], ROOT/'server/mc/mods/botgate.jar')
    shutil.copy2(native['jar'], ROOT/'server/mc/mods/qiandeng-irons-bridge-0.1.0.jar')
    # Only reserved QA records get a temporary UI fixture; original owners remain unchanged.
    state = read(ROOT/'server/world-data/magic-state.json')
    points = read(ROOT/'server/world-data/waypoints.json')
    now = int(datetime.now(timezone.utc).timestamp()*1000)
    for owner in QA:
        state['players'][owner] = {**state['players'].get(owner, {}), 'mana': 500, 'maxMana': 500,
            'maxManaBonus': 0, 'level': 50, 'learned': [*catalog['featured'], 'heal'], 'innateSkill': 'fireworks',
            'passives': [], 'advancementSkills': [], 'skillbar': [], 'lastUpdate': now}
        points['players'][owner] = [{'id': i, 'name': f'验收路标{i}', 'x': -544, 'y': 65, 'z': 864,
            'dim': 'minecraft:overworld', 'createdAt': now+i} for i in range(1, 11)]
        points.setdefault('nextPersonalIds', {})[owner] = 11
    for prefix in ['server/world-data', 'server/mcdata']:
        write(ROOT/prefix/'magic-state.json', state)
        write(ROOT/prefix/'waypoints.json', points)
    files = ['server/mc/mods/botgate.jar', 'server/mc/mods/qiandeng-irons-bridge-0.1.0.jar',
        'server/world-data/skill-catalog.json', 'server/mcdata/skill-catalog.json']
    locked = {'schema_version': 1, 'target': {'minecraft':'1.21.1','neoforge':'21.1.248','java':21},
        'files': [{'path': f, 'sha256': sha(ROOT/f), 'client_required': False} for f in files]}
    write(ROOT/'manifests/server-extensions.lock.json', locked)
    report = {'ok': True, 'deployed_at': datetime.now(timezone.utc).isoformat(), 'backup': backup.relative_to(ROOT).as_posix(),
        'featured': catalog['featured'], 'archived_count': len(catalog['archived']), 'files': locked['files'],
        'qa_owners': QA, 'qa_restored': False, 'scope': 'Server-only update; existing client package remains compatible'}
    write(ROOT/'reports/skill-compass-deployment.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def restore_qa():
    stopped()
    report = read(ROOT/'reports/skill-compass-deployment.json')
    backup = (ROOT/report['backup']).resolve()
    if not backup.is_relative_to((ROOT/'runtime/backups').resolve()) or report['qa_owners'] != QA:
        raise ValueError('Unexpected backup or QA ownership')
    preserved = {}
    for filename in ['magic-state.json', 'waypoints.json']:
        original = read(backup/'server/world-data'/filename)
        current = read(ROOT/'server/world-data'/filename)
        for owner in QA:
            if owner in original['players']: current['players'][owner] = original['players'][owner]
            else: current['players'].pop(owner, None)
            if filename == 'waypoints.json' and 'nextPersonalIds' in current:
                old_next = original.get('nextPersonalIds', {})
                if owner in old_next: current['nextPersonalIds'][owner] = old_next[owner]
                else: current['nextPersonalIds'].pop(owner, None)
        if filename == 'waypoints.json':
            preserved['original_waypoints_equal'] = current['shared'] == original['shared'] and all(current['players'].get(k) == v for k,v in original['players'].items())
        else:
            keys = ['learned', 'innateSkill', 'passives', 'advancementSkills', 'maxManaBonus', 'skillbar']
            preserved['original_skill_progress_equal'] = all(all(current['players'].get(k,{}).get(field) == v.get(field) for field in keys)
                for k,v in original['players'].items() if k not in QA)
        for prefix in ['server/world-data', 'server/mcdata']: write(ROOT/prefix/filename, current)
    report['qa_restored'] = True
    report['restored_at'] = datetime.now(timezone.utc).isoformat()
    report['preservation'] = preserved
    write(ROOT/'reports/skill-compass-deployment.json', report)
    print(json.dumps({'qa_restored':True, **preserved}, ensure_ascii=False))
    if not all(preserved.values()): raise ValueError('Review original progress differences before completion')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['deploy', 'restore-qa'])
    args=parser.parse_args()
    deploy() if args.action=='deploy' else restore_qa()
