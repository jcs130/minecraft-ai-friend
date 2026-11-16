import json
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock


BASE = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(BASE), str(BASE.parent / 'harness')]

from dsh_gateway import bindings, DshPlanner
from gateway import Refused
from qwen_code import QwenCodePlanner, project_turn, read_result


def stream(text, *, turns=1, usage=True):
    frames = [
        {'type': 'assistant', 'message': {'usage': {'input_tokens': 602, 'output_tokens': 53} if usage else {}}},
        {'type': 'result', 'subtype': 'success', 'is_error': False, 'num_turns': turns, 'result': text,
         'usage': {'input_tokens': 0, 'output_tokens': 0}},
    ]
    return '\n'.join(json.dumps(event) for event in frames).encode()


class QwenCodeProtocolTest(unittest.TestCase):
    def test_native_structured_dialogue_is_preserved_inside_content(self):
        content = json.dumps({'reply':'一起去找种子吧。','action':'join','targetNpc':None}, ensure_ascii=False)
        value = read_result(stream(json.dumps({'content':content,'tool_calls':[]})))
        self.assertEqual(value['content'], content)
        self.assertEqual(value['tool_calls'], [])
        with self.assertRaisesRegex(ValueError, 'harness_plan_shape_invalid'):
            read_result(stream(content))  # An invalid envelope is never guessed into a game action.

    def test_tool_free_mode_transports_literal_native_content_without_guessing(self):
        content = '{"reply":"一起去找种子吧。","action":"join","targetNpc":null}'
        value = read_result(stream(content), native_content=True)
        self.assertEqual(value['content'], content)
        self.assertEqual(value['tool_calls'], [])
        # The Java dialogue validator decides what native content means. No arbitrary tool can run here.
        self.assertEqual(read_result(stream('{"tool_calls":[{}]}'),native_content=True)['tool_calls'],[])
        frame={'type':'message','role':'assistant','content':[{'type':'output_text','text':content}]}
        self.assertEqual(DshPlanner.decode({'output':[frame]},native_content=True)['content'],content)
        with self.assertRaisesRegex(ValueError,'one_native_dialogue_reply_required'):
            DshPlanner.decode({'output':[frame,frame]},native_content=True)

    def test_preview_zero_result_counters_use_the_assistant_usage(self):
        value = read_result(stream('{"content":"好。","tool_calls":[]}'))
        self.assertEqual(value['model_status']['usage'],
                         {'prompt_tokens': 602, 'completion_tokens': 53, 'total_tokens': 655})

    def test_unreported_usage_remains_unknown(self):
        value = read_result(stream('{"content":"好。"}', usage=False))
        self.assertEqual(value['model_status']['usage'], {})

    def test_multiple_rounds_and_prose_do_not_produce_a_plan(self):
        with self.assertRaises(ValueError):
            read_result(stream('{"content":"好。"}', turns=2))
        with self.assertRaises(ValueError):
            read_result(stream('I will do it. {"content":"好。"}'))

    def test_window_keeps_active_intent_and_receipt_when_an_old_turn_does_not_fit(self):
        system = {'role': 'system', 'content': 'role facts'}
        receipt = {'role': 'tool', 'content': 'native task set', 'tool_call_id': 't1'}
        current = {'role': 'user', 'content': 'work'}
        old = {'role': 'user', 'content': 'past ' * 200}
        output = project_turn([system, old, current, receipt], [], 230)
        self.assertEqual(json.loads(output)['messages'], [system, current, receipt])
        with self.assertRaisesRegex(Refused, 'MAID_QWEN_CONTEXT_LIMIT'):
            project_turn([system, current, receipt], [], 50)

    def test_qwen_only_npcs_do_not_require_a_hub(self):
        config = json.loads((BASE / 'examples/qwen-code.example.json').read_bytes())
        common, rows, maximum = bindings(config)
        self.assertNotIn('hub', common)
        self.assertEqual((len(rows), maximum), (3, 3))
        self.assertEqual({row['choices']['qwen']['harness_id'] for row in rows}, {'qwen-code'})


class QwenCodePlannerTest(unittest.IsolatedAsyncioTestCase):
    async def test_scope_applies_to_the_advertised_tools_and_the_returned_plan(self):
        planner = object.__new__(QwenCodePlanner)
        planner.input_limit = 1024
        choice = {'cliModel': 'lab/flash', 'allowedTools': ['switch_work_task']}
        message = [{'role': 'user', 'content': 'Switch to farming.'}]
        tools = [{'type': 'function', 'function': {'name': name}}
                 for name in ['switch_work_task', 'equip_from_backpack']]

        def plan_for(tool):
            return stream(json.dumps({'content': None, 'tool_calls': [{'id': 't1', 'type': 'function',
                'function': {'name': tool, 'arguments': {'task': 'farm'}}}]}))

        planner.invoke = AsyncMock(side_effect=[plan_for('switch_work_task'), plan_for('equip_from_backpack')])
        valid = await planner(choice, message, tools)
        self.assertEqual(valid['tool_calls'][0]['function']['name'], 'switch_work_task')
        self.assertEqual(json.loads(planner.invoke.await_args.args[1])['tools'], tools[:1])
        with self.assertRaisesRegex(Refused, 'QWEN_CODE_PLAN_UNCONFIRMED_NO_GAME_ACTION'):
            await planner(choice, message, tools)
