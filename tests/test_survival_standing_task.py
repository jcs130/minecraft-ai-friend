"""Standing native tasks we did not dispatch: watch, name, reclaim. Never freeze.

2026-09-20 live fault: an external client issued `follow` on Kirito's body (no
terminal, budget 2.3e17s). The tick saw `busy` and refused to think for 9.8 hours
at hp 7.2/20 and hunger 5. These cases pin the three things that failure asked for:
our own tasks are never interrupted, a stranger's task is bounded, and a guard that
cannot run costs no turn.
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
import standing_task
from controller import Controller

FORBIDDEN = {'task_id': 't1551', 'task': 'follow', 'state': 'running',
             'elapsed_s': 35125, 'budget_left_s': 230584300920029563}


def body(task):
    return {'ok': True, 'task': task, 'position': {'x': 1, 'y': 64, 'z': 1}}


class Stopped:
    """A stop that answers like the native side: success, and the id it stopped."""

    def __init__(self):
        self.calls = []

    def __call__(self, task_id):
        self.calls.append(task_id)
        return {'success': True, 'data': {'task_id': task_id}}


class Observe(unittest.TestCase):
    def test_zero_start_and_exact_grace_boundary_are_not_reset(self):
        watch, stopped = {}, Stopped()
        standing_task.observe(watch, body(FORBIDDEN), 0.0, stop=stopped)
        standing_task.observe(watch, body(FORBIDDEN), standing_task.GRACE_SECONDS - .001, stop=stopped)
        self.assertEqual(stopped.calls, [])
        row = standing_task.observe(watch, body(FORBIDDEN), standing_task.GRACE_SECONDS, stop=stopped)
        self.assertEqual(stopped.calls, ['t1551'])
        self.assertEqual(row['heldSeconds'], standing_task.GRACE_SECONDS)

    def test_foreign_task_is_watched_not_obeyed(self):
        watch = {}
        row = standing_task.observe(watch, body(FORBIDDEN), 1000.0, owned=False)
        self.assertEqual((row['action'], row['taskId']), ('watching', 't1551'))
        self.assertEqual(watch['taskId'], 't1551')
        self.assertEqual(watch['log'][-1]['kind'], 'watched')
        self.assertEqual(watch['log'][-1]['budgetLeftS'], FORBIDDEN['budget_left_s'])

    def test_our_own_task_is_never_interrupted(self):
        for grace in (0, standing_task.GRACE_SECONDS, standing_task.GRACE_SECONDS * 99):
            watch, stopped = {}, []
            row = standing_task.observe(watch, body(FORBIDDEN), 1000.0 + grace, owned=True,
                                        stop=stopped.append)
            self.assertFalse(row.get('occupied'))
            self.assertEqual(stopped, [])
            self.assertIsNone(watch.get('taskId'))

    def test_a_stranger_holding_the_body_past_the_window_is_stopped_once(self):
        watch, stopped = {}, Stopped()
        standing_task.observe(watch, body(FORBIDDEN), 1000.0, owned=False, stop=stopped)
        row = standing_task.observe(watch, body(dict(FORBIDDEN, elapsed_s=36025)), 1000.0 + 901,
                                    owned=False, stop=stopped)
        self.assertEqual(stopped.calls, ['t1551'])
        self.assertEqual((row['action'], row['reclaimed'], row['heldSeconds']),
                         ('stopped', True, 901.0))
        self.assertIsNone(watch['taskId'])                     # no repeat stop next tick
        self.assertEqual([entry['kind'] for entry in watch['log']], ['watched', 'reclaim'])

    def test_a_stop_that_fails_is_recorded_and_retried_not_invented(self):
        watch = {}

        def broken(task_id):
            raise ConnectionError('rcon closed')

        standing_task.observe(watch, body(FORBIDDEN), 1000.0, owned=False, stop=broken)
        row = standing_task.observe(watch, body(FORBIDDEN), 1000.0 + 901, owned=False, stop=broken)
        self.assertEqual(row['action'], 'stop_failed:ConnectionError')
        self.assertTrue(row['reclaimed'])
        standing_task.observe(watch, body(FORBIDDEN), 1000.0 + 1802, owned=False, stop=broken)
        self.assertEqual(watch['log'][-1]['kind'], 'reclaim')  # tried again, not swallowed

    def test_the_body_becoming_idle_is_said_once(self):
        watch = {}
        standing_task.observe(watch, body(FORBIDDEN), 1000.0, owned=False)
        row = standing_task.observe(watch, body({'busy': False}), 1000.0 + 120, owned=False)
        self.assertFalse(row['occupied'])
        self.assertEqual([entry['kind'] for entry in watch['log']], ['watched', 'gone'])
        standing_task.observe(watch, body({'busy': False}), 1000.0 + 240, owned=False)
        self.assertEqual(len(watch['log']), 2)                 # no flood while still idle

    def test_a_new_stranger_starts_a_new_watch(self):
        watch = {}
        standing_task.observe(watch, body(FORBIDDEN), 1000.0, owned=False)
        standing_task.observe(watch, body(dict(FORBIDDEN, task_id='t9999', task='goto')),
                              1000.0 + 100, owned=False, stop=lambda t: self.fail('too early'))
        self.assertEqual((watch['taskId'], watch['since']), ('t9999', 1100.0))

    def test_the_log_stays_bounded(self):
        watch = {}
        for step in range(30):
            standing_task.observe(watch, body(FORBIDDEN), 1000.0 + step, owned=False)
        self.assertLessEqual(len(watch['log']), standing_task.MAX_LOG)

    def test_an_observation_without_a_stop_never_touches_the_world(self):
        watch = {}
        standing_task.observe(watch, body(FORBIDDEN), 1000.0, owned=False)
        row = standing_task.observe(watch, body(FORBIDDEN), 1000.0 + 100000, owned=False)
        self.assertEqual((row['action'], row.get('reclaimed')), ('watching', None))


class Harness:
    """Enough controller to drive watch_standing_task without a body or a model."""

    def __init__(self, root, data=None):
        now = [1000.0]
        self.clock = lambda: now[0]
        self.tick = lambda step=0: now.__setitem__(0, now[0] + step)
        self.data = dict(data or {}, status='acting')
        self.root = Path(root)
        self.recorded = []
        self.record = lambda kind, **values: self.recorded.append((kind, values))
        self.stops = []
        self.gateway = SimpleNamespace(_invoke=lambda tool, args=None: (
            self.stops.append((tool, args)) or {'success': True}))

    def watch(self, task):
        return Controller.watch_standing_task(self, body(task))

    @property
    def status(self):
        return self.data['status']


class Wiring(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        (self.root / 'skill-job.json').write_text(json.dumps({'status': 'idle'}), encoding='utf-8')

    def test_a_receipt_named_task_is_ours_however_long_it_holds(self):
        harness = Harness(self.root, data={'actionExecution': {'receipt': {'nativeTaskId': 't1551'}}})
        harness.tick(standing_task.GRACE_SECONDS + 1)
        harness.watch(FORBIDDEN)
        self.assertEqual(harness.stops, [])
        self.assertNotIn('body_occupied', harness.status)

    def test_a_skill_program_step_is_ours_too(self):
        (self.root / 'skill-job.json').write_text(
            json.dumps({'status': 'running', 'lastExecution': {'nativeTaskId': 't1551'}}), encoding='utf-8')
        harness = Harness(self.root)
        harness.tick(standing_task.GRACE_SECONDS + 1)
        harness.watch(FORBIDDEN)
        self.assertEqual(harness.stops, [])

    def test_observed_action_ownership_overrides_an_existing_foreign_watch(self):
        harness = Harness(self.root)
        harness.watch(FORBIDDEN)
        harness.data['observeAction'] = {'nativeTaskId': 't1551'}
        harness.tick(standing_task.GRACE_SECONDS + 1)
        harness.watch(FORBIDDEN)
        self.assertEqual(harness.stops, [])
        self.assertIsNone(harness.data['standingTask']['taskId'])
        self.assertEqual(harness.data['standingTask']['action'], 'owned')

    def test_unreadable_skill_ownership_never_authorizes_reclaim_after_grace(self):
        harness = Harness(self.root)
        harness.watch(FORBIDDEN)
        (self.root / 'skill-job.json').write_text('{ invalid json', encoding='utf-8')
        harness.tick(standing_task.GRACE_SECONDS + 1)
        harness.watch(FORBIDDEN)
        self.assertEqual(harness.stops, [])
        self.assertEqual(harness.data['standingTaskError'], 'skill_ownership_unavailable')
        self.assertEqual(harness.data['standingTask']['action'], 'watching')
        self.assertEqual(harness.recorded, [])

    def test_idle_clears_watch_before_a_reused_id_can_be_reclaimed(self):
        harness = Harness(self.root)
        harness.watch(FORBIDDEN)
        harness.tick(standing_task.GRACE_SECONDS - 1)
        harness.watch({'busy': False})
        self.assertIsNone(harness.data['standingTask']['taskId'])
        self.assertEqual(harness.data['standingTask']['log'][-1]['kind'], 'gone')
        harness.tick(10)
        harness.watch(FORBIDDEN)
        self.assertEqual(harness.stops, [])
        self.assertEqual(harness.data['standingTask']['since'], harness.clock())

    def test_a_stranger_past_the_window_is_stopped_by_id_and_the_later_tick_thinks(self):
        harness = Harness(self.root)
        harness.watch(FORBIDDEN)
        self.assertEqual(harness.stops, [])
        self.assertEqual(harness.status, 'body_occupied')       # named, not silently waiting
        harness.tick(standing_task.GRACE_SECONDS + 1)
        harness.watch(FORBIDDEN)
        self.assertEqual(harness.stops, [('task_stop', {'task_id': 't1551'})])
        self.assertEqual(harness.recorded[0][0], 'standing_task_reclaimed')
        self.assertEqual(harness.recorded[0][1]['elapsedS'], 35125)
        harness.tick(1)
        harness.watch({'busy': False})                          # the next tick may decide again

    def test_a_broken_guard_costs_no_turn_and_says_so(self):
        harness = Harness(self.root)
        harness.gateway = SimpleNamespace(_invoke=lambda tool, args=None: (_ for _ in ()).throw(
            RuntimeError('rcon closed')))
        (self.root / 'skill-job.json').write_text('{ not json', encoding='utf-8')  # unreadable state
        harness.tick(standing_task.GRACE_SECONDS + 1)
        harness.watch(FORBIDDEN)                                # must not raise

    def test_nothing_running_nothings_to_watch(self):
        harness = Harness(self.root)
        self.assertIsNone(harness.watch({'busy': False}))       # no task, no verdict to make
        self.assertEqual(harness.stops, [])
        self.assertEqual(harness.status, 'acting')


if __name__ == '__main__':
    unittest.main()
