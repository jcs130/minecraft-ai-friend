"""Check the deployed maid packs and existing YSM assets without changing players."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def main():
    lock = json.loads((ROOT/'manifests/voice-packs.lock.json').read_text(encoding='utf-8'))
    rows = []
    for item in lock['files']:
        filename = Path(item['path']).name
        client = ROOT/'client'/item['path']
        paths = [client, ROOT/'server/mc/tlm_custom_pack'/filename, ROOT/'server/public/packs'/filename]
        equal = all(path.is_file() and sha(path.read_bytes()) == item['sha256'] for path in paths)
        try:
            with urllib.request.urlopen('http://127.0.0.1:19090/packs/'+filename, timeout=8) as response:
                served = sha(response.read()) == item['sha256']
        except OSError:
            served = False
        with zipfile.ZipFile(client) as archive:
            metadata_paths = [name for name in archive.namelist() if name.endswith('/maid_sound.json')]
            metadata = [json.loads(archive.read(name)) for name in metadata_paths]
            namespaces = [Path(name).parts[1] for name in metadata_paths]
            valid = bool(metadata) and archive.testzip() is None
            for data in metadata:
                icon = data.get('icon', '')
                namespace, separator, resource = icon.partition(':')
                if separator:
                    valid = valid and 'assets/'+namespace+'/'+resource in archive.namelist()
            rows.append({'file':filename, 'namespaces':namespaces, 'three_copies_match':equal,
                         'http_bytes_match':served, 'metadata_and_icon_valid':valid})
    required = {'ark_amiya','ark_bena','ark_durin','ark_golding','ark_kroos','ark_luo_xiaohei',
                'ark_magallan','ark_myrtle','ark_paopao','ark_pepe','ark_texas','ark_yueyue',
                'atri_sound_pack','nahida','xuanxuan_sound','tangyuan_sound','zi_min','gugu_gaga'}
    found = {namespace for row in rows for namespace in row['namespaces']}
    builtin = ROOT/'client/config/yes_steve_model/builtin'
    models = list(builtin.rglob('ysm.json'))
    skin_report = json.loads((ROOT/'reports/character-skins.json').read_text(encoding='utf-8'))
    report = {'checked_at':datetime.now(timezone.utc).isoformat(), 'project':'qiandengji',
              'voice_pack_count':len(rows), 'voice_packs':rows,
              'missing_voice_namespaces':sorted(required-found), 'ysm_builtin_model_count':len(models),
              'skin_registry_repaired':skin_report.get('registry_repaired') is True,
              'physical_audio_or_model_menu_verified':False,
              'scope':'Deployed files, actual local HTTP bytes, pack metadata/icon references, and preserved skin restoration evidence'}
    report['ok'] = (required <= found and len(models) == 27 and report['skin_registry_repaired'] and
                    all(row['three_copies_match'] and row['http_bytes_match'] and row['metadata_and_icon_valid'] for row in rows))
    (ROOT/'reports/cosmetic-assets-health.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'ok':report['ok'], 'voice_pack_count':len(rows), 'missing':report['missing_voice_namespaces'],
                      'failed':[row for row in rows if not(row['three_copies_match'] and row['http_bytes_match'] and row['metadata_and_icon_valid'])]},ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
