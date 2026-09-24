"""Discover existing tested navigation through real wake/submit paths, without IO."""
import copy
import json
import unittest
from unittest.mock import Mock

import test_survival_controller as fixture
from behavior_context import acknowledge, prepare


class NavigationCapabilityTests(unittest.TestCase):
    create = fixture.ControllerTests.create
    write = fixture.ControllerTests.write

    def setUp(self):
        fixture.ControllerTests.setUp(self)
        self.c = self.controller
        self.c.settings.update(brainProtocol=1, contextProtocol=2, memoryEpoch='card-fixture', asyncMotor=True)
        self.c.data['wakeReason'] = 'world_changed'
        self.row = {'name': 'base_navigate', 'activeVersion': 'a' * 64,
                    'testEligibility': {'status': 'current', 'indexProofOnly': True}}
        self.skills.catalog = Mock(side_effect=lambda: {'skills': [copy.deepcopy(self.row)]})
        self.body = copy.deepcopy(self.gateway.body)
        self.body['position']['x'] = 220
        self.body['observedAt'] = self.clock() * 1000
        self.control = {'enabled': True, 'mission': 'Choose my own route'}

    def context(self, turn='survival-capability-1'):
        return self.c.life_context(self.body, self.control, turn)

    def test_real_brain_protocol_wake_includes_exact_tested_return_call_without_dispatch(self):
        value = self.context()
        card = value['continuousNavigation']
        self.assertEqual(card['sourceProof']['activeVersion'], self.row['activeVersion'])
        self.assertEqual(card['callTemplate']['arguments']['mode'], 'return_to_work_area')
        self.assertNotIn('version', card['callTemplate']['arguments'])
        self.assertNotIn('memory', card['callTemplate']['arguments'])
        self.assertEqual(card['callTemplate']['tool'], 'navigate')
        self.assertFalse(self.gateway.actions or self.gateway.opened or self.backend.submitted)
        self.assertFalse((self.state/'skill-job.json').exists())

    def test_actual_submit_sends_capability_through_protocol_two(self):
        self.c.submit_model(self.body, self.control)
        sent = json.loads(self.backend.submitted[-1]['prompt'].split('\n', 1)[1])
        self.assertEqual(sent['brainProtocol'], 1)
        self.assertEqual(sent['updates']['continuousNavigation']['callTemplate']['tool'], 'navigate')
        self.assertEqual(sent['updates']['continuousNavigation']['sourceProof']['name'], 'base_navigate')
        self.assertFalse(self.gateway.actions or (self.state/'skill-job.json').exists())

    def test_missing_invalid_or_stale_catalog_never_claims_available(self):
        for status in (None, 'unknown', 'unavailable', 'stale'):
            self.row['testEligibility'] = {} if status is None else {'status': status}
            self.clock.now += 31
            self.assertNotIn('continuousNavigation', self.context())
        self.row.update(activeVersion='not-a-version', testEligibility={'status': 'current'})
        self.clock.now += 31
        self.assertNotIn('continuousNavigation', self.context())
        self.row.update(name='another_program', activeVersion='a' * 64)
        self.clock.now += 31
        self.assertNotIn('continuousNavigation', self.context())

    def test_inside_area_template_does_not_invent_a_destination(self):
        self.body['position']['x'] = 100
        card = self.context()['continuousNavigation']
        args = card['callTemplate']['arguments']
        self.assertTrue(all(isinstance(args[key], str) for key in ('x', 'z')))
        self.assertNotIn('y', args)
        self.assertNotIn('version', args)
        self.assertNotIn('memory', args)
        self.assertIn('Y', card['instruction'])
        self.assertTrue(card['requiresFillingTemplate'])
        self.assertEqual(card['workArea'], self.c.settings['workArea'])

    def test_legacy_life_and_planning_context_have_same_card(self):
        self.c.settings['brainProtocol'] = 0
        life = self.context()
        planned = self.c.planning_context(self.body, self.control, 'survival-capability-2')
        self.assertEqual(life['continuousNavigation'], planned['continuousNavigation'])

    def test_unchanged_card_is_delta_suppressed_new_version_is_delivered(self):
        value = self.context()
        _, first, delivery = prepare(self.state, self.c.session, value, {})
        self.assertIn('continuousNavigation', first['updates'])
        acknowledge(self.state, self.c.session, delivery)
        value = self.context('survival-capability-2')
        _, second, _ = prepare(self.state, self.c.session, value, {})
        self.assertNotIn('continuousNavigation', second['updates'])
        self.row['activeVersion'] = 'b' * 64
        self.clock.now += 31
        value = self.context('survival-capability-3')
        _, third, _ = prepare(self.state, self.c.session, value, {})
        self.assertEqual(third['updates']['continuousNavigation']['sourceProof']['activeVersion'], 'b' * 64)

    def test_catalog_failure_does_not_keep_advertising_stale_cached_card(self):
        self.assertIn('continuousNavigation', self.context())
        self.skills.catalog.side_effect = OSError('unavailable')
        self.clock.now += 31
        self.assertNotIn('continuousNavigation', self.context())

    def test_becoming_ineligible_removes_previously_acknowledged_capability(self):
        _, _, delivery = prepare(self.state, self.c.session, self.context(), {})
        acknowledge(self.state, self.c.session, delivery)
        self.row['testEligibility'] = {'status': 'stale'}
        self.clock.now += 31
        _, delta, _ = prepare(self.state, self.c.session, self.context('survival-capability-2'), {})
        self.assertIn('continuousNavigation', delta['removed'])
        self.assertNotIn('continuousNavigation', delta['updates'])

    def test_area_transition_updates_template_but_small_motion_does_not_repeat_it(self):
        _, _, delivery = prepare(self.state, self.c.session, self.context(), {})
        acknowledge(self.state, self.c.session, delivery)
        self.body['position']['x'] = 204
        _, second, _ = prepare(self.state, self.c.session, self.context('survival-capability-2'), {})
        self.assertNotIn('continuousNavigation', second['updates'])
        self.body['position']['x'] = 150
        _, third, _ = prepare(self.state, self.c.session, self.context('survival-capability-3'), {})
        self.assertIn('x', third['updates']['continuousNavigation']['callTemplate']['arguments'])
        self.assertNotIn('mode', third['updates']['continuousNavigation']['callTemplate']['arguments'])


if __name__ == '__main__':
    unittest.main()
