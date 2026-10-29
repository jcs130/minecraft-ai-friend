"""Verify recorded real lab receipts; this script sends no game commands."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


def verify(root, output):
    root = Path(root).resolve(strict=True)
    assert json.loads((root / 'pack-source.json').read_text())['scope'] == 'isolated_testing'
    rows = [json.loads(line) for line in (root / 'acceptance/gameplay-SAOQuestProbe.jsonl').read_text('utf-8').splitlines()]
    receipts = [r['result'] for r in rows]
    def find(operation, predicate=lambda r: True):
        return next(r for r in reversed(receipts) if r.get('operation') == operation and predicate(r))
    checks = []
    def check(name, condition):
        checks.append({'name': name, 'passed': bool(condition)})
        if not condition:
            raise AssertionError(name)

    choice = find('sao.profession.choose', lambda r: r.get('reason') == 'profession_selected')
    check('native_profession_changed_0_to_1', choice['data']['before']['professionId'] == 0 and choice['data']['after']['professionId'] == 1)
    check('real_switch_scroll_consumed', any((d.get('before') or {}).get('id') == 'mod_1cab0b39:profession_switch_scroll' and d.get('after') is None for d in choice['inventoryChanges']))
    claim = find('sao.reward.claim', lambda r: r.get('reason') == 'native_reward_claimed')
    check('native_reward_has_real_inventory_delta', any((d.get('after') or {}).get('id') == 'farmersdelight:egg_sandwich' and d['after']['count'] == 8 for d in claim['inventoryChanges']))
    snapshot = next(r['result'] for r in reversed(rows) if r['kind'] == 'snapshot')
    check('reconnect_and_duplicate_did_not_double_reward', sum(s.get('count', 0) for s in snapshot['menu']['slots'] if isinstance(s, dict) and s.get('id') == 'farmersdelight:egg_sandwich') == 8)
    check('snapshot_uses_real_mana_provider', snapshot['self'].get('mana') is not None and 'manaUnavailableReason' not in snapshot['self'])
    check('same_request_returns_history', any(r.get('operation') == 'sao.reward.claim' and r.get('replayed') and r.get('historical') for r in receipts))
    check('changed_parameters_reusing_id_are_refused', find('sao.reward.claim', lambda r: r.get('reason') == 'request_id_conflict')['changed'] is False)
    historical = find('sao.action_status', lambda r: r.get('data', {}).get('requestId') == 'starter-claim-test-1')
    check('cross_restart_history_retains_old_observation', historical['data'].get('historical') and historical['serverEpoch'] != historical['data']['serverEpoch'] and historical['observedAt'] > historical['data']['observedAt'])
    task = find('sao.task.submit', lambda r: r.get('reason') == 'native_task_progressed')
    check('native_checkmark_progress_0_to_1', task['data']['beforeProgress'] == 0 and task['data']['task']['progress'] == 1 and task['data']['questCompleted'])
    check('tracking_is_separate_from_completion', find('sao.quest.track')['reason'] == 'quest_pinned_not_completed')
    for op in ['sao.talent.buy', 'sao.attribute.buy']:
        result = find(op)
        check(op + '_no_points_no_change', not result['ok'] and result['changed'] is False and result['data']['before'] == result['data']['after'])
    for request, reason in [('locked-cast-real-1', 'level_requirement'), ('unequipped-cast-real-1', 'slot_not_equipped')]:
        r = find('sao.skill.cast', lambda r: r.get('requestId') == request)
        check(reason + '_no_change', r['reason'] == reason and r['changed'] is False)
    cast = find('sao.skill.cast', lambda r: r.get('requestId') == 'native-warrior-cast-1')['data']
    check('real_cast_spends_resource_and_sets_cooldown', cast['before']['nativeResource']['current'] > cast['after']['nativeResource']['current'] and cast['after']['loadout'][2]['cooldownRemainingMs'] > 0)
    check('cast_does_not_claim_a_hit', cast['reason'] == 'cast_started_not_hit_confirmed')
    prof = find('sao.professions', lambda r: r.get('ok') and r.get('data', {}).get('id') == 1)['data']
    check('native_active_skills_and_passives_are_distinct', len(prof['skills']) == 6 and len(prof['passives']) == 1)
    check('declared_timing_is_not_misreported_as_effective', 'baseCooldownMs' in prof['skills'][0] and 'cooldownMs' not in prof['skills'][0])
    pages = [r for r in receipts if r.get('operation') == 'sao.quests.list' and r.get('ok') and r.get('serverEpoch') == historical['serverEpoch']]
    first = next(r['data'] for r in pages if r['data'].get('offset') == 0 and r['data'].get('returnedCount') == 2)
    second = next(r['data'] for r in pages if r['data'].get('offset') == 2)
    check('two_real_pages_have_consistent_counts_and_no_overlap', first['nextOffset'] == 2 and second['nextOffset'] == 4 and first['remainingCount'] == second['remainingCount'] + 2 and not ({q['id'] for q in first['quests']} & {q['id'] for q in second['quests']}))
    check('query_over_limit_has_accurate_field_diagnostic', any(r.get('status') == 'invalid_arguments' and r.get('diagnostic', {}).get('field') == 'args.limit' for r in receipts))
    own = json.loads((root / 'acceptance/mod_query-latest.json').read_text())
    check('other_numen_body_cannot_read_probe_action', own['bodyId'] != choice['bodyId'] and own['data']['status'] == 'unknown' and not own['data']['outcomeKnown'])
    catalog = json.loads((root / 'acceptance/mod_operations-latest.json').read_text())
    check('numen_default_catalog_is_short_not_all_schemas', len(catalog['operations']) == 18 and all(set(o) == {'id', 'readOnly'} for o in catalog['operations']))
    native = json.loads((root / 'acceptance/action_status-sao-native-track-20261029-1.json').read_text())
    check('numen_lease_queue_reached_native_terminal', native['phase'] == 'terminal' and native['ok'] and native['outcome']['reason'] == 'quest_pinned_not_completed')
    check('probe_has_no_op', not any(p['uuid'] == choice['bodyId'] for p in json.loads((root / 'server/ops.json').read_text())))
    check('all_native_replies_respect_16k_budget', all(len(json.dumps(r, ensure_ascii=False, separators=(',', ':')).encode()) <= 16384 for r in receipts if r.get('provider') == 'sao_native'))
    process = json.loads((root / 'lab-process.json').read_text())
    check('isolated_server_is_ready_on_loopback', process['phase'] == 'ready' and process['bind'] == '127.0.0.1' and process['port'] == 39676)
    report = {'schemaVersion': 1, 'scope': 'isolated_testing', 'observedAt': datetime.now(timezone.utc).isoformat(), 'serverPid': process['pid'], 'checks': checks, 'passed': len(checks),
              'addonSha256': hashlib.sha256((root / 'server/mods/maw-sao-native-0.1.0.jar').read_bytes()).hexdigest(), 'evidenceFile': 'acceptance/gameplay-SAOQuestProbe.jsonl',
              'limits': ['Not a full 934-quest completion audit', 'Does not prove every class combat outcome or automatic crafting', 'Model discovery quality is recorded separately from native API success']}
    runtime = root / 'kirito-runtime'
    host = runtime / 'data/sessions/923b69d6b199861d747b587d/host'
    if (host / 'receipts.jsonl').exists():
        started = datetime.fromisoformat(json.loads((runtime / 'process.json').read_text('utf-8-sig'))['startedAt'])
        actor_rows = [json.loads(line) for line in (host / 'receipts.jsonl').read_text('utf-8').splitlines()]
        effects, read_times = [], []
        for row in actor_rows:
            result = row.get('result', {})
            receipt = result.get('data', {}).get('serverReceipt')
            if isinstance(receipt, dict) and datetime.fromisoformat(receipt['observedAt']) >= started and receipt.get('changed') and receipt.get('data', {}).get('questCompleted'):
                effects.append({'requestId': receipt['requestId'], 'bodyId': receipt['bodyId'], 'operation': receipt['operation'], 'observedAt': receipt['observedAt'], 'task': receipt['data'].get('task'), 'questCompleted': True})
            if row.get('tool') == 'mc_sao':
                try:
                    # Current tools return typed data; older immutable evidence
                    # used a JSON text body. Accept both without inventing data.
                    read = result.get('data', {}).get('response')
                    if not isinstance(read, dict):
                        read = json.loads(result.get('text', ''))
                    if read.get('readOnly') and datetime.fromisoformat(read['observedAt']) >= started:
                        read_times.append(datetime.fromisoformat(read['observedAt']))
                except (ValueError, KeyError):
                    pass
        if effects and read_times:
            first = min(datetime.fromisoformat(e['observedAt']) for e in effects)
            begin = min(read_times)
            decisions = [json.loads(line) for line in (host / 'decisions.jsonl').read_text('utf-8').splitlines()]
            calls = sum(len(row.get('response', {}).get('tool_calls') or []) for row in decisions if begin <= datetime.fromisoformat(row['at']) <= first)
            report['modelAcceptance'] = {'model': 'qwen3.7-plus', 'provider': 'online_tokenplan', 'imageInput': False, 'scenario': 'SAO discovery to first confirmed tutorial checkmark', 'focusedOperatorFeedbackProvided': True,
                                        'firstReadAt': begin.isoformat(), 'firstConfirmedEffectAt': first.isoformat(), 'modelToolCallsBetween': calls, 'confirmedNativeEffects': effects, 'fullAutonomousStoryVerified': False}
    Path(output).write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode())
    print(json.dumps({'passed': len(checks), 'report': str(output), 'addonSha256': report['addonSha256']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    verify(args.root, args.output)
