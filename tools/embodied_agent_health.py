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
           'world/survival/party.py', 'world/sidecar/party_messages.py', 'tests/test_social_scheduling.py',
           'tests/test_dialogue_batch.py', 'tests/test_behavior_context.py', 'tests/test_survival_service.py',
           'world/ops/survival_submission_runtime.py', 'tests/test_survival_submission_runtime.py')
SOURCES += ('tests/test_survival_gateway.py',)
SOURCES += ('world/survival/motor_mailbox.py', 'world/survival/motor_loop.py',
            'tests/test_motor_mailbox.py', 'tests/test_async_motor.py', 'tests/test_survival_navigation_deadline.py')
SOURCES += ('world/survival/skill_router.py', 'world/survival/starter_skills.py',
            'tests/test_skill_catalog_router.py', 'tests/test_survival_fast_execution.py',
            'tests/test_skill_catalog_index.py', 'tests/test_skill_catalog_latency.py')
SOURCES += ('world/survival/navigation_sense.py', 'world/survival/chat.py', 'tests/test_survival_inventory_feedback.py',
            'tests/test_survival_controller.py', 'tests/test_survival_status_detail.py',
            'tests/test_survival_navigation_sense.py', 'tests/test_motor_projection.py',
            'tests/test_survival_area_recovery.py', 'tests/test_survival_chat.py', 'tests/test_motor_boundary.py')
SOURCES += ('tools/configure_survivor_vision.py', 'tools/sync_survivor_driver_scope.py',
            'tests/test_configure_survivor_vision.py', 'tests/test_survivor_driver_scope.py',
            'tests/test_survival_native_tools.py', 'tools/smoke_survivor_chat.py',
            'world/ops/skills/qd-survivor-practice/SKILL.md',
            'world/ops/skills/qd-survivor-practice/references/exploration.md',
            'world/ops/skills/qd-survivor-practice/references/long-term-planning.md')
SOURCES += ('world/survival/game_skills.py', 'tests/test_survival_game_skills.py',
            'tests/test_survival_skill_tools.py', 'world/survival/control.py')
SOURCES += ('world/survival/mine_actions.py', 'tests/test_survival_mine_receipts.py',
            'world/irons-bridge-src/src/dev/qiandeng/irons/WorldInteractionBridge.java')
SOURCES += ('world/sidecar/party_bridge.py', 'tests/test_party_bridge.py',
            'tests/test_party_life.py', 'tests/test_yui_admin_team.py',
            'world/ops/skills/qd-yui-rescue/references/rescue.md',
            'world/ops/skills/qd-yui-rescue/references/world-admin.md')
SOURCES += ('world/survival/food_actions.py', 'tests/test_survival_food_receipts.py',
            'tests/test_survival_native_interaction.py', 'tests/test_motor_cast_acceptance.py',
            'tools/smoke_mine_receipts.py', 'world/irons-bridge-src/qa/MiningQa.java',
            'world/irons-bridge-src/tests/InteractionArgumentsTest.java')


def runtime_protocols(settings, heartbeat, public):
    """Check loaded runtime fields, without treating them as gameplay proof."""
    pacing = public.get('pacing') if isinstance(public.get('pacing'), dict) else {}
    enabled = settings.get('livestreamMode') is True
    live = (heartbeat.get('livestreamPacingVersion') == 1 and pacing.get('version') == 1
            and pacing.get('enabled') is enabled)
    if enabled:
        seconds = settings.get('livestreamReviewSeconds', 45)
        maximum = settings.get('livestreamBlockedMaxSeconds', 180)
        cap, reason = pacing.get('idleCapSeconds'), pacing.get('reason')
        live = (live and type(seconds) is int and 15 <= seconds <= 120
                and type(maximum) is int and seconds <= maximum <= 600
                and pacing.get('reviewSeconds') == seconds and pacing.get('blockedMaxSeconds') == maximum
                and ((reason in ('goal_ongoing', 'next_goal') and cap == seconds)
                     or (reason == 'goal_blocked' and type(cap) is int and seconds <= cap <= maximum)
                     or (reason in ('agent_resting', 'body_work_pending', 'outcome_unknown',
                                    'sleep_entered', 'agent_interval') and cap is None)))
    motor = public.get('motor') if isinstance(public.get('motor'), dict) else {}
    recovery = heartbeat.get('outsideAreaRecoveryVersion') == 1
    if settings.get('asyncMotor') is True:
        recovery = (recovery and motor.get('version') == 1 and isinstance(motor.get('status'), str)
                    and 'blocked' in motor)
        if motor.get('status') in ('outside_work_area', 'recovery_dispatching'):
            block = motor.get('blocked') if isinstance(motor.get('blocked'), dict) else {}
            recovery = (recovery and block.get('code') == 'outside_work_area'
                        and isinstance(block.get('position'), dict) and isinstance(block.get('workArea'), dict))
    return {'livestream_pacing': bool(live), 'outside_area_recovery': bool(recovery)}


def check(root=ROOT, clock=time.time):
    root = Path(root)
    checks = dict.fromkeys(('generation_binding', 'supervised_heartbeat', 'archive_outside_retrieval',
                            'archive_verified', 'current_prompt', 'public_brain', 'behavior_test', 'native_mcp_recovery',
                            'social_scheduling', 'action_outcome_known',
                            'livestream_pacing', 'outside_area_recovery'), False)
    try:
        read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
        state = root / 'server/survival-agent-state/survival'
        workspace = root / 'server/agents/work/workspaces/qd-survivor'
        settings, heartbeat = read(state / 'settings.json'), read(state / 'heartbeat.json')
        control, lease = read(state / 'control.json'), read(state / 'lease.json')
        checks['action_outcome_known'] = (not (state / 'unknown.json').exists()
            and lease.get('status') != 'unknown'
            and control.get('pauseReason') != 'action_outcome_unknown')
        marker = read(workspace / 'embodiment.json')
        epoch = settings['memoryEpoch']
        runtime = read(root / 'server/agents/work/learning-runtime.json')
        checks['native_mcp_recovery'] = (runtime.get('nativeMcpRecoveryVersion') == 1
            and runtime.get('survivalSubmissionReceiptVersion') == 1)
        checks['generation_binding'] = settings.get('brainProtocol') == 1 and marker.get('memoryEpoch') == epoch
        checks['supervised_heartbeat'] = (heartbeat.get('brainProtocol') == 1 and heartbeat.get('memoryEpoch') == epoch
            and heartbeat.get('ok') is True and -5000 < clock() * 1000 - heartbeat['at'] < 90000)
        checks['social_scheduling'] = (heartbeat.get('socialSchedulingVersion') == 1
            and heartbeat.get('goalAgendaReady') is True and heartbeat.get('socialProgressVersion') == 1)
        cutover = read(root / 'runtime/embodied-agent-cutover.json')
        backup = Path(cutover['archive']).resolve()
        checks['archive_outside_retrieval'] = (cutover.get('phase') == 'completed' and cutover.get('memoryEpoch') == epoch
            and backup.is_relative_to(root.resolve() / 'runtime/embodied-agent-archives'))
        receipt = read(backup / 'receipt.json')
        checks['archive_verified'] = receipt.get('hashVerified') is True and receipt.get('memoryEpoch') == epoch
        checks['current_prompt'] = ((workspace / 'AGENTS.md').read_text(encoding='utf8')
                                    == (root / 'world/survival/AGENT.md').read_text(encoding='utf8'))
        public = read(root / 'server/panel-state/survivor.json')
        checks.update(runtime_protocols(settings, heartbeat, public))
        brain = public.get('embodiment', {})
        checks['public_brain'] = (brain.get('version') == 1 and brain.get('memoryEpoch') == epoch
                                 and brain.get('dialogueBodyAccess') == 'read_only')
        report = read(root / 'reports/embodied-agent-smoke.json')
        checks['behavior_test'] = (report.get('ok') is True and report.get('testsRun', 0) >= 20
            and all(any(name.startswith(prefix) for name in report.get('tests', [])) for prefix in (
                'test_skill_catalog_router.', 'test_social_scheduling.', 'test_dialogue_batch.', 'test_behavior_context.', 'test_survival_service.',
                'test_survival_status_detail.', 'test_survival_feedback.', 'test_survival_guild.',
                'test_survival_life_session.ContinuousActionTests.', 'test_survival_standing_task.',
                'test_survival_controller.ControllerTests.test_livestream_', 'test_motor_projection.',
                'test_survival_area_recovery.', 'test_survival_chat.', 'test_survival_navigation_sense.', 'test_motor_boundary.',
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
