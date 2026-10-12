"""Read-only current-run tick, heap and GC diagnostics. Never starts a profiler."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time
from urllib.request import urlopen
from society_lab import DEFAULT_ROOT, REPO


def assess(metrics: dict, java_pid: int, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    checks = {}
    try:
        age = now - datetime.fromisoformat(metrics['sampledAt'].replace('Z', '+00:00')).timestamp()
        checks['fresh-current-process'] = (-2 <= age <= 20 and metrics['pid'] == java_pid
            and metrics['schemaVersion'] == 1 and isinstance(metrics['runId'], str))
        checks['bounded-samples'] = 1 <= metrics['sampleCount'] <= metrics['windowCapacity'] == 1200
        checks['finite-timings'] = all(isinstance(metrics[k], (int, float)) and not isinstance(metrics[k], bool)
            and math.isfinite(metrics[k]) and metrics[k] >= 0
            for k in ('meanMs', 'p50Ms', 'p95Ms', 'p99Ms', 'maxMs', 'uptimeSeconds'))
        checks['ordered-percentiles'] = (metrics['p50Ms'] <= metrics['p95Ms'] <= metrics['p99Ms'] <= metrics['maxMs']
            and metrics['meanMs'] <= metrics['maxMs']
            and 0 <= metrics['slowTicksOver50Ms'] <= metrics['sampleCount'])
        checks['valid-heap-gc'] = (0 <= metrics['heapUsedBytes'] <= metrics['heapCommittedBytes'] <= metrics['heapMaxBytes']
            and metrics['gcCount'] >= 0 and metrics['gcTimeMs'] >= 0)
        warnings = []
        if metrics['meanMs'] >= 40 or metrics['p95Ms'] >= 50: warnings.append('tick_budget_pressure')
        if metrics['heapUsedBytes'] / max(1, metrics['heapMaxBytes']) >= .85: warnings.append('heap_pressure')
        return {'ok': all(checks.values()), 'checks': checks, 'sampleAgeSeconds': round(age, 3),
                'warnings': warnings, 'metrics': metrics}
    except (KeyError, TypeError, ValueError, OverflowError):
        return {'ok': False, 'checks': checks, 'code': 'invalid_performance_snapshot'}


def probe(root: Path = DEFAULT_ROOT) -> dict:
    report = {'schemaVersion': 1, 'scope': 'current_process_tick_heap_gc_and_pinned_optimizers',
              'modelRequests': 0, 'worldActions': 0, 'ok': False, 'checks': {}}
    try:
        health = json.load(urlopen('http://127.0.0.1:28985/healthz', timeout=5))
        java = next(s for s in health['services'] if s['id'] == 'java')
        report['checks']['owned-supervisor'] = health['healthy'] is True and java['ready'] is True
        metrics = json.loads((root/'server/ops/maw-performance/metrics.json').read_bytes())
        measured = assess(metrics, java['pid'])
        report.update({k: v for k, v in measured.items() if k not in ('ok', 'checks')})
        report['checks'].update(measured['checks'])
        manifest = json.loads((REPO/'manifests/society-performance-1.21.1.lock.json').read_bytes())
        for r in manifest['artifacts']:
            p = root/'server/mods'/r['name']
            report['checks']['jar:' + r['name']] = (p.is_file()
                and hashlib.sha256(p.read_bytes()).hexdigest() == r['sha256'])
        report['ok'] = measured['ok'] and all(report['checks'].values())
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'[:250]
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    value = probe(parser.parse_args().root)
    print(json.dumps(value, ensure_ascii=False, indent=2))
    raise SystemExit(0 if value['ok'] else 1)
