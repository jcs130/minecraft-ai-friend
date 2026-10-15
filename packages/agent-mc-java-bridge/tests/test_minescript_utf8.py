"""Execute the exact owned Java text-block wrapper with locale-encoded pipes.

No upstream Minescript code, game, model or server is used by this fixture.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/main/java/org/agentmc/bridge/MinescriptRunner.java'


class Utf8ProgramTest(unittest.TestCase):
    def run_wrapper(self, code, configure=True):
        with tempfile.TemporaryDirectory(prefix='agent-mc-utf8-') as directory:
            base = Path(directory)
            request, output = base / 'request.json', base / 'result.json'
            request.write_text(json.dumps({'code': code}, ensure_ascii=False), encoding='utf-8')
            source = re.search(r'String source = """\n(.*?)\n"""\.formatted', SOURCE.read_text(encoding='utf-8'), re.S).group(1)
            if not configure:
                source = source.replace("for _stream in (sys.stdin, sys.stdout, sys.stderr):\n    _stream.reconfigure(encoding='utf-8', errors='strict')\n", '')
            program = source % (json.dumps(str(request)), json.dumps(str(output)))
            (base / 'wrapper.py').write_text(program, encoding='utf-8')
            (base / 'minescript.py').write_text('''import json,sys
_selection_calls = []
class ScriptFunction:
    def __init__(self): self.args_func = lambda slot: (slot,)
    def __call__(self, *args, **kwargs):
        selected, = self.args_func(*args, **kwargs)
        _selection_calls.append(selected)
        return 4
    def as_async(self, *args, **kwargs): return self(*args, **kwargs)
    def as_task(self, *args, **kwargs):
        return self.args_func(*args, **kwargs)
player_inventory_select_slot = ScriptFunction()
def player_inventory():
    return json.loads(sys.stdin.readline())['retval']
def flush(): pass
def press_key_bind(key, pressed):
    assert key.startswith('key.') and pressed is False
''', encoding='utf-8')
            inventory = {'fcid': 1001, 'retval': [{'item': 'written_book', 'count': 1,
                'nbt': '{custom_name: "千灯纪 ❖ 命格签", lore: "中文 与 猫耳🐾"}'}]}
            payload = (json.dumps(inventory, ensure_ascii=False) + '\n').encode('utf-8')
            env = dict(os.environ, PYTHONIOENCODING='gbk:surrogateescape', PYTHONUTF8='0')
            run = subprocess.run([sys.executable, '-u', str(base / 'wrapper.py')], input=payload,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=3, cwd=base)
            self.assertEqual(run.returncode, 0, run.stderr.decode('utf-8', errors='replace'))
            self.assertTrue(output.is_file(), 'Program must return a bounded report')
            self.assertFalse(output.with_suffix('.tmp').exists())
            return json.loads(output.read_text(encoding='utf-8')), inventory

    def test_exact_unicode_and_escaped_component_payload_survive_windows_pipe_locale(self):
        report, inventory = self.run_wrapper('result = minescript.player_inventory()')
        self.assertEqual(report, {'ok': True, 'result': inventory['retval'], 'programReport': True})

    def test_unfixed_locale_reproduces_json_failure(self):
        report, _ = self.run_wrapper('result = minescript.player_inventory()', configure=False)
        self.assertFalse(report['ok'])
        self.assertIn('Expecting property name', report['error'])

    def test_program_error_remains_an_error_report_with_original_unicode(self):
        report, _ = self.run_wrapper('raise ValueError("背包❖读取失败")')
        self.assertEqual(report, {'ok': False, 'error': '背包❖读取失败', 'programReport': True})

    def test_hotbar_guard_rejects_inventory_slots_before_any_dispatch(self):
        report, _ = self.run_wrapper('''
import minescript
errors = []
for invoke in (minescript.player_inventory_select_slot,
               minescript.player_inventory_select_slot.as_async,
               minescript.player_inventory_select_slot.as_task):
    for slot in (-1, 9, 29, 35, True, 1.5, "8", None):
        try: invoke(slot)
        except ValueError as error: errors.append(str(error))
result = {"errors": errors, "dispatched": minescript._selection_calls}
''')
        self.assertTrue(report['ok'])
        self.assertEqual(report['result']['dispatched'], [])
        self.assertEqual(len(report['result']['errors']), 24)
        self.assertTrue(all('0..8' in error and 'slot_to_hotbar' in error for error in report['result']['errors']))

    def test_valid_hotbar_calls_keep_returns_keywords_async_and_task_arguments(self):
        report, _ = self.run_wrapper('''
from minescript import player_inventory_select_slot as select
result = {"previous": select(0), "async": select.as_async(slot=8),
          "task": select.as_task(slot=3), "dispatched": minescript._selection_calls}
''')
        self.assertTrue(report['ok'])
        self.assertEqual(report['result'], {'previous': 4, 'async': 4, 'task': [3], 'dispatched': [0, 8]})

    def test_bad_slot_returns_actionable_failed_program_report(self):
        report, _ = self.run_wrapper('minescript.player_inventory_select_slot(29)')
        self.assertFalse(report['ok'])
        self.assertTrue(report['programReport'])
        self.assertIn('hotbar slot integer 0..8', report['error'])


if __name__ == '__main__':
    unittest.main()
