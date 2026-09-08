"""Host contract tests and zero-model tests against installed native ReMe.

The native tests run in a disposable Python process, not the serving Qwen
process. They do not start ReMe, access a role workspace or call any model.
"""
import asyncio
import importlib.util
import inspect
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world' / 'ops'))
import reme_status_compat as compat

NATIVE = importlib.util.find_spec('reme') is not None


class PatchContractTests(unittest.TestCase):
    def test_versions_and_source_must_match(self):
        for qwen, reme in [('2.3.0', compat.REME_VERSION),
                           (compat.QWEN_VERSION, '0.4.2')]:
            with self.assertRaisesRegex(ValueError, 'versions'):
                compat.patch_source('', qwen, reme)
        with self.assertRaisesRegex(ValueError, 'source'):
            compat.patch_source('unreviewed source', compat.QWEN_VERSION,
                                compat.REME_VERSION)

    def test_invalid_runtime_rejected_before_package_access(self):
        with self.assertRaisesRegex(ValueError, 'invalid_reme_status_runtime'):
            compat.install('host')


@unittest.skipUnless(NATIVE, 'native ReMe tests require the Qwen runtime')
class NativeStatusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from reme.components.base_component import BaseComponent, Dependency
        from reme.enumeration import ComponentEnum
        from reme.steps.common import status
        cls.native = status
        cls.original = staticmethod(status._component_size)
        cls.BaseComponent = BaseComponent
        cls.Dependency = Dependency
        cls.ComponentEnum = ComponentEnum

    def tearDown(self):
        self.native._component_size = self.original

    def component(self):
        component = object.__new__(self.BaseComponent)
        component._is_started = True
        component._binding_specs = {
            'keyword_index': self.Dependency(self.ComponentEnum.KEYWORD_INDEX, 'default')}
        component.payload = {'known': ['fixture observation']}
        return component

    def test_real_dependency_metadata_failure_then_native_status_success(self):
        component = self.component()
        with self.assertRaisesRegex(RuntimeError, "accessed before start.*__dict__"):
            self.original(component)
        native_execute = self.native.StatusStep.execute
        native_collect = self.native._collect_memory
        dependency_getattr = self.Dependency.__getattr__
        self.assertEqual(compat.install('game'), compat.VERSION)
        step = object.__new__(self.native.StatusStep)
        step.app_context = SimpleNamespace(components={
            self.ComponentEnum.FILE_STORE: {'default': component}})
        step.context = SimpleNamespace(response=SimpleNamespace(answer='', metadata={}))
        result = asyncio.run(step.execute())
        memory = result.metadata['status']['memory']
        self.assertGreater(memory['components_total_bytes'], 0)
        self.assertGreater(memory['process_rss_bytes'], 0)
        self.assertTrue(result.answer)
        self.assertIs(self.native.StatusStep.execute, native_execute)
        self.assertIs(self.native._collect_memory, native_collect)
        self.assertIs(self.Dependency.__getattr__, dependency_getattr)
        with self.assertRaisesRegex(RuntimeError, 'accessed before start'):
            getattr(component._binding_specs['keyword_index'], '__dict__')

    def test_regular_graph_sizes_unchanged(self):
        import numpy as np
        class Slotted:
            __slots__ = ('payload',)
        slotted = Slotted()
        slotted.payload = ['example']
        cyclic = {'items': [None, True, 2, 3.4, b'x', bytearray(b'z')]}
        cyclic['self'] = cyclic
        cases = [cyclic, slotted, np.arange(12), SimpleNamespace(a='value')]
        expected = [self.original(value) for value in cases]
        compat.install('operations')
        self.assertEqual([self.native._component_size(value) for value in cases], expected)

    def test_only_dependency_is_skipped_not_other_introspection_errors(self):
        class UnrelatedFailure:
            __slots__ = ()
            def __getattr__(self, name):
                raise RuntimeError('unrelated introspection failure')
        compat.install('game')
        with self.assertRaisesRegex(RuntimeError, 'unrelated introspection failure'):
            self.native._component_size(UnrelatedFailure())

    def test_patch_is_exactly_one_guard_and_installs_idempotently(self):
        source = inspect.getsource(self.original)
        modified = compat.patch_source(source, compat.QWEN_VERSION, compat.REME_VERSION)
        self.assertEqual(modified.replace(compat._GUARD, '', 1), source)
        self.assertEqual(modified.count(compat._GUARD), 1)
        compat.install('game')
        installed = self.native._component_size
        self.assertEqual(compat.install('game'), compat.VERSION)
        self.assertIs(self.native._component_size, installed)

    def test_install_rejects_runtime_version_drift(self):
        with patch.object(compat.importlib.metadata, 'version', return_value='future'):
            with self.assertRaisesRegex(ValueError, 'versions'):
                compat.install('game')
        self.assertIs(self.native._component_size, self.original)


if __name__ == '__main__':
    unittest.main()
