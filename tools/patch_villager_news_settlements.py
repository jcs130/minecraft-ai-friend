"""Prepare an exact, private compatibility copy for the NAS Settlements/Villager News pair."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

NEWS_SHA = '89380fc3ab05e15e085db74f39564836a67c94cf53c262f8d3a618105d111fda'
SETTLEMENTS_SHA = 'ff21dce2264b946d37413f3bb149620b975fe9723b9acad5d485436b39ba6ab7'
CONFIG = 'villager_news.mixins.json'
OBSOLETE = 'SettlementsInventorySaveMixin'
PREFIX = 'dev/breezes/settlements/infrastructure/minecraft/attachments/'
BACKPACK = 'cn/blockforge/generated/villagernews/SettlementsCompat$SettlementsBackpackView.class'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def prepare(news: Path, settlements: Path, destination: Path, backpack_class: Path | None = None) -> dict:
    original, base = news.read_bytes(), settlements.read_bytes()
    if sha(original) != NEWS_SHA or sha(base) != SETTLEMENTS_SHA:
        raise ValueError('Unsupported input bytes; re-audit another release rather than applying this patch')
    if destination.exists() or destination.resolve() in (news.resolve(), settlements.resolve()):
        raise ValueError('Use a new private output; preserve both original JARs')
    with zipfile.ZipFile(settlements) as jar:
        names = jar.namelist()
        if PREFIX + 'VillagerInventoryAttachment.class' in names or not all(
            PREFIX + name in names for name in ['VillagerInventoryAttachmentSerializer.class', 'VillagerInventoryAttachmentCodec.class']
        ):
            raise ValueError('Native serializer evidence no longer matches the audited version')
    with zipfile.ZipFile(news) as source:
        if any(n.upper().startswith('META-INF/') and n.upper().endswith(('.SF', '.RSA', '.DSA')) for n in source.namelist()):
            raise ValueError('Refuse to alter signed input')
        config = json.loads(source.read(CONFIG))
        if config.get('required') is not True or config['mixins'].count(OBSOLETE) != 1:
            raise ValueError('Unexpected mixin configuration')
        # This redirect targets an old saveFrom call absent in the pinned BaseVillager.
        # The current native attachment serializer remains active and must be tested across restart.
        config['mixins'].remove(OBSOLETE)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(destination, 'w') as target:
            for entry in source.infolist():
                data = source.read(entry)
                if entry.filename == CONFIG:
                    data = (json.dumps(config, indent=2) + '\n').encode('utf-8')
                elif entry.filename == BACKPACK and backpack_class is not None:
                    data = backpack_class.read_bytes()
                    if not data.startswith(b'\xca\xfe\xba\xbe') or b'SettlementsCompat$SettlementsBackpackView' not in data:
                        raise ValueError('Unexpected compiled compatibility class')
                target.writestr(entry, data)
    with zipfile.ZipFile(news) as source, zipfile.ZipFile(destination) as target:
        if source.namelist() != target.namelist() or target.testzip() is not None:
            raise ValueError('Invalid compatibility archive')
        changed = [name for name in source.namelist() if source.read(name) != target.read(name)]
        expected = {CONFIG, BACKPACK} if backpack_class is not None else {CONFIG}
        if set(changed) != expected:
            raise ValueError('Unexpected modified entry')
    report = {'schemaVersion': 1, 'newsInputSha256': NEWS_SHA, 'settlementsSha256': SETTLEMENTS_SHA,
              'outputSha256': sha(destination.read_bytes()), 'changedEntries': changed,
              'removedObsoleteRedirect': OBSOLETE, 'assetsPreserved': True,
              'containerClassReplaced': backpack_class is not None,
              'allOtherClassesPreserved': True,
              'nativeAttachmentSerializerPreserved': True, 'restartPersistenceVerified': False}
    destination.with_suffix('.build.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--news', type=Path, required=True)
    parser.add_argument('--settlements', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--backpack-class', type=Path, help='Owned bounded-stack, component-preserving container implementation')
    args = parser.parse_args()
    print(json.dumps(prepare(args.news, args.settlements, args.output, args.backpack_class), indent=2))
