import json
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor

import pytest

from agent_mc_autonomy.death_memory import DeathMemory
from agent_mc_autonomy.review_evidence import encoded
from test_controller import setup as controller_setup
from test_death_memory import SCOPE, event, facts
from test_death_reflection_contract import reflection
from test_review_speech import setup


def combat(index=119, cursor=3):
    return {'run': 'native-run', 'cursor': cursor, 'ts': '2026-10-15T01:02:04Z', 'type': 'minecraft.combat',
            'meta': {'receipt': {'id': index, 'scope': SCOPE, 'deathEpisodeId': 'death-1', 'reason': 'death',
                'startedAt': '2026-10-15T01:01:54Z', 'endedAt': '2026-10-15T01:02:04Z',
                'healthBefore': 12, 'healthAfter': 0, 'swings': 0, 'meleeLanded': 0, 'arrows': 0, 'rangedLanded': 0,
                'controlSummary': {'schemaVersion': 1, 'finalMode': 'retreating', 'enteredDesperate': False,
                    'retreat': {'startedAt': '2026-10-15T01:01:54Z', 'waterAtStart': True,
                        'bankCandidate': {'x': -18, 'y': 63, 'z': 289}, 'routeStatus': 'unverified',
                        'movement': {'samples': 31, 'horizontalActiveSamples': 0, 'horizontalIntentSamples': 0,
                            'jumpOnlySamples': 31, 'observedHorizontalDistance': 2.5,
                            'progressBasis': 'sampled_position_delta', 'lastRejection': 'no_support'}}}}}}


@pytest.mark.parametrize('split', [False, True])
def test_same_page_or_late_page_appends_exact_death_once_without_new_epoch(framework_module, tmp_path, split):
    _, _, controller = controller_setup(framework_module, tmp_path, None)
    controller.observe_game_facts(facts())
    timeout = combat(118, 2)
    timeout['meta']['receipt'].update(reason='timeout', swings=20)
    if split:
        controller.receipt({'events': [timeout, event()]})
        epoch = controller.death_epoch
        controller.receipt({'events': [combat()]})
        assert controller.death_epoch == epoch
    else:
        controller.receipt({'events': [timeout, event(), combat()]})
    row = controller.death_memory.entries(SCOPE)[0]
    assert len(row['combat_observations']) == 1
    assert row['combat_observations'][0]['id'] == 119 and row['combat_observations'][0]['swings'] == 0
    assert row['combat_observations'][0]['original_event']['cursor'] == 3
    controller.receipt({'events': [combat()]})
    assert controller.death_memory.entries(SCOPE)[0] == row
    assert row['lesson'] is None and row['behavioral_improvement_verified'] is False


@pytest.mark.parametrize('change', ['run', 'episode', 'realm', 'account', 'agent', 'cursor', 'time', 'missing_id', 'timeout', 'archive', 'epoch'])
def test_wrong_or_unattested_report_never_contaminates_episode(framework_module, tmp_path, change):
    _, _, controller = controller_setup(framework_module, tmp_path, None)
    controller.observe_game_facts(facts())
    controller.receipt({'events': [event()]})
    before = deepcopy(controller.death_memory.entries(SCOPE))
    e = combat(); r = e['meta']['receipt']
    if change == 'run': e['run'] = 'other-run'
    elif change == 'episode': r['deathEpisodeId'] = 'other-death'
    elif change in {'realm', 'account', 'agent'}: r['scope'] = {**SCOPE, change: 'other'}
    elif change == 'cursor': e['cursor'] = 1
    elif change == 'time': r['startedAt'] = '2026-10-15T01:02:04Z'
    elif change == 'missing_id': del r['deathEpisodeId']
    elif change == 'timeout': r.update(reason='timeout', swings=20)
    elif change == 'archive': e['contextDelivery'] = 'archive-only'
    elif change == 'epoch': e['meta']['staleEpoch'] = True
    controller.receipt({'events': [e]})
    assert controller.death_memory.entries(SCOPE) == before


@pytest.mark.parametrize('bad', [None, {'schemaVersion': 99}, {'extra': 'x' * 2049}, {'schemaVersion': 1, 'finalMode': []}])
def test_malformed_summary_keeps_original_counters_nulls_and_raw_event(tmp_path, bad):
    store = DeathMemory(tmp_path); store.record(event(), facts(), [], [], [])
    e = combat(); e['meta']['receipt'].update(controlSummary=bad, healthBefore=None)
    original = deepcopy(e)
    assert store.append_combat(e)
    row = store.entries(SCOPE)[0]['combat_observations'][0]
    assert row['healthBefore'] is None and row['swings'] == 0 and 'controlSummary' not in row
    assert e == original


def test_conflicts_and_out_of_order_stay_raw_and_projection_is_bounded(tmp_path):
    store = DeathMemory(tmp_path); initial = store.record(event(), facts(), [], [], [])
    assert store.append_combat(combat())
    conflict = combat(cursor=4); conflict['meta']['receipt']['swings'] = 20
    assert not store.append_combat(conflict)
    assert not store.append_combat(combat(120, 2))
    assert store.append_combat(combat(120, 4))
    assert not store.append_combat(combat(121, 5))
    row = store.entries(SCOPE)[0]
    assert {k: v for k, v in row.items() if k != 'combat_observations'} == initial
    assert len(json.dumps(row['combat_observations'], ensure_ascii=False).encode()) <= 4096


def test_accepted_pending_stale_snapshot_refreshes_next_compact_inspect_and_immutable_detail(tmp_path):
    port, clock, publish = setup(tmp_path); store = DeathMemory(tmp_path)
    episode = store.record(event(), facts(), [], [], [])
    episode['receipts'] = [{'receipt': 'lossless-' * 500}]
    fresh = facts(); fresh['parts'].append({'key': 'gear', 'text': 'empty'})
    publish(death_episode=episode, game_identity=SCOPE, facts=fresh)
    offered = port.offer()
    assert offered.get('review'), offered
    review = offered['review']; port.delivered(review['id'], True)
    first = port.decide(review['id'], 'inspect', compact=True)
    old_path = tmp_path / 'review-evidence' / (first['evidence_ref'] + '.json')
    old_bytes = old_path.read_bytes()
    assert store.append_combat(combat())
    # Repeat the stale accepted snapshot: both hydration seams must preserve newly appended evidence.
    publish(death_episode=episode, game_identity=SCOPE, facts=fresh)
    assert port.state()['review']['id'] == review['id']
    assert port.state()['review']['notification_accepted']
    assert port.decide(review['id'], 'continue', 'Review water retreat', death_reflection=reflection(episode))['error'] == 'fresh_recovery_inspection_required'
    inspected = port.decide(review['id'], 'inspect', compact=True)
    preview = inspected['death_episode']['combat_observations']
    assert preview[0]['id'] == 119 and preview[0]['swings'] == 0
    assert preview[0]['finalMode'] == 'retreating' and not preview[0]['enteredDesperate']
    assert preview[0]['movement']['horizontalActiveSamples'] == 0 and preview[0]['movement']['samples'] == 31
    assert preview[0]['bankCandidate'] == {'x': -18, 'y': 63, 'z': 289} and preview[0]['routeStatus'] == 'unverified'
    assert len(encoded(preview).encode()) <= 1800
    saved = json.loads((tmp_path / 'review-evidence' / (inspected['evidence_ref'] + '.json')).read_text())
    assert saved['evidence']['death_episode']['receipts'] == episode['receipts']
    assert saved['evidence']['death_episode']['combat_observations'][0]['original_event'] == preview[0]['original_event']
    assert old_path.read_bytes() == old_bytes and first['evidence_ref'] != inspected['evidence_ref']
    assert port.decide(review['id'], 'continue', 'Review water retreat', death_reflection=reflection(episode))['acknowledged']
    assert store.entries(SCOPE)[0]['combat_observations'][0]['id'] == 119


def test_concurrent_lesson_and_late_append_preserve_both_without_reopening(tmp_path):
    store = DeathMemory(tmp_path); store.record(event(), facts(), [], [], [])
    def lesson():
        return store.execute(SCOPE, {'action': 'report', 'id': 'death-1', 'lesson': 'Inspect route',
            'applicability': 'Before entering water', 'evidence': 'native-run cursor 1'})
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(lesson), pool.submit(store.append_combat, combat())]
        assert all(f.result() for f in futures)
    row = store.entries(SCOPE)[0]
    assert row['lesson'] and row['combat_observations'][0]['id'] == 119
    assert store.current_episode(SCOPE, facts(), pending=True) is None


def test_completed_main_review_late_evidence_preserves_ack_and_does_not_reopen(tmp_path):
    from test_current_death_hydration import completed_latest
    port, clock, publish, store, older, newer, fresh = completed_latest(tmp_path)
    original_ack, original_reflection = deepcopy(newer['host_review']), deepcopy(newer['reflection'])
    e = combat(); e['meta']['receipt']['deathEpisodeId'] = newer['id']
    assert store.append_combat(e)
    saved = store.entries(SCOPE)[0]
    assert saved['host_review'] == original_ack and saved['reflection'] == original_reflection
    assert saved['combat_observations'][0]['id'] == 119
    clock[0] += 61
    publish(death_episode=newer, game_identity=SCOPE, facts=fresh)
    review = port.offer()['review']
    assert review['trigger'] != 'death_review'
    assert 'death_episode' not in port.decide(review['id'], 'inspect', compact=True)
    assert store.execute(SCOPE, {'action': 'get', 'id': newer['id']})['combat_observations'][0]['id'] == 119


def test_compact_two_reports_fit_byte_cap_and_keep_full_original_paths(tmp_path):
    from agent_mc_autonomy.review_evidence import compact
    store = DeathMemory(tmp_path); store.record(event(), facts(), [], [], [])
    assert store.append_combat(combat()) and store.append_combat(combat(120, 4))
    episode = store.entries(SCOPE)[0]
    output = compact({'death_episode': episode}, 'reference')
    rows = output['death_episode']['combat_observations']
    assert len(rows) == 2 and len(encoded(rows).encode()) <= 1800
    assert output['death_episode']['combat_observations_omitted'] == 0
    assert rows[1]['detail_path'] == ['evidence', 'death_episode', 'combat_observations', 1]
