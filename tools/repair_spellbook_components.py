"""Repair the two imported 1.21.1 spellbook loot tables without reloading MC."""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TABLE_DIR = ROOT/'server/mc/shadow/datapacks/spellbooks/data/spellbooks/loot_table'


def repair_names(original):
    fixed = deepcopy(original)
    changed = []
    def visit(value, path=''):
        if isinstance(value, dict):
            for key, child in list(value.items()):
                child_path = path + '/' + key
                if key == 'minecraft:custom_name' and isinstance(child, (dict, list)):
                    value[key] = json.dumps(child, ensure_ascii=False, separators=(',', ':'))
                    changed.append(child_path)
                else:
                    visit(child, child_path)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, path + '/' + str(index))
    visit(fixed)
    # Exact semantic round-trip: no item, skill marker, slot or style is changed.
    restored = deepcopy(fixed)
    for path in changed:
        keys = path.split('/')[1:]
        parent = restored
        for key in keys[:-1]:
            parent = parent[int(key)] if isinstance(parent, list) else parent[key]
        parent[keys[-1]] = json.loads(parent[keys[-1]])
    if restored != original:
        raise ValueError('Component repair would change loot-table content')
    return fixed, changed


def main():
    reports = []
    for name in ['mengmeng_attack', 'mengmeng_learned']:
        path = TABLE_DIR/(name+'.json')
        raw = path.read_bytes()
        fixed, changed = repair_names(json.loads(raw.decode('utf-8-sig')))
        if changed:
            path.write_text(json.dumps(fixed, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        reports.append({'path':path.relative_to(ROOT).as_posix(), 'custom_names_serialized':len(changed),
                        'before_sha256':hashlib.sha256(raw).hexdigest(),
                        'after_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                        'content_roundtrip_verified':True})
    report = {'status':'files_repaired_pending_reload', 'files':reports,
              'minecraft_reload_performed':False, 'source_files_modified':False}
    (ROOT/'reports/spellbook-component-repair.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
