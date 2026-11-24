"""Synthetic native observations and model responses; no game or real player is impersonated."""
import asyncio
import json
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from simbody import SimBody

from agent_mc_harness.guide_roles import parse_guide_roster
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import ActionSupport, BodySnapshot, Capabilities, LifecycleCaps, NativeAction
from agent_mc_harness.npc import IDLE_GOAL, ModelClient, NpcHost, NpcPlanner, companion_check_in, recent_companion_result
from agent_mc_harness.runtime import Intent, PlanContext


def guide_context():
    owner, maid = uuid4(), uuid4()
    row = {'ownerId': str(owner), 'maidId': str(maid), 'name': '测试伙伴', 'confirmed': True}
    role = next(iter(parse_guide_roster({'protocol': 'qiandengji-maid-body/v1', 'guides': [row]},
                                     'synthetic-server', {'model': 'fixture'}).values()))
    raw = {'nativeGuardDelegated': True, 'canMove': True, 'passenger': False, 'sitting': False,
           'homeMode': False, 'taskId': 'touhou_little_maid:idle', 'ownerDistance': 3,
           'companion': {'enabled': False, 'state': 'disabled'},
           'follow': {'active': True, 'temporaryWait': False},
           'guideCompanion': {'source': 'native_player_guide', 'ownerId': str(owner), 'maidId': str(maid),
                              'ready': True, 'following': True, 'guardDelegated': True, 'state': 'following_ready'}}
    caps = Capabilities(kind='maid', transport='fixture', actions={'chat': ActionSupport(native='speak')},
                        perception='poll', lifecycle=LifecycleCaps(spawn='attach', reconnect=True, destroy='detach'),
                        native_actions=[NativeAction(name='guard')])
    context = PlanContext(capabilities=caps, snapshot=BodySnapshot(life_state='alive', position={'x': 0, 'y': 70, 'z': 0},
                                                                 dimension='minecraft:overworld', raw=raw))
    return role, context


def test_bound_guide_can_check_in_without_pretending_original_brain_is_enabled():
    role, context = guide_context()
    assert 'conversation' not in context.snapshot.raw
    assert companion_check_in(role, context) == ('minecraft:overworld', (0, 70, 0))
    assert context.snapshot.raw['companion'] == {'enabled': False, 'state': 'disabled'}


@pytest.mark.parametrize(('field', 'value'), [('ownerId', str(uuid4())), ('maidId', str(uuid4())),
                                             ('source', 'world_text'), ('ready', False), ('following', False),
                                             ('guardDelegated', False)])
def test_guide_identity_and_native_state_remain_required(field, value):
    role, context = guide_context()
    context.snapshot.raw['guideCompanion'][field] = value
    assert companion_check_in(role, context) is None


@pytest.mark.parametrize('field', ['passenger', 'sitting', 'homeMode'])
def test_guide_check_in_does_not_override_posture(field):
    role, context = guide_context()
    context.snapshot.raw[field] = True
    assert companion_check_in(role, context) is None


def test_old_or_distant_guide_observation_does_not_grant_speech():
    role, context = guide_context()
    context.snapshot.sampled_at -= timedelta(seconds=6)
    assert companion_check_in(role, context) is None
    role, context = guide_context()
    context.snapshot.raw['ownerDistance'] = 8.1
    assert companion_check_in(role, context) is None


def model(answer):
    def respond(request):
        payload = json.loads(request.content)
        facts = json.loads(payload['messages'][1]['content'])
        result = answer(payload, facts)
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result, ensure_ascii=False)}}]})
    return ModelClient('http://127.0.0.1:4000/v1', 'synthetic-only',
                       http=httpx.AsyncClient(transport=httpx.MockTransport(respond)))


def caption(intent, context, *, request='synthetic-caption', status='completed', recipients=1, terminal=True):
    intent.action_receipts[request] = {'verb': 'chat', 'status': status, 'terminal': terminal}
    intent.state = 'completed' if terminal else 'paused'
    context.communication_receipts = [{'requestId': request, 'status': status, 'captionRecipients': recipients}]


def test_empty_inference_does_not_consume_opportunity_and_exact_caption_commits_it():
    async def run():
        role, context = guide_context()
        answers = iter([{'steps': []}, {'steps': [{'tool': 'body:chat', 'args': {'text': '这边的路牌可以先看看。'}}]}])
        client = model(lambda payload, facts: next(answers))
        planner = NpcPlanner(role, client)
        planner.next_companion_check_in = 0
        try:
            first = Intent(id='empty', agent=role.id, goal=IDLE_GOAL)
            assert await planner(first, context) == []
            assert planner.companion_anchor is None and planner.pending_companion_check_in is None
            assert planner.next_companion_check_in == 0
            planner.next_companion_attempt = 0
            second = Intent(id='candidate', agent=role.id, goal=IDLE_GOAL)
            assert (await planner(second, context))[0].tool == 'body:chat'
            assert planner.companion_anchor is None  # A plan is not delivery.
            caption(second, context, status='unknown', recipients=0, terminal=False)
            planner._settle_companion_check_in(context, 100)
            assert planner.companion_anchor is None and planner.pending_companion_check_in is not None
            caption(second, context)
            context.communication_receipts[0]['requestId'] = 'unrelated'
            planner._settle_companion_check_in(context, 100)
            assert planner.companion_anchor is None
            caption(second, context)
            planner._settle_companion_check_in(context, 100)
            assert planner.companion_anchor == ('minecraft:overworld', (0, 70, 0))
            assert planner.next_companion_check_in == 280
            assert planner.pending_companion_check_in is None
        finally:
            await client.close()
    asyncio.run(run())


@pytest.mark.parametrize(('status', 'recipients'), [('failed', 0), ('completed', 0)])
def test_failed_or_zero_recipient_caption_is_not_committed_or_replayed(status, recipients):
    async def run():
        role, context = guide_context()
        text = '路口有个路牌，我们可以先看看。'
        client = model(lambda payload, facts: {'steps': [{'tool': 'body:chat', 'args': {'text': text}}]})
        planner = NpcPlanner(role, client)
        planner.next_companion_check_in = 0
        try:
            intent = Intent(id='original-plan', agent=role.id, goal=IDLE_GOAL)
            assert await planner(intent, context)
            caption(intent, context, status=status, recipients=recipients)
            planner._settle_companion_check_in(context, 100)
            assert planner.companion_anchor is None
            planner.next_companion_attempt = 0
            assert await planner(Intent(id='fresh-review', agent=role.id, goal=IDLE_GOAL), context) == []
            assert len(intent.action_receipts) == 1  # No second body write or forged success.
        finally:
            await client.close()
    asyncio.run(run())


def test_model_failure_keeps_unconsumed_opportunity_with_bounded_retry():
    async def run():
        role, context = guide_context()
        def fail(request):
            raise httpx.ReadTimeout('synthetic inference timeout', request=request)
        client = ModelClient('http://127.0.0.1:4000/v1', 'synthetic-only',
                             http=httpx.AsyncClient(transport=httpx.MockTransport(fail)))
        planner = NpcPlanner(role, client)
        planner.next_companion_check_in = 0
        try:
            with pytest.raises(httpx.ReadTimeout):
                await planner(Intent(id='timeout', agent=role.id, goal=IDLE_GOAL), context)
            assert planner.companion_anchor is None and planner.pending_companion_check_in is None
            assert planner.next_companion_check_in == 0 and planner.next_companion_attempt > 0
        finally:
            await client.close()
    asyncio.run(run())


def visible_listener(context):
    context.snapshot.raw.pop('guideCompanion')
    context.snapshot.raw['nearbyPlayers'] = [{'name': 'SyntheticVisitor', 'uuid': str(uuid4()),
                                             'dimension': 'minecraft:overworld', 'position': {'x': 2, 'y': 70, 'z': 0}}]
    # These are native eligibility observations, not a fabricated real-player chat event.


def test_ordinary_provider_can_offer_fresh_nearby_caption_without_voice_listener():
    async def run():
        role, context = guide_context()
        visible_listener(context)
        context.snapshot.raw['speech'] = {'state': 'skipped', 'reason': 'no_connected_voice_listener'}
        client = model(lambda payload, facts: {'steps': [{'tool': 'body:chat', 'args': {'text': '这边的路口挺开阔。'}}]})
        try:
            planner = NpcPlanner(role, client)
            assert planner.resident_turns is None
            assert (await planner(Intent(id='nearby', agent=role.id, goal=IDLE_GOAL), context))[0].tool == 'body:chat'
            assert context.recheck_nearby_speech is True
            assert context.recent_companion_speech == []  # An attempt is not a claimed delivery.
            assert await planner(Intent(id='same-optional-caption-not-replayed', agent=role.id, goal=IDLE_GOAL), context) == []
            context.recent_companion_speech = ['这边的路口挺开阔！']
            assert await planner(Intent(id='duplicate', agent=role.id, goal=IDLE_GOAL), context) == []
            context.recent_companion_speech = []
            context.snapshot.raw['nearbyPlayers'] = []
            assert await planner(Intent(id='no-eligible-listener', agent=role.id, goal=IDLE_GOAL), context) == []
        finally:
            await client.close()
    asyncio.run(run())


@pytest.mark.parametrize('field', ['sitting', 'passenger', 'homeMode'])
def test_new_ordinary_provider_greeting_preserves_manual_posture(field):
    async def run():
        role, context = guide_context()
        visible_listener(context)
        context.snapshot.raw[field] = True
        client = model(lambda payload, facts: {'steps': [{'tool': 'body:chat', 'args': {'text': '先看看路口。'}}]})
        try:
            assert await NpcPlanner(role, client)(Intent(id='paused', agent=role.id, goal=IDLE_GOAL), context) == []
        finally:
            await client.close()
    asyncio.run(run())


@pytest.mark.parametrize(('field', 'value'), [('sitting', True), ('passenger', True), ('homeMode', True),
                                             ('canMove', False), ('taskId', 'touhou_little_maid:fishing'),
                                             ('nativeGuardDelegated', False), (None, None)])
def test_ordinary_provider_rechecks_native_posture_after_inference(field, value, tmp_path):
    async def run():
        role, context = guide_context()
        visible_listener(context)
        raw = dict(context.snapshot.raw)

        class Maid(SimBody):
            async def snapshot(self):
                snapshot = await super().snapshot()
                snapshot.position = dict(context.snapshot.position)
                snapshot.raw = dict(raw)
                return snapshot

        body = Maid(body_id=str(role.body_id))
        await body.spawn()
        calls = []
        def answer(payload, facts):
            calls.append(facts)
            if field is not None:
                raw[field] = value  # Synthetic state changes while the model is deciding.
            return {'steps': [{'tool': 'body:chat', 'args': {'text': '这边的路口很开阔。'}}]}
        client = model(answer)
        journal = ActionJournal(tmp_path / 'synthetic-posture.sqlite3')
        host = NpcHost(role, body, NpcPlanner(role, client), None, journal)
        try:
            intent = Intent(id='fresh-nearby-caption', agent=role.id, goal=IDLE_GOAL, state='active')
            steps = await host._plan(intent, context)
            assert len(calls) == 1  # The ordinary provider's decision really ran.
            assert [step.tool for step in steps] == (['body:chat'] if field is None else [])
            assert body.acts == []  # A discarded caption is never sent and never replayed.
        finally:
            await host.close()
            await client.close()
    asyncio.run(run())


@pytest.mark.parametrize(('status', 'terminal', 'stamp'), [('unknown', False, True), ('accepted', False, True),
                                                         ('completed', False, True), ('completed', True, False)])
def test_unconfirmed_or_untimestamped_action_does_not_become_a_result_notice(status, terminal, stamp):
    _, context = guide_context()
    row = {'action': 'craft', 'requestId': 'original-work', 'status': status, 'terminal': terminal}
    if stamp:
        row['observedAt'] = context.snapshot.sampled_at.isoformat()
    context.body_results = [row]
    assert recent_companion_result(context, []) is None


def test_action_result_is_a_safe_speech_turn_and_is_not_consumed_before_delivery():
    async def run():
        role, context = guide_context()
        row = {'action': 'craft', 'requestId': 'original-work', 'status': 'completed', 'terminal': True,
               'observedAt': context.snapshot.sampled_at.isoformat(),
               'native': {'goalCompleted': True, 'observation': {'effectsApplied': True}}}
        context.body_results = [row]
        context.agenda = {'current': {'goal': '继续陪伴'}, 'upcoming': []}
        requests = []
        def answer(payload, facts):
            requests.append(facts)
            if facts.get('companionOpportunity') == 'action_result':
                assert facts['companionActionResult'] == row
                assert 'Do not retry it' in facts['goal']
            return {'steps': [{'tool': 'body:chat', 'args': {'text': '刚才的火把已经做好了。'}}]}
        client = model(answer)
        planner = NpcPlanner(role, client)
        planner.next_companion_check_in = 0
        try:
            original = Intent(id='result-note', agent=role.id, goal=IDLE_GOAL)
            assert (await planner(original, context))[0].tool == 'body:chat'
            assert requests[0]['companionOpportunity'] == 'action_result'
            assert planner.reported_companion_results == []
            caption(original, context)
            planner._settle_companion_check_in(context, 100)
            assert planner.reported_companion_results == [('original-work', 'completed')]
            assert recent_companion_result(context, planner.reported_companion_results) is None
            assert context.agenda['current']['goal'] == '继续陪伴'
            assert original.action_receipts.keys() == {'synthetic-caption'}  # Only one new speech, not the old craft.
        finally:
            await client.close()
    asyncio.run(run())


def test_old_receipts_and_mode_settings_do_not_trigger_completion_broadcasts():
    _, context = guide_context()
    past = context.snapshot.sampled_at - timedelta(minutes=16)
    for action, stamp in [('cast', past), ('guard', context.snapshot.sampled_at), ('follow', context.snapshot.sampled_at)]:
        context.body_results = [{'action': action, 'requestId': 'old-or-mode', 'status': 'completed', 'terminal': True,
                                 'observedAt': stamp.isoformat()}]
        assert recent_companion_result(context, []) is None


def test_unreviewed_tasks_are_not_advertised_as_executable():
    async def run():
        role, context = guide_context()
        context.snapshot.raw['guideCompanion']['ready'] = False
        context.capabilities.native_actions += [NativeAction(name='task'), NativeAction(name='tasks', read_only=True)]
        def answer(payload, facts):
            policy = payload['messages'][0]['content'].split('Only these tools: ', 1)[1].split('. Never invent', 1)[0]
            tools = json.loads(policy)
            assert 'body:native:task' not in tools and 'body:native:tasks' in tools
            return {'steps': []}
        client = model(answer)
        try:
            assert role.native_tasks == []
            assert await NpcPlanner(role, client)(Intent(id='catalogue', agent=role.id, goal=IDLE_GOAL), context) == []
        finally:
            await client.close()
    asyncio.run(run())
