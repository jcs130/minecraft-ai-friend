"""Compile reviewed construction states into immutable protected block runs; never reads/writes a live world."""
from pathlib import Path
import argparse, hashlib, json

AIR = {'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'}


def compile_mask(cells):
    rows = {}
    for (x, y, z), state in cells.items():
        if state['Name'] in AIR or not (-715 <= x <= -375 and 695 <= z <= 1035):
            continue
        if not -64 <= y <= 319:
            raise ValueError('invalid build height')
        if not state['Name'].startswith('minecraft:') and state['Name'].startswith('unknown:'):
            raise ValueError('unreadable block')
        rows.setdefault((y, z), []).append(x)
    runs = []
    for (y, z), xs in sorted(rows.items()):
        lo = hi = sorted(xs)[0]
        for x in sorted(xs)[1:]:
            if x == hi + 1: hi = x
            else: runs.append([lo, hi, y, z]); lo = hi = x
        runs.append([lo, hi, y, z])
    return {'schema': 1, 'dimension': 'minecraft:overworld', 'blocks': sum(len(xs) for xs in rows.values()), 'runs': runs}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild-root', required=True, type=Path)
    parser.add_argument('--floating', required=True, type=Path)
    parser.add_argument('--preserved', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args(); base = args.rebuild_root
    report_path = base/'production/final-verification/world-verification.json'
    report = json.loads(report_path.read_text('utf8'))
    if report.get('status') != 'passed' or report.get('differences'): raise ValueError('unverified construction')
    hashes = {}; cells = {}
    def load(path, expected=None):
        raw = path.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected: raise ValueError('changed construction input: '+path.name)
        hashes[path.name if not path.is_relative_to(base) else path.relative_to(base).as_posix()] = digest
        return json.loads(raw)
    # The verified input map preserves construction order: lots, removal, archive,
    # mine, then civic works. Last writer wins exactly as in saved-world verification.
    for name, digest in report['inputHashes'].items():
        local = base/name.split('town-rebuild-20260920/',1)[1] if 'town-rebuild-20260920/' in name else base/name.removeprefix('/rebuild/')
        doc = load(local, digest)
        if '/lots/' in name or name.endswith('/manifest.json') or '/phases/' in name:
            for row in doc['plannedAfter']: cells[tuple(row['position'])] = row['state']
        elif name.endswith('/cleanup/plan.json'):
            for row in doc['rows']: cells[tuple(row['position'])] = {'Name': 'minecraft:air'}
        elif name.endswith('/archive/plan.json'):
            for row in doc['allFinalConstructionCells']: cells[tuple(row['position'])] = row['state']
            for row in doc['migrations']: cells[tuple(row['target'])] = row['state']
    if len(cells) != report['composedCells']: raise ValueError('incomplete composition')
    preserved = load(args.preserved)
    if preserved.get('sourceChanged') or not preserved.get('snapshotVerified'): raise ValueError('unverified preserved structures')
    for row in preserved['cells']: cells[tuple(row['position'])] = row['state']
    for row in load(args.floating)['changes']: cells[tuple(row['position'])] = row['after']
    mask = compile_mask(cells)
    mask['provenance'] = {'constructionReportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest(), 'inputs': hashes}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(mask, separators=(',', ':'))+'\n', 'utf8')
    print(json.dumps({'blocks': mask['blocks'], 'runs': len(mask['runs']), 'bytes': args.out.stat().st_size,
        'sha256': hashlib.sha256(args.out.read_bytes()).hexdigest()}))


if __name__ == '__main__': main()
