#!/usr/bin/env python
"""Lint the world-level shared notes: fields, duplicate lanes, staleness.

Conventions live in docs/WORLD-NOTES.md. This is the "periodic cleanup and dedupe"
the evolution plan's P3 promised, in the same spirit as CORAL's lint_wiki.

Three findings, and nothing else - a linter that comments on style gets ignored:

1. missing fields   A focus note must carry Posture / Lane / Budget / Abandon-if / Why-EV.
                    Abandon-if matters most: both of this world's 2026-09-17 stalls (the
                    same goto repeated, the same unreachable farm retried) happened because
                    no exit condition had ever been written down.
2. duplicate lanes  Two focus notes claiming the same lane means two agents are quietly
                    working the same thing, or one lane has two stale halves.
3. stale notes      A note that has not moved in a while is either still real (touch it) or
                    finished (say so, move the finding to synthesis/, or set Posture: idle).
"""
import argparse
import re
import time
from pathlib import Path

REQUIRED_FIELDS = ('Posture', 'Lane', 'Budget', 'Abandon-if', 'Why-EV')
DEFAULT_STALE_DAYS = 14
VALUE = re.compile(r'^\s*[-*]\s*\*\*(%s)\*\*\s*[:：]\s*(.+?)\s*$' % '|'.join(REQUIRED_FIELDS))


def parse_focus(path):
    """Return the fields a focus note actually declares, plus its author and lane."""
    try:
        text = Path(path).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return {'fields': {}, 'author': None, 'lane': None}
    fields = {}
    for line in text.splitlines():
        match = VALUE.match(line)
        if match:
            value = match.group(2).split('<!--')[0].strip()
            if value and value not in ('<', '>') and not value.startswith('<'):
                fields[match.group(1)] = value
    author = None
    head = re.search(r'^>\s*by\s+(.+?)\s*$', text, re.M)
    if head:
        author = head.group(1).split('·')[0].strip()
    lane = fields.get('Lane') or Path(path).stem
    return {'fields': fields, 'author': author, 'lane': lane}


def normalise(lane):
    return re.sub(r'[\s\-_，,。.]+', '', (lane or '').lower())[:60]


def lint(root, now=None, stale_days=DEFAULT_STALE_DAYS):
    """Findings for the shared-notes tree. Pure function over the filesystem."""
    root = Path(root)
    now = time.time() if now is None else now
    focus = root / 'focus'
    findings = {'missingFields': [], 'duplicateLanes': [], 'staleNotes': [], 'notes': 0}
    if not focus.is_dir():
        return findings
    lanes = {}
    for path in sorted(focus.glob('*.md')):
        if path.name.startswith('_'):
            continue                      # templates are not notes
        findings['notes'] += 1
        parsed = parse_focus(path)
        missing = [f for f in REQUIRED_FIELDS if f not in parsed['fields']]
        if missing:
            findings['missingFields'].append({'note': path.name, 'missing': missing})
        key = normalise(parsed['lane'])
        if key:
            lanes.setdefault(key, []).append(path.name)
        age = (now - path.stat().st_mtime) / 86400.0
        if age >= stale_days:
            findings['staleNotes'].append({'note': path.name, 'ageDays': round(age, 1),
                                           'posture': parsed['fields'].get('Posture')})
    findings['duplicateLanes'] = [{'lane': key, 'notes': names}
                                  for key, names in lanes.items() if len(names) > 1]
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=r'server/agents/work/world-notes')
    parser.add_argument('--stale-days', type=int, default=DEFAULT_STALE_DAYS)
    args = parser.parse_args()
    result = lint(args.root, stale_days=args.stale_days)
    print('== world-notes lint: %s ==' % args.root)
    print('  focus notes: %d' % result['notes'])
    if not any(result[k] for k in ('missingFields', 'duplicateLanes', 'staleNotes')):
        print('  clean: every focus note carries the five fields, no duplicate lanes, nothing stale.')
        return 0
    for row in result['missingFields']:
        print('  MISSING FIELDS  %-34s lacks %s' % (row['note'], ', '.join(row['missing'])))
    for row in result['duplicateLanes']:
        print('  DUPLICATE LANE  "%s" claimed by %s - merge or rename' % (row['lane'], ', '.join(row['notes'])))
    for row in result['staleNotes']:
        print('  STALE           %-34s untouched %sd (Posture %s) - touch it, retire it, or set Posture: idle'
              % (row['note'], row['ageDays'], row['posture']))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
