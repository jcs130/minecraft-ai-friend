"""Read sealed gameplay MCAP archives into deduplicated, unassigned training reviews. Never dispatch actions."""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
import re
import numpy as np
from mcap.reader import make_reader

sys.path.insert(0, str(Path(__file__).parent / 'generated'))
from AgentMcLearning.GameplayRecord import GameplayRecord, GameplayRecordT


def plain(value):
    if isinstance(value, bytes):
        return value.decode('utf-8')
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, list):
        return [plain(v) for v in value]
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if hasattr(value, '__dict__'):
        return plain(vars(value))
    return value


def read_reviews(directory):
    directory = Path(directory)
    owner = json.loads((directory / 'archive-owner.json').read_text(encoding='utf-8'))
    if owner.get('protocol') != 'agent-mc-gameplay/v1' or not re.fullmatch('[a-f0-9]{64}', owner.get('scopeKey', '')):
        raise ValueError('Not a gameplay archive')
    latest = {}
    conflicted = set()
    counts = Counter()
    hashes = []
    for manifest_path in sorted(directory.glob('*.manifest.json')):
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest.get('protocol') != owner['protocol'] or manifest.get('scopeKey') != owner['scopeKey'] or manifest.get('sealed') is not True:
            raise ValueError('Archive game scope/commit mismatch')
        path = manifest_path.with_name(manifest_path.name.replace('.manifest.json', '.mcap'))
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            if digest != manifest['sha256']:
                raise ValueError('MCAP manifest integrity mismatch')
            hashes.append(digest)
            stream.seek(0)
            messages = 0
            for schema, channel, message in make_reader(stream, validate_crcs=True).iter_messages():
                if schema is None or schema.encoding != 'flatbuffer' or schema.data[4:8] != b'BFBS' or channel.message_encoding != 'flatbuffer' or not GameplayRecord.GameplayRecordBufferHasIdentifier(message.data, 0):
                    raise ValueError('Unexpected gameplay encoding')
                frame = GameplayRecord.GetRootAs(message.data, 0)
                row = plain(GameplayRecordT.InitFromObj(frame))
                if row['scopeKey'] != owner['scopeKey'] or row['protocol'] != owner['protocol'] or row['assessment']['goalVerified']:
                    raise ValueError('Gameplay identity or evidence authority mismatch')
                expected_topic = '/gameplay/observation' if row['kind'] == 'observation' else '/gameplay/environment' if row['kind'] == 'environment' else '/gameplay/experience'
                if channel.topic != expected_topic:
                    raise ValueError('Gameplay topic/kind mismatch')
                messages += 1
                counts['allFrames'] += 1
                counts['kind:' + row['kind']] += 1
                if channel.topic != '/gameplay/experience':
                    continue
                counts['experienceRevisions'] += 1
                key = row['sourceId']
                old = latest.get(key)
                if old is None or row['revision'] == old['revision']:
                    latest[key] = row
                elif row['previousRevision'] == old['revision'] or timestamp(row['updatedAt']) > timestamp(old['updatedAt']):
                    latest[key] = row
                elif timestamp(row['updatedAt']) == timestamp(old['updatedAt']):
                    conflicted.add(key)
            if messages != manifest['records']:
                raise ValueError('MCAP committed record count mismatch')
    output = []
    for key, row in latest.items():
        if key in conflicted:
            counts['conflictingRevisions'] += 1
            continue
        counts['latest:' + row['kind']] += 1
        counts['label:' + row['assessment']['label']] += 1
        counts['use:' + row['assessment']['trainingUse']] += 1
        if row['kind'] != 'operation' or row['terminal'] is not True or row['dispatch'] == 'unknown':
            counts['notTerminalTrainingOperation'] += 1
            continue
        # These are review candidates. No observation-only frame becomes an imitation target.
        row['split'] = 'unassigned'
        row['automaticallyApprovedForTraining'] = False
        row['evidenceRef'] = 'mc-experience:' + owner['scopeKey'] + ':' + row['sourceId']
        output.append(row)
    counts['reviewCandidates'] = len(output)
    return sorted(output, key=lambda r: (timestamp(r['at']), r['sourceId'])), {
        'protocol': owner['protocol'], 'scopeKey': owner['scopeKey'], 'counts': dict(counts), 'archiveHashes': hashes,
        'partialFilesExcluded': len(list(directory.glob('*.partial'))), 'independentServerTruthAvailable': False,
        'exactControlsAvailable': False, 'motorImitationReady': False, 'split': 'unassigned',
        'warning': 'Outcome/progress signals are not causal proof, complete task success, demonstrations or approved preference pairs.',
    }


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Gameplay timestamps must include a timezone')
    return parsed.timestamp()


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('directory')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output)
    report = Path(str(output) + '.report.json')
    if output.exists() or report.exists():
        raise FileExistsError('Refusing to overwrite a previous dataset review')
    rows, metadata = read_reviews(args.directory)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
    metadata['datasetSha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
    report.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == '__main__':
    main()
