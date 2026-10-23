"""Exact selected host values can be reused without hiding changed provenance."""
import copy
import json

import pytest

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.scene_history import capture_scene, make_scene, project_messages


def scene(sequence, *, actor='Role', receipt='played'):
    return make_scene({'current_goal': 'a currently selected goal ' * 60,
        'current_facts': [{'key': 'health', 'text': '20/20'}, {'key': 'options', 'text': 'unchanged options ' * 20}],
        'events': [{'run': 'r', 'cursor': sequence, 'senderKey': actor, 'text': 'literal player message'}],
        'host_context': {'current_intent': 'new current intent ' + str(sequence),
            'memories': [{'id': 'm1', 'source': 'selected', 'text': 'selected memory ' * 60}]},
        'host_recent_context': {'sampled_at': sequence, 'expires_at': sequence + 30,
            'binding': {'actor': actor, 'session': 'session', 'intent_revision': sequence},
            'recent_messages': [{'id': 'chat-1', 'actor': actor, 'role': 'user',
                                 'source': 'host_selected', 'text': 'retained attributed text ' * 40}],
            'recent_speech': [{'speech_id': 'speech-1', 'actor': actor, 'source': 'receipt',
                               'receipt_state': receipt, 'playback_verified': True,
                               'text': 'selected real receipt ' * 40}]}})


def message(value):
    return {'role': 'user', 'content': json.dumps(value, ensure_ascii=False, separators=(',', ':'))}


def test_unchanged_selected_rows_reuse_old_literals_inside_a_fresh_envelope():
    old, current = scene(1), scene(2)
    raw = [message(old), {'role': 'assistant', 'content': 'past reply'}, message(current)]
    projected, stats = project_messages(raw)
    value = json.loads(projected[-1]['content'])
    assert value['current_goal']['context_ref'] == old['context_id']
    assert value['host_context']['current_intent'] == current['host_context']['current_intent']
    assert value['host_context']['memories'][0]['context_ref'] == old['context_id']
    recent = value['host_recent_context']
    assert recent['sampled_at'] == 2 and recent['expires_at'] == 32 and recent['binding']['intent_revision'] == 2
    assert recent['recent_messages'][0]['context_ref'] == old['context_id']
    assert recent['recent_speech'][0]['context_ref'] == old['context_id']
    assert value['events'] == current['events'] and value['current_facts'][0] == current['current_facts'][0]
    assert json.loads(capture_scene(projected)['content']) == current
    assert stats['saved_utf8_bytes'] > 3000 and raw[-1] == message(current)


def test_changed_actor_receipt_goal_or_text_is_not_reused():
    old, current = scene(1), scene(2, actor='DifferentRole', receipt='not_played')
    current['current_goal'] = 'a different goal ' * 60
    current['host_context']['memories'][0]['text'] = 'different selected memory ' * 60
    current = make_scene(current)
    projected, _ = project_messages([message(old), message(current)])
    value = json.loads(projected[-1]['content'])
    assert value['current_goal'] == current['current_goal']
    assert value['host_context']['memories'] == current['host_context']['memories']
    for key in ('recent_messages', 'recent_speech'):
        assert value['host_recent_context'][key] == current['host_recent_context'][key]
    assert json.loads(capture_scene(projected)['content']) == current


def test_retired_sources_materialize_and_whole_section_refs_never_become_nested_sources():
    first = scene(1)
    same = copy.deepcopy(first)
    same['events'] = []
    same = make_scene(same)
    current = scene(3)
    projected, _ = project_messages([message(first), message(same), message(current)])
    mid = json.loads(projected[1]['content'])
    assert mid['host_context']['context_ref'] == first['context_id']
    assert json.loads(projected[-1]['content'])['host_context']['memories'][0]['context_ref'] == first['context_id']
    rebased, _ = project_messages([message(same), message(current)])
    assert json.loads(rebased[0]['content'])['host_context']['memories'] == same['host_context']['memories']
    assert json.loads(rebased[-1]['content'])['host_context']['memories'][0]['context_ref'] == same['context_id']
    assert json.loads(capture_scene(rebased)['content']) == current


def test_reference_requires_real_byte_savings_and_critical_body_stays_literal():
    first = make_scene({'current_facts': [{'key': 'options', 'text': 'x' * 300},
                                         {'key': 'small', 'text': 'x' * 100},
                                         {'key': 'body', 'text': 'fresh authoritative ' * 40}]})
    projected, _ = project_messages([message(first), message(first)])
    facts = json.loads(projected[-1]['content'])['current_facts']
    assert facts[0]['context_ref'] == first['context_id']
    assert facts[1:] == first['current_facts'][1:]
    assert json.loads(capture_scene(projected)['content']) == first


def test_container_with_reused_children_is_not_later_advertised_as_literal():
    first, second, third = scene(1), scene(2), scene(3)
    third['host_context'] = copy.deepcopy(second['host_context'])
    third = make_scene(third)
    projected, _ = project_messages([message(first), message(second), message(third)])
    parent = json.loads(projected[-1]['content'])['host_context']
    assert 'context_ref' not in parent
    assert parent['memories'][0]['context_ref'] == first['context_id']
    assert json.loads(capture_scene(projected)['content']) == third


@pytest.mark.parametrize(('field', 'changed'), [('speech_id', 'different-speech'), ('actor', 'different-actor'),
    ('source', 'different-source'), ('receipt_state', 'offered'), ('playback_verified', False), ('text', 'different text ' * 40)])
def test_each_changed_speech_identity_or_playback_field_remains_literal(field, changed):
    first, current = scene(1), scene(2)
    current['host_recent_context']['recent_speech'][0][field] = changed
    current = make_scene(current)
    projected, _ = project_messages([message(first), message(current)])
    recent = json.loads(projected[-1]['content'])['host_recent_context']
    assert recent['recent_speech'] == current['host_recent_context']['recent_speech']
    assert json.loads(capture_scene(projected)['content']) == current


def test_real_window_cleanup_rebases_selected_memory_and_preserves_current_goal():
    groups = [[message(scene(i)), {'role': 'assistant', 'content': 'past plan ' * 500}] for i in range(6)]
    current = scene(7)
    messages, budget = assemble('body contract', [], current['current_goal'], {'parts': current['current_facts']},
        current['events'], groups, context_mode='full', context_tokens=22000, reserved_output=1024,
        context_history_headroom_tokens=2000,
        host_context={'stable': {'agent_name': 'Role'}, 'dynamic': current['host_context']})
    assert budget['history']['evicted'] > 0 and budget['history']['included'] > 0
    assert budget['total'] <= 22000
    restored = json.loads(capture_scene(messages)['content'])
    assert restored['host_context'] == current['host_context']
    assert restored['current_goal'] == current['current_goal'] and restored['events'] == current['events']
