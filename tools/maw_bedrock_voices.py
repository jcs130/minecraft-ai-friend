"""Package the hash-locked TLM recordings without synthesizing/re-encoding audio.

Event names, filename matching and additive reuse pools follow CustomSoundLoader
in the installed 1.5.3 JAR. Generated third-party media stays outside Git.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import zipfile
from maw_bedrock_resources import encoded, sha

CATALOG = 'maid-voices.json'
TLM_SHA = 'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27'
CHANNELS = ['touhou_little_maid:play_maid_sound', 'touhou_little_maid:play_maid_sound_at_pos']
EVENTS = {
    **{'mode/'+s: 'maid.mode.'+s for s in (
        'idle', 'attack', 'range_attack', 'danmaku_attack', 'farm', 'feed', 'shears',
        'milk', 'torch', 'feed_animal', 'extinguishing', 'snow', 'break', 'furnace', 'brewing')},
    **{'ai/'+s: 'maid.ai.'+s for s in (
        'find_target', 'hurt', 'hurt_fire', 'hurt_player', 'tamed', 'item_get', 'death', 'game_win', 'game_lost')},
    **{'environment/'+s: 'maid.environment.'+s for s in ('hot', 'cold', 'rain', 'snow', 'morning', 'night')},
    'other/credit': 'maid.credit',
}
REUSE = [('mode/attack', 'mode/range_attack'), ('mode/attack', 'mode/danmaku_attack')]
REUSE += [('mode/idle', 'mode/'+s) for s in ('farm', 'feed', 'shears', 'milk', 'torch',
    'feed_animal', 'extinguishing', 'snow', 'break', 'furnace', 'brewing')]
REUSE += [('ai/hurt', 'ai/hurt_fire')]


def convert(maid_jar: Path, *, expected_sha=TLM_SHA):
    raw = maid_jar.read_bytes()
    if sha(raw) != expected_sha:
        raise ValueError('Maid voice codec/source JAR is not hash locked')
    entries, definitions, clips, packs = {}, {}, {}, []
    with zipfile.ZipFile(maid_jar) as z:
        if z.testzip() or len(z.namelist()) != len(set(z.namelist())):
            raise ValueError('Invalid maid source JAR')
        native_events = json.loads(z.read('assets/touhou_little_maid/sounds.json'))
        for key in sorted(z.namelist()):
            match = re.fullmatch(r'assets/touhou_little_maid/tlm_custom_pack/[^/]+/assets/([a-z0-9_.-]+)/maid_sound.json', key)
            if not match:
                continue
            pack_id = match[1]; prefix = key[:-len('maid_sound.json')]+'sounds/maid/'
            info = json.loads(z.read(key)); pools = {event: [] for event in EVENTS}
            source_count = 0
            for source in sorted(n for n in z.namelist() if n.startswith(prefix) and n.endswith('.ogg')):
                local = source[len(prefix):]
                event = next((event for event in EVENTS if re.fullmatch(re.escape(event)+r'\d*\.ogg', local)), None)
                if event is None:
                    continue
                audio = z.read(source)
                # Native packs contain Ogg Vorbis; do not hand a corrupt/other
                # codec to a phone or quietly substitute a generated recording.
                at = audio.find(b'\x01vorbis')
                if not audio.startswith(b'OggS') or not 0 <= at < 256 or len(audio) > 8*1024*1024:
                    raise ValueError('Invalid native maid Ogg Vorbis: '+source)
                digest = sha(audio); path = 'sounds/maw_maid/'+digest[:32]+'.ogg'
                if path in entries and entries[path] != audio:
                    raise ValueError('Voice content hash collision')
                entries[path] = audio
                clip = clips.setdefault(digest, {'file': path, 'sha256': digest, 'bytes': len(audio), 'sources': []})
                clip['sources'].append(source); pools[event].append(digest); source_count += 1
            # TLM appends reuse pools even when the destination has recordings.
            # Keeping duplicates preserves its equal-choice probability exactly.
            for source, target in REUSE:
                pools[target].extend(pools[source])
            events = {}
            for event, pool in pools.items():
                native = 'touhou_little_maid:'+EVENTS[event]
                if EVENTS[event] not in native_events:
                    raise ValueError('Native maid sound event missing')
                if not pool:
                    continue
                sound = 'maw_maid.'+hashlib.sha256((pack_id+'\n'+native).encode()).hexdigest()[:32]
                events[native] = {'sound': sound, 'clips': pool}
                definitions[sound] = {'category': 'neutral', 'min_distance': 1, 'max_distance': 16,
                    'sounds': [{'name': clips[h]['file'][:-4], 'stream': False, 'is3D': True} for h in pool]}
            packs.append({'id': pack_id, 'info': info, 'sourceRecordings': source_count, 'events': events})
    if not packs or not definitions:
        raise ValueError('No native maid voice recordings')
    catalog = {'schemaVersion': 1, 'maidJarSha256': expected_sha, 'channels': CHANNELS,
        'packs': packs, 'clips': clips, 'recordingCount': sum(p['sourceRecordings'] for p in packs),
        'eventCount': len(definitions), 'uniqueRecordings': len(clips), 'thirdPartyAudioGenerated': False}
    entries['sounds/sound_definitions.json'] = encoded({'format_version': '1.20.20', 'sound_definitions': definitions})
    return entries, catalog


def validate(catalog, archive):
    if catalog.get('schemaVersion') != 1 or catalog.get('maidJarSha256') != TLM_SHA or catalog.get('channels') != CHANNELS:
        raise ValueError('Invalid native voice contract')
    definitions = json.loads(archive.read('sounds/sound_definitions.json'))['sound_definitions']
    count = 0
    for pack in catalog['packs']:
        for row in pack['events'].values():
            expected = [{'name': catalog['clips'][h]['file'][:-4], 'stream': False, 'is3D': True} for h in row['clips']]
            if definitions[row['sound']]['sounds'] != expected:
                raise ValueError('Native voice pool changed')
            count += 1
    if count != catalog['eventCount'] or count != len(definitions):
        raise ValueError('Native voice event count mismatch')
    for h, clip in catalog['clips'].items():
        raw = archive.read(clip['file'])
        if sha(raw) != h or len(raw) != clip['bytes']:
            raise ValueError('Native voice recording changed')
    if len(catalog['clips']) != catalog['uniqueRecordings'] or sum(len(c['sources']) for c in catalog['clips'].values()) != catalog['recordingCount']:
        raise ValueError('Native voice recording count mismatch')
