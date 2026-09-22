"""Slow filesystem enumeration must not age a new classifier's physical input."""
import copy
import unittest

import test_skill_catalog_router as fixtures
from skill_router import tick


class CatalogLatencyTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.CatalogExecutionTests(methodName='runTest')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_refresh_body_after_slow_catalogue_then_revalidate_without_rescanning(self):
        f = self.fixture
        f.gateway.on_snapshot = lambda _: f.gateway.body.update(observedAt=f.clock() * 1000)
        original = f.library.catalog
        calls = []
        def slow_catalog():
            calls.append(True)
            f.clock.now += 6
            return original()
        f.library.catalog = slow_catalog
        f.select()
        self.assertEqual(f.worker.calls[0][1]['observedAt'], f.clock() * 1000)
        self.assertTrue(tick(f.controller, f.gateway.snapshot(), f.control))
        self.assertEqual(len(calls), 1)

    def test_display_cache_is_bounded_and_explicit_refresh_sees_promotion(self):
        f = self.fixture
        calls = []
        original = f.library.catalog
        def catalog():
            calls.append(True)
            return original()
        f.library.catalog = catalog
        first = copy.deepcopy(f.controller.catalog())
        self.assertEqual(f.controller.catalog(), first)
        self.assertEqual(len(calls), 1)
        f.controller.catalog(refresh=True)
        self.assertEqual(len(calls), 2)
        f.clock.now += 31
        f.controller.catalog()
        self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main()
