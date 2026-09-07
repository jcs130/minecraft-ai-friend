"""Extract exact spell names from the installed Iron's Spells translation table."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    jars = list((ROOT / 'server/mc/mods').glob('irons_spellbooks-*.jar'))
    if len(jars) != 1:
        raise ValueError('Expected one installed Iron\'s Spells JAR')
    with zipfile.ZipFile(jars[0]) as archive:
        names = json.loads(archive.read('assets/irons_spellbooks/lang/zh_cn.json'))
    names = {key: value for key, value in names.items() if key.startswith('spell.') and isinstance(value, str)}
    (ROOT / 'world/src/irons-spell-names.json').write_text(json.dumps(names, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'spell_names': len(names), 'source_jar': jars[0].name, 'sha256': hashlib.sha256(jars[0].read_bytes()).hexdigest()}))

if __name__ == '__main__':
    main()
