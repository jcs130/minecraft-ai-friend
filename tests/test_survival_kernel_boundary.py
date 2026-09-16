"""The self-evolution kernel's import boundary.

These modules are the reusable core of the evolving agent: the experience store,
the skill library, the adaptive router, pattern detection, review/dreaming,
perception and progression. They may import the standard library, each other,
and the narrow world-adapter surface declared in ADAPTER - nothing else.

Widening ADAPTER is a design decision, not a detail: every added name is one
more thing a second consumer (a different game, a different world) must
implement before the kernel can run. Widening it silently is the failure this
test exists to prevent.
"""
import ast
from pathlib import Path
import sys
import unittest

SURVIVAL = Path(__file__).parents[1] / 'world/survival'
KERNEL = {'pattern_detector', 'adaptive_router', 'review', 'practice', 'skill_library',
          'progression', 'perception', 'inference_errors', 'life_session', 'knowledge',
          'fast_execution'}
# The kernel's declared world contract and existing gateway utilities.
ADAPTER = {'numen_gateway': {'GatewayError', 'IDENTIFIER', 'TOOLS', 'TURN_ID',
                             'action_lock', 'read_json', 'write_json'},
           'world_adapter': {'WorldAdapter'}}
# Third-party native extensions installed only in the survivor image.
OPTIONAL = {'quickjs'}


def imports(tree):
    """Every import in the module, including function-local ones."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name.split('.')[0], None
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0, 'flat layout has no relative imports'
            for alias in node.names:
                yield node.module.split('.')[0], alias.name


def defined(module):
    """Module-level names a consumer could import, without importing it."""
    tree = ast.parse((SURVIVAL / (module + '.py')).read_text(encoding='utf8'))
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update((alias.asname or alias.name).split('.')[0] for alias in node.names)
    return names


class KernelBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.trees = {}
        for module in sorted(KERNEL):
            path = SURVIVAL / (module + '.py')
            self.assertTrue(path.is_file(), module)
            self.trees[module] = ast.parse(path.read_text(encoding='utf8'))

    def test_kernel_imports_only_stdlib_itself_or_the_declared_adapter(self):
        for module, tree in self.trees.items():
            for target, name in imports(tree):
                if target in sys.stdlib_module_names or target in KERNEL or target in OPTIONAL:
                    continue
                self.assertIn(target, ADAPTER,
                              module + ' reaches outside the kernel: ' + target)
                self.assertIn(name, ADAPTER[target],
                              module + ' imports an undeclared adapter name: ' + target + '.' + name)

    def test_declared_adapter_surface_is_exactly_what_the_kernel_uses(self):
        used = {target: set() for target in ADAPTER}
        for tree in self.trees.values():
            for target, name in imports(tree):
                if target in ADAPTER:
                    used[target].add(name)
        self.assertEqual(used, ADAPTER, 'ADAPTER must list the used names and no stale ones')

    def test_every_declared_adapter_name_exists_in_its_module(self):
        for target, names in ADAPTER.items():
            self.assertLessEqual(names, defined(target), target)


if __name__ == '__main__':
    unittest.main()
