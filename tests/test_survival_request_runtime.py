"""Current request identity survives actual native model-input preparation."""
import copy
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from survival_request_runtime import KEY, current_reference, wrap_prepare

SESSION = 'life-' + 'e' * 32
TURN = 'survival-' + 'a' * 32


class SurvivalRequestTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from qwenpaw.runtime.builder import AgentBuilder
        self.request = AgentBuilder._build_request_context(NS(session_id=SESSION, agent_id='qd-survivor',
            request=NS(channel='console', user_id='survival-controller', request_context={
                KEY: {'version': 1, 'turn_id': TURN, 'session_id': SESSION}})))
        self.agent = NS(_workspace_dir='/state/work/workspaces/qd-survivor',
            _agent_config=NS(id='qd-survivor'), _request_context=self.request)

    def test_wrong_role_session_or_origin_cannot_project_reference(self):
        self.assertEqual(current_reference(self.agent)['turn_id'], TURN)
        for field, value in [('agent_id', 'qd-engineer'), ('session_id', 'main'),
                             ('channel', 'cron'), ('user_id', 'human')]:
            with self.subTest(field=field):
                self.agent._request_context = self.request | {field: value}
                self.assertIsNone(current_reference(self.agent))

    def test_missing_malformed_and_stale_request_references_are_not_recovered(self):
        for value in (None, {}, {'version': 1, 'turn_id': TURN, 'session_id': 'life-' + 'f' * 32},
                      {'version': 1, 'turn_id': 't468', 'session_id': SESSION}):
            self.agent._request_context = self.request | {KEY: value}
            self.assertIsNone(current_reference(self.agent))

    async def test_native_compacted_input_keeps_reference_without_mutating_history(self):
        from qwenpaw.agents.react_agent import QwenPawAgent
        from qwenpaw.config.config import AgentProfileConfig
        from agentscope.message import AssistantMsg
        from agentscope.agent import ReActConfig
        from agentscope.tool import Toolkit
        agent = QwenPawAgent(name='Kirito', system_prompt='Fixture',
            model=NS(model='replay-only', context_size=32768), toolkit=Toolkit(),
            react_config=ReActConfig(max_iters=12),
            middlewares=[], workspace_dir='/state/work/workspaces/qd-survivor',
            agent_config=AgentProfileConfig(id='qd-survivor', name='Kirito'),
            request_context=self.request)
        # This is the observed production compaction shape: original user
        # request no longer in context; internal session is a random ID.
        agent.state.context = [AssistantMsg(name='Kirito', content='压缩后留下的工具总结。')]
        agent.state.summary = '旧工作摘要，无本轮精确编号。'
        before = copy.deepcopy(agent.state.model_dump())
        prepare = wrap_prepare(QwenPawAgent._prepare_model_input)
        first = await prepare(agent)
        second = await prepare(agent)
        self.assertEqual(agent.state.model_dump(), before)
        self.assertEqual(len(first['messages']), len(second['messages']))
        self.assertIn(TURN, first['messages'][-1].get_text_content())
        self.assertEqual(first['messages'][-1].role, 'user')
        self.assertEqual(first['messages'][-2].get_text_content(), '压缩后留下的工具总结。')
        # Next dispatch on the SAME session must use its new reference only.
        next_turn = 'survival-' + 'b' * 32
        agent._request_context = self.request | {KEY: {'version': 1, 'turn_id': next_turn, 'session_id': SESSION}}
        third = await prepare(agent)
        self.assertIn(next_turn, third['messages'][-1].get_text_content())
        self.assertNotIn(TURN, third['messages'][-1].get_text_content())
        self.assertEqual(agent.state.model_dump(), before)

    async def test_absent_reference_preserves_native_result_exactly(self):
        self.agent._request_context = {}
        result = {'messages': ['unchanged'], 'tools': ['unchanged']}
        async def original(agent):
            return result
        self.assertIs(await wrap_prepare(original)(self.agent), result)


if __name__ == '__main__':
    unittest.main()
