"""Render an offline WG candidate that protects the facility except its six arena interiors."""
import argparse
from pathlib import Path
import re
import yaml

PARENT = 'qd_trial_facility_ground'
SHELL = 'qd_trial_floor_guard_'
LEVELS = (8, 20, 32, 44, 56, 68)
MINIMUM, MAXIMUM = (-610, -64, -338), (-570, 101, -270)

def xyz(values):
    return dict(zip(('x', 'y', 'z'), values))

def guards():
    boxes = []
    left = MINIMUM[1]
    for floor in LEVELS:
        # The room occupies [-602,-578] x [-317,-293], ceiling at floor+7.
        boxes.append(((-610,left,-338),(-570,floor,-270)))
        lo, hi = floor + 1, floor + 6
        boxes.extend([((-610,lo,-338),(-602,hi,-270)), ((-578,lo,-338),(-570,hi,-270)),
                      ((-601,lo,-338),(-579,hi,-317)), ((-601,lo,-293),(-579,hi,-270))])
        left = hi + 1
    boxes.append(((-610,left,-338),MAXIMUM))
    return {SHELL + str(i): dict(type='cuboid', priority=1000000, min=xyz(lo), max=xyz(hi),
            owners={}, members={}, flags={'passthrough':'allow','block-break':'deny','block-place':'deny'})
            for i,(lo,hi) in enumerate(boxes)}

def render(text):
    loaded = yaml.safe_load(text)
    regions = loaded['regions']
    parent = regions[PARENT]
    if (parent['type'], parent['priority'], parent['min'], parent['max'], parent['members'], parent['owners']) != (
            'cuboid',1000000,xyz(MINIMUM),xyz(MAXIMUM),{},{}):
        raise ValueError('unexpected facility boundaries or owners')
    pieces = guards()
    install = {k:v for k,v in regions.items() if k.startswith(SHELL)}
    if install == pieces and all(k not in parent['flags'] for k in ('block-break','block-place')):
        return text
    if install or not all(parent['flags'].get(k) == 'deny' for k in ('block-break','block-place')):
        raise ValueError('unexpected preexisting shell or customized permissions')
    changed = dict(parent, flags={k:v for k,v in parent['flags'].items() if k not in ('block-break','block-place')})
    group = {PARENT:changed, **pieces}
    # Splice only this region in the existing serialized file; no other ownership or flag rewrites.
    heading = re.search(r'^([ ]+)'+PARENT+r':[ \t]*\r?$',text,re.M)
    if not heading:
        raise ValueError('facility header missing')
    indent = heading.group(1)
    next_region = re.search('^'+indent+r'\S',text[heading.end():],re.M)
    stop = heading.end() + next_region.start() if next_region else len(text)
    content = yaml.safe_dump(group, allow_unicode=True, sort_keys=False).rstrip()
    replacement = ''.join(indent + row + '\n' for row in content.splitlines())
    out = text[:heading.start()] + replacement + text[stop:]
    if yaml.safe_load(out) != dict(loaded, regions={**regions, **group}):
        raise ValueError('other WorldGuard data changed')
    return out

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('source', type=Path)
    cli.add_argument('candidate', type=Path)
    args = cli.parse_args()
    if args.source.resolve() == args.candidate.resolve():
        raise SystemExit('choose a separate candidate file')
    raw = args.source.read_bytes()
    revised = render(raw.decode('utf8')).encode('utf8')
    if args.candidate.exists() and args.candidate.read_bytes() != revised:
        raise SystemExit('candidate path already contains different bytes')
    args.candidate.write_bytes(revised)
