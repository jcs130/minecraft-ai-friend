"""Read-only deployment checks; no inference or body action is a health probe."""
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('world/survival/embodiment.py', 'world/survival/sensors.py', 'world/survival/dialogue.py',
           'world/survival/controller.py', 'world/survival/behavior_context.py', 'world/survival/fast_execution.py',
           'world/survival/skill_library.py', 'world/survival/mcp_server.py', 'world/survival/AGENT.md',
           'world/survival/life_cycle.py', 'world/survival/world_adapter.py', 'world/survival/native_tools.py',
           'world/survival/numen_gateway.py', 'world/survival/world_actions.py',
           'world/survival/guild.py', 'world/sidecar/guild_requests.py',
           'tests/test_survival_feedback.py', 'tests/test_survival_guild.py',
           'tests/test_survival_life_session.py', 'world/survival/standing_task.py',
           'tests/test_survival_standing_task.py', 'tools/smoke_embodied_agent.py',
           'tools/embodied_agent_health.py', 'tests/test_survival_poll_recovery.py',
           'world/sidecar/mc_guild.py', 'tests/test_guild_hunt_score.py',
           'world/survival/system_one.py', 'world/survival/service.py', 'world/survival/game_service.py',
           'world/ops/native_mcp_recovery.py', 'world/sidecar/qwen_tasks.py',
           'world/sidecar/party_life.py', 'world/sidecar/native_tool_connection.py',
           'tests/test_native_continuity.py', 'tests/test_native_mcp_recovery.py', 'tests/test_system_one.py',
           'world/survival/policy_worker.py', 'tests/test_embodied_agent.py',
           'world/survival/goal_agenda.py', 'world/survival/social_attention.py',
           'world/survival/party.py', 'world/sidecar/party_messages.py', 'tests/test_social_scheduling.py')


def check(root=ROOT, clock=time.time):
    root = Path(root)
    checks = dict.fromkeys(('generation_binding', 'supervised_heartbeat', 'archive_outside_retrieval',
                            'archive_verified', 'current_prompt', 'public_brain', 'behavior_test', 'native_mcp_recovery',
                            'social_scheduling'), False)
    try:
        read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
        state = root / 'server/survival-agent-state/survival'
        workspace = root / 'server/agents/work/workspaces/qd-survivor'
        settings, heartbeat = read(state / 'settings.json'), read(state / 'heartbeat.json')
        marker = read(workspace / 'embodiment.json')
        epoch = settings['memoryEpoch']
        runtime = read(root / 'server/agents/work/learning-runtime.json')
        checks['native_mcp_recovery'] = runtime.get('nativeMcpRecoveryVersion') == 1
        checks['generation_binding'] = settings.get('brainProtocol') == 1 and marker.get('memoryEpoch') == epoch
        checks['supervised_heartbeat'] = (heartbeat.get('brainProtocol') == 1 and heartbeat.get('memoryEpoch') == epoch
            and heartbeat.get('ok') is True and -5000 < clock() * 1000 - heartbeat['at'] < 90000)
        checks['social_scheduling'] = (heartbeat.get('socialSchedulingVersion') == 1
            and heartbeat.get('goalAgendaReady') is True)
        cutover = read(root / 'runtime/embodied-agent-cutover.json')
        backup = Path(cutover['archive']).resolve()
        checks['archive_outside_retrieval'] = (cutover.get('phase') == 'completed' and cutover.get('memoryEpoch') == epoch
            and backup.is_relative_to(root.resolve() / 'runtime/embodied-agent-archives'))
        receipt = read(backup / 'receipt.json')
        checks['archive_verified'] = receipt.get('hashVerified') is True and receipt.get('memoryEpoch') == epoch
        checks['current_prompt'] = ((workspace / 'AGENTS.md').read_text(encoding='utf8')
                                    == (root / 'world/survival/AGENT.md').read_text(encoding='utf8'))
        public = read(root / 'server/panel-state/survivor.json')
        brain = public.get('embodiment', {})
        checks['public_brain'] = (brain.get('version') == 1 and brain.get('memoryEpoch') == epoch
                                 and brain.get('dialogueBodyAccess') == 'read_only')
        report = read(root / 'reports/embodied-agent-smoke.json')
        checks['behavior_test'] = (report.get('ok') is True and report.get('testsRun', 0) >= 20
            and all(any(name.startswith(prefix) for name in report.get('tests', [])) for prefix in (
                'test_social_scheduling.', 'test_survival_status_detail.', 'test_survival_feedback.', 'test_survival_guild.',
                'test_survival_life_session.ContinuousActionTests.', 'test_survival_standing_task.',
                'test_survival_poll_recovery.PollRecoveryTests.', 'test_guild_hunt_score.HuntScoreTests.'))
            and report.get('modelCalls') == 0 and report.get('productionMutations') == 0
            and all(report.get('sourceHashes', {}).get(name) == hashlib.sha256((root / name).read_bytes()).hexdigest()
                    for name in SOURCES))
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'modelCalls': 0, 'worldActions': 0,
            'scope': 'Embodied runtime and isolated behavior checks; not general intelligence or RSI improvement proof.'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result))
    raise SystemExit(0 if result['ok'] else 1)
