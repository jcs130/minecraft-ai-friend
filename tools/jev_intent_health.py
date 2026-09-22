"""Read-only classification readiness and current tested source evidence; no model or game calls."""
import hashlib
import json
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {'world/src/application/jev-intent.ts', 'world/src/gameplay/commands/spoken-intent.ts',
            'world/src/mc-god.ts', 'world/tests-ai/jev-intent.test.mjs',
            'world/src/application/public-npc-chat.ts', 'world/tests-ai/public-npc-chat.test.mjs',
            'world/sidecar/npc_public_chat.py', 'world/sidecar/mc_npc.py', 'world/sidecar/log_tail.py',
            'tests/test_npc_public_chat.py', 'world/sidecar/world_content.py', 'world/sidecar/mc_guild.py',
            'tests/test_world_content.py'}


def check(root=ROOT):
    root = Path(root)
    checks = dict.fromkeys(('fresh_runtime', 'official_provider_ready', 'bounded_slots', 'public_npc_consumer', 'tested_sources_current'), False)
    evidence = {}
    try:
        h = json.loads((root/'server/world-data/world-heartbeat.json').read_text('utf8'))
        j = h['jevIntent']
        checks['fresh_runtime'] = type(h.get('ts')) in (int, float) and -5 <= time.time()-h['ts']/1000 <= 180
        checks['official_provider_ready'] = j.get('schema') == 1 and j.get('provider') == 'official-jev' and j.get('configured') is True
        checks['bounded_slots'] = j.get('limit') == 2 and type(j.get('inFlight')) is int and 0 <= j['inFlight'] <= 2
        npc = json.loads((root/'server/mcdata/npc-health.json').read_text('utf8'))
        routing = npc.get('public_chat_routing', {})
        checks['public_npc_consumer'] = (j.get('publicNpcRoutingVersion') == 1
            and -5 <= time.time()-npc.get('updated_at', 0) < 30 and npc.get('threads', {}).get('inbox') is True
            and npc.get('story_dialogue_version') == 1
            and routing.get('version') == 1 and routing.get('owner') == 'world-public-chat'
            and -5 <= time.time()-routing.get('lastPoll', 0) < 30)
        evidence = {k: j.get(k) for k in ('requests', 'accepted', 'fallback', 'busy', 'lastLatencyMs', 'lastRoute', 'lastStatus')}
        report = json.loads((root/'reports/jev-intent-smoke.json').read_text('utf8'))
        sources = report['sources']
        def digest(name):
            p = (root/name).resolve()
            if not p.is_relative_to(root.resolve()): raise ValueError('invalid_source')
            return hashlib.sha256(p.read_bytes()).hexdigest()
        checks['tested_sources_current'] = (report.get('ok') is True and report.get('worldActions') == 0
            and report.get('testsPassed', 0) >= 7 and report.get('npcTestsPassed', 0) >= 6
            and REQUIRED <= set(sources) and len(sources) < 20
            and all(digest(p) == sha for p, sha in sources.items()))
    except (OSError, ValueError, TypeError, KeyError, AttributeError): pass
    return {'ok': all(checks.values()), 'checks': checks, 'evidence': evidence, 'modelRequests': 0, 'worldActions': 0,
            'scope': 'Provider configuration, current tested bytes, bounded runtime. Synthetic calibration does not prove player intent accuracy.'}


if __name__ == '__main__':
    result = check(); print(json.dumps(result)); raise SystemExit(0 if result['ok'] else 1)
