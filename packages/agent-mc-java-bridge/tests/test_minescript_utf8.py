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


if __name__ == '__main__':
    unittest.main()
