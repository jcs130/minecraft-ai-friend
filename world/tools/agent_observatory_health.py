#!/usr/bin/env python3
"""Health probe for the agent observatory surface — read-only, zero model calls.

Checks that the panel's observatory page and its data endpoints are reachable
and returning the expected shape. Used by the voice-boundary health test.
"""
import json
import os
import sys
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PANEL_BASE = os.environ.get('PANEL_BASE', 'http://127.0.0.1:19091')


def check(name, ok, detail=''):
    status = '✓' if ok else '✗'
    print(f'  {status} {name}: {detail[:100]}')
    return ok


def probe():
    results = []
    
    # 1. Panel is reachable
    try:
        with urllib.request.urlopen(f'{PANEL_BASE}/healthz', timeout=5) as r:
            results.append(check('panel_healthz', r.status == 200, f'status={r.status}'))
    except Exception as e:
        results.append(check('panel_healthz', False, str(e)[:80]))

    # 2. Observatory page
    try:
        with urllib.request.urlopen(f'{PANEL_BASE}/observatory', timeout=5) as r:
            results.append(check('observatory_page', r.status == 200, f'status={r.status}'))
    except Exception as e:
        results.append(check('observatory_page', False, str(e)[:80]))

    # 3. Survivor trace API
    try:
        with urllib.request.urlopen(f'{PANEL_BASE}/api/survivor-trace', timeout=5) as r:
            data = json.loads(r.read())
            available = data.get('available', False)
            results.append(check('survivor_trace', r.status == 200, f'available={available}'))
    except Exception as e:
        results.append(check('survivor_trace', False, str(e)[:80]))

    # 4. RSI observatory API
    try:
        with urllib.request.urlopen(f'{PANEL_BASE}/api/rsi-observatory', timeout=5) as r:
            results.append(check('rsi_observatory', r.status == 200, f'status={r.status}'))
    except Exception as e:
        results.append(check('rsi_observatory', False, str(e)[:80]))

    passed = sum(1 for r in results if r)
    total = len(results)
    print(f'\n  Observatory health: {passed}/{total} passed')
    return passed == total


if __name__ == '__main__':
    ok = probe()
    sys.exit(0 if ok else 1)
