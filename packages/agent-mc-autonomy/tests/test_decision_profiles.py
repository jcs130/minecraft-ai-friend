import asyncio
import dataclasses
import json

import httpx
import pytest
from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.decision_profiles import DecisionSettings
from agent_mc_autonomy.model_config import HttpPlannerConfig
from agent_mc_autonomy.planner import HttpPlanner


def test_profiles_are_opt_in_and_bound_to_the_existing_output_reserve():
    assert Settings.parse({}).decision_policy.select(failure=True) is None
    for raw in ({"enabled":1},{"enabled":True,"routine_output_tokens":2048},{"complex_output_tokens":2048},
                {"routine_parameters":{"temperature":float('nan')}},{"secret":"forbidden"}):
        with pytest.raises(ValueError):
            DecisionSettings.parse(raw,1024)
    settings=DecisionSettings.parse({"enabled":True},2048)
    assert settings.select(focus='work')['profile']=='routine'
    for signals,reason in [({'failure':True},'recover_failure'),({'feedback':True},'new_intent'),
                           ({'death':True},'death_review'),({'focus':'inspect'},'risk_or_missing_facts')]:
        hint=settings.select(**signals)
        assert hint['profile']=='complex' and hint['reason']==reason and hint['max_output_tokens']==2048


def test_concurrent_profile_requests_never_change_model_route_base_parameters_or_each_other():
    calls=[]
    async def exercise():
        async def respond(request):
            calls.append(json.loads(request.content))
            await asyncio.sleep(0)
            return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":"okay"}}]})
        config=HttpPlannerConfig.parse({'model':'test-model','base_url':'http://127.0.0.1:1',
            'auth':{'mode':'none'},'parameters':{'enable_thinking':False}})
        planner=HttpPlanner(config,1024,10,client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        policy=DecisionSettings.parse({'enabled':True,'routine_output_tokens':256,'complex_output_tokens':512,
            'routine_parameters':{'reasoning_effort':'low'},'complex_parameters':{'reasoning_effort':'high'}},1024)
        results=await asyncio.gather(planner.decide_profile([{'role':'user','content':'facts'}],[],policy.select(focus='work')),
                                     planner.decide_profile([{'role':'user','content':'failure'}],[],policy.select(failure=True)))
        assert [r['model_status']['decision_profile']['profile'] for r in results]==['routine','complex']
        assert all(r['model_status']['decision_profile']['parameters_applied'] for r in results)
        assert planner.config==config and planner.max_output_tokens==1024 and config.parameters=={'enable_thinking':False}
        for params in ({'model':'another'},{'base_url':'https://forbidden.example'}):
            with pytest.raises(ValueError):
                await planner.decide_profile([],[],{**policy.select(focus='work'),'parameters':params})
        assert len(calls)==2
        await planner.aclose()
    asyncio.run(exercise())
    assert [c['model'] for c in calls]==['test-model','test-model']
    assert [c['max_tokens'] for c in calls]==[256,512]
    assert [c['reasoning_effort'] for c in calls]==['low','high']
    assert all(c['enable_thinking'] is False for c in calls)


def test_controller_passes_material_reason_to_one_profile_call_and_keeps_legacy_port_fallback(framework_module,tmp_path,run_async):
    from test_controller import choose, setup
    called=[]
    async def original(*_):
        raise AssertionError('no second or unprofiled planner call')
    async def profiled(messages,tools,profile):
        called.append(profile)
        return choose()
    module,bridge,controller=setup(framework_module,tmp_path,original)
    controller.settings=dataclasses.replace(controller.settings,decision_policy=DecisionSettings.parse({'enabled':True,'routine_output_tokens':256,'complex_output_tokens':512},1024))
    controller.profile_decide=profiled
    run_async(controller.turn_once('survive','prefix',module.model_tools(bridge.tools)))
    assert len(called)==1 and called[0]['profile']=='complex' and called[0]['reason']=='risk_or_missing_facts'
    assert len([c for c in bridge.calls if c[0]=='mc_do'])==1
    async def legacy(*_):return {'content':'continue','tool_calls':[]}
    controller.profile_decide=None
    controller.decide=legacy
    result=run_async(controller.decide_with_events([],[],called[0]))
    assert result['model_status']['decision_profile']['fallback']=='planner_profile_port_unavailable'
    assert result['model_status']['decision_profile']['output_budget_applied'] is False


def test_unsupported_provider_hints_fall_back_once_without_repeated_rejected_requests():
    calls=[]
    async def exercise():
        def respond(request):
            body=json.loads(request.content)
            calls.append(body)
            if 'reasoning_effort' in body:
                return httpx.Response(400,json={'error':'unsupported profile'})
            return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'continue'}}]})
        config=HttpPlannerConfig.parse({'model':'test-model','base_url':'http://127.0.0.1:1','auth':{'mode':'none'},'parameters':{'enable_thinking':False}})
        planner=HttpPlanner(config,1024,10,client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        hint=DecisionSettings.parse({'enabled':True,'routine_parameters':{'reasoning_effort':'low'}},1024).select(focus='work')
        for _ in range(2):
            result=await planner.decide_profile([{'role':'user','content':'facts'}],[],hint)
            assert result['model_status']['decision_profile']['fallback']=='provider_rejected_profile'
            assert result['model_status']['decision_profile']['parameters_applied'] is False
        assert planner.config==config
        await planner.aclose()
    asyncio.run(exercise())
    assert len(calls)==3 and sum('reasoning_effort' in c for c in calls)==1
    assert all(c['model']=='test-model' and c['enable_thinking'] is False for c in calls)


@pytest.mark.parametrize('status', [400, 422])
def test_anthropic_profile_rejection_restores_valid_base_budget_and_caches_success(status):
    calls = []
    async def exercise():
        def respond(request):
            body = json.loads(request.content)
            calls.append(body)
            if body['thinking']['type'] == 'disabled':
                return httpx.Response(status, json={'error': 'unsupported profile'})
            return httpx.Response(200, json={'stop_reason': 'end_turn',
                'content': [{'type': 'text', 'text': 'continue'}]})
        config = HttpPlannerConfig.parse({'provider': 'anthropic', 'model': 'test-model',
            'base_url': 'http://127.0.0.1:1', 'auth': {'mode': 'none'},
            'parameters': {'thinking': {'type': 'enabled', 'budget_tokens': 1536}}})
        planner = HttpPlanner(config, 2048, 10,
            client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        policy = DecisionSettings.parse({'enabled': True,
            'routine_parameters': {'thinking': {'type': 'disabled'}}}, 2048)
        planner.validate_profiles(policy)
        hint = policy.select(focus='work')
        for _ in range(2):
            result = await planner.decide_profile([{'role': 'user', 'content': 'facts'}], [], hint)
            view = result['model_status']['decision_profile']
            assert view['fallback'] == 'provider_rejected_profile'
            assert view['parameters_applied'] is False
            assert view['requested_max_output_tokens'] == 768
            assert view['max_output_tokens'] == 2048
            assert view['output_budget_applied'] is False
        assert planner.config is config and planner.max_output_tokens == 2048
        assert config.parameters == {'thinking': {'type': 'enabled', 'budget_tokens': 1536}}
        assert len(planner.profile_rejections) == 1
        await planner.aclose()
    asyncio.run(exercise())
    assert [body['max_tokens'] for body in calls] == [768, 2048, 2048]
    assert [body['thinking']['type'] for body in calls] == ['disabled', 'enabled', 'enabled']
    assert all(body['model'] == 'test-model' for body in calls)


def test_invalid_anthropic_base_budget_is_rejected_before_any_request():
    calls = []
    async def exercise():
        config = HttpPlannerConfig.parse({'provider': 'anthropic', 'model': 'test-model',
            'base_url': 'http://127.0.0.1:1', 'auth': {'mode': 'none'},
            'parameters': {'thinking': {'type': 'enabled', 'budget_tokens': 2048}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: calls.append(request))) as client:
            with pytest.raises(ValueError, match='brain_thinking_budget_must_be_less_than_output'):
                HttpPlanner(config, 2048, 10, client=client)
    asyncio.run(exercise())
    assert calls == []


@pytest.mark.parametrize('status', [400, 422])
def test_rejected_base_fallback_does_not_loop_or_cache_profile(status):
    calls = []
    async def exercise():
        def respond(request):
            calls.append(json.loads(request.content))
            return httpx.Response(status, json={'error': 'invalid base too'})
        config = HttpPlannerConfig.parse({'model': 'test-model', 'base_url': 'http://127.0.0.1:1',
            'auth': {'mode': 'none'}})
        planner = HttpPlanner(config, 1024, 10,
            client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        hint = DecisionSettings.parse({'enabled': True,
            'routine_parameters': {'reasoning_effort': 'low'}}, 1024).select(focus='work')
        with pytest.raises(RuntimeError, match=f'^brain_http_error_{status}$'):
            await planner.decide_profile([{'role': 'user', 'content': 'facts'}], [], hint)
        assert not planner.profile_rejections
        await planner.aclose()
    asyncio.run(exercise())
    assert len(calls) == 2
    assert 'reasoning_effort' in calls[0] and 'reasoning_effort' not in calls[1]
