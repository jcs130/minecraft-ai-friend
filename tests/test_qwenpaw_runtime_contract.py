"""Validate the installed upstream source and fail closed on version drift."""
import importlib.metadata
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import qwenpaw_runtime_contract as contract


class RuntimeContractTests(unittest.TestCase):
    def test_installed_reviewed_sources_and_native_callables_match(self):
        from agentscope.agent import Agent
        from qwenpaw.agents.react_agent import QwenPawAgent
        self.assertEqual(contract.verify_sources(*contract.SOURCES),
                         importlib.metadata.version('qwenpaw'))
        contract.verify_callable('next_action', Agent._next_action)
        contract.verify_callable('reasoning_impl', Agent._reasoning_impl)
        contract.verify_callable('prepare_model_input', QwenPawAgent._prepare_model_input)

    def test_mixed_reme_or_agentscope_and_unreviewed_release_are_rejected(self):
        for version, changes in [('2.2.0', {'reme-ai': '0.4.1.11'}),
                                 ('2.2.1', {'reme-ai': '0.4.1.10'}),
                                 ('2.2.1', {'agentscope': '2.0.8'}),
                                 ('2.2.2', {})]:
            values = {'qwenpaw': version, **contract.RELEASES.get(version, {}), **changes}
            with self.subTest(values=values), patch.object(contract.importlib.metadata, 'version',
                                                         side_effect=values.__getitem__):
                with self.assertRaises(ValueError):
                    contract.release()

    def test_changed_source_and_callables_cannot_be_certified(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'changed.py'
            source.write_text('changed native source\n', encoding='utf8')
            distribution = SimpleNamespace(locate_file=lambda _: source)
            with patch.object(contract, 'release', return_value='2.2.1'), \
                    patch.object(contract.importlib.metadata, 'distribution', return_value=distribution):
                with self.assertRaisesRegex(ValueError, 'source:agent'):
                    contract.verify_sources('agent')
        with patch.object(contract.inspect, 'getsource', return_value='changed native method'):
            with self.assertRaisesRegex(ValueError, 'callable:next_action'):
                contract.verify_callable('next_action', object())


if __name__ == '__main__':
    unittest.main()
