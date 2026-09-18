#!/usr/bin/env python
"""Clear stale git locks in the agents' engineering sandboxes, and verify their indexes.

Why this exists: the engineer's commit channel froze for 43 hours from 2026-09-15.
Its own diagnosis named the failing step (git read-tree --empty, the first write to
.git/index — the operation that creates index.lock) and observed that both freeze
episodes coincided with container restarts. Confirmed by hand on 2026-09-18: a
zero-byte .git/index.lock with the mtime of a restart was sitting in its repository,
and nothing was holding it. The engineer cannot fix this itself — its role guard
refuses reads under .git — so it is a host-side check.

Run after any container restart that touches an agent workspace. Idempotent: a lock
whose owning process is gone and whose content is empty is removed; anything else is
reported and left alone.
"""
import argparse
import json
import subprocess
import time
from pathlib import Path

STALE_INTERVAL_SECONDS = 300


def docker(*args, timeout=180):
    result = subprocess.run(['docker'] + list(args), capture_output=True, text=True,
                            timeout=timeout, encoding='utf-8', errors='replace')
    return (result.stdout or '') + (result.stderr or '')


def scan(container):
    """List every engineering sandbox repo in the container with its lock state."""
    script = (
        'for repo in /state/work/workspaces/*/engineering/repo; do\n'
        '  [ -d "$repo/.git" ] || continue\n'
        '  agent=$(basename "$(dirname "$(dirname "$repo")")")\n'
        '  locks=$(find "$repo/.git" -maxdepth 1 -name "*.lock" 2>/dev/null | tr "\\n" ",")\n'
        '  head=$(cat "$repo/.git/HEAD" 2>/dev/null)\n'
        '  idx=$(wc -c < "$repo/.git/index" 2>/dev/null)\n'
        '  printf "%s|%s|%s|%s\\n" "$agent" "$head" "$idx" "$locks"\n'
        'done'
    )
    out = docker('exec', container, 'sh', '-c', script)
    rows = []
    for line in out.splitlines():
        parts = line.strip().split('|')
        if len(parts) == 4 and parts[0]:
            rows.append({'agent': parts[0], 'head': parts[1], 'indexBytes': parts[2],
                         'locks': [x for x in parts[3].split(',') if x]})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', default='qiandengji-qwenpaw-1')
    parser.add_argument('--apply', action='store_true', help='remove the stale locks (default: report only)')
    args = parser.parse_args()

    rows = scan(args.container)
    print('== engineering sandboxes in %s ==' % args.container)
    removed, kept = [], []
    for row in rows:
        state = 'clean' if not row['locks'] else 'LOCKED'
        print('  %-16s %-34s index=%-8s %s' % (row['agent'], row['head'][:34], row['indexBytes'], state))
        for lock in row['locks']:
            info = docker('exec', args.container, 'sh', '-c',
                          'stat -c "%%s %%Y" %s 2>/dev/null' % lock).strip().split()
            size = int(info[0]) if info and info[0].isdigit() else -1
            mtime = int(info[1]) if len(info) > 1 and info[1].isdigit() else 0
            age = time.time() - mtime
            # An empty lock with no writer is the restart artifact; anything else is real work
            # in progress and gets reported rather than touched.
            stale = size == 0 and age > STALE_INTERVAL_SECONDS
            print('      %s  size=%s age=%.0f min  %s' % (
                lock, size, age / 60, 'STALE (safe to remove)' if stale else 'in use / not empty - left alone'))
            if stale and args.apply:
                docker('exec', args.container, 'sh', '-c',
                       'cp %s /tmp/%s.bak 2>/dev/null; rm -f %s && echo removed' % (lock, Path(lock).name, lock))
                removed.append(lock)
                print('      removed (backup kept in /tmp)')
            elif stale:
                kept.append(lock)
    if kept:
        print('\n%d stale lock(s) found; re-run with --apply to remove them.' % len(kept))
    if removed:
        print('\nremoved %d stale lock(s):' % len(removed))
        for lock in removed:
            print('  ', lock)
        print('Tell the affected agent a host action happened: it retries its commit only after a receipt.')
    if not kept and not removed:
        print('\nno stale locks: every engineering sandbox is committable.')


if __name__ == '__main__':
    main()
