from test_review import runtime as review_runtime

import pytest


@pytest.fixture
def runtime(tmp_path):
    return review_runtime.__wrapped__(tmp_path)


def test_main_brain_review_keeps_server_denial_and_original_after_a_scout(runtime):
    port, _, publish = runtime
    value = publish()
    value['facts']['parts'].extend([
        {'key': 'serverFeedback', 'text': '服务端原话: MC_LAND_ACCESS {"allowed":false,"reason":"land_permission_denied","x":-486}',
         'original': 'log:server-feedback'},
        {'key': 'lastTask', 'text': '观察完成，不代表上一步放置成功。'},
    ])
    from agent_mc_autonomy.review import review_observation, summary
    evidence = review_observation(value, port.now())['evidence']
    assert 'land_permission_denied' in evidence['facts'].get('serverFeedback', '')
    assert evidence['fact_originals']['serverFeedback'] == 'log:server-feedback'
    assert 'land_permission_denied' in summary(evidence)


def test_server_feedback_survives_large_scout_results_at_the_dynamic_request_tail():
    import json
    from agent_mc_autonomy.context import assemble
    feedback = {'key': 'serverFeedback', 'text': 'server denied place (-486,67,-506): land_permission_denied',
                'original': 'log:server-feedback'}
    facts = {'parts': [{'key': 'body', 'text': 'health=20 food=20'}, feedback,
                      {'key': 'lastTask', 'text': 'observed voxels ' * 4000, 'original': 'log:scout'}]
                     + [{'key': f'other-{i}', 'text': 'not action feedback ' * 60} for i in range(12)]}
    messages, budget = assemble('stable rules', [], 'survive', facts, [], [], context_tokens=16000, reserved_output=2048)
    assert 'land_permission_denied' not in messages[0]['content']
    tail = json.loads(messages[-1]['content'])
    assert feedback in tail['current_facts']
    assert budget['total'] <= 16000
