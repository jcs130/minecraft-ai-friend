"""Read-only deployment gate. Never removes files or changes filesystem quotas."""
from pathlib import Path
import argparse
import json
import os
import shutil

GIB = 1024 ** 3


def storage_budget(paths, *, minimum_free_bytes=2 * GIB, write_budget_bytes=0,
                   minimum_free_inodes=1024, probe=None):
    if not paths or any(not isinstance(n, int) or n < 0 for n in
                        [minimum_free_bytes, write_budget_bytes, minimum_free_inodes]):
        raise ValueError('Invalid storage budget')
    checks = []
    for value in paths:
        requested = Path(value).resolve()
        existing = requested
        while not existing.exists():
            if existing.parent == existing:
                raise ValueError('No existing filesystem for deployment path')
            existing = existing.parent
        if probe is not None or hasattr(os, 'statvfs'):
            stat = (probe or os.statvfs)(existing)
            block = stat.f_frsize or stat.f_bsize
            # f_bfree includes root-reserved blocks. The website runs as UID
            # 1000 and cannot use those blocks; disk "free" alone is unsafe.
            available = stat.f_bavail * block
            inodes = stat.f_favail if stat.f_files else None
        else:
            available = shutil.disk_usage(existing).free
            inodes = None
        required = minimum_free_bytes + write_budget_bytes
        reason = ('PORTAL_STORAGE_LOW_SPACE' if available < required else
                  'PORTAL_STORAGE_LOW_INODES' if inodes is not None and inodes < minimum_free_inodes else None)
        checks.append({'path': str(requested), 'availableBytes': available,
                       'requiredBytes': required, 'availableInodes': inodes,
                       'passed': reason is None, 'reason': reason})
    return {'passed': all(row['passed'] for row in checks), 'checks': checks}


def require_storage(paths, **kwargs):
    report = storage_budget(paths, **kwargs)
    if not report['passed']:
        raise RuntimeError(json.dumps(report))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+')
    parser.add_argument('--minimum-free-mib', type=int, default=2048)
    parser.add_argument('--write-budget-mib', type=int, default=0)
    args = parser.parse_args()
    result = storage_budget(args.paths, minimum_free_bytes=args.minimum_free_mib * 1024 ** 2,
                            write_budget_bytes=args.write_budget_mib * 1024 ** 2)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 2)
