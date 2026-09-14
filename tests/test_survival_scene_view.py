"""Real PNGs from complete native maps, without a client or world actions."""
import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from numen_gateway import NumenGateway
import scene_view as scene


ACTOR = 'd4ac9523-4962-43ed-98c5-19b49e104048'
OTHER_ACTOR = '3bbf3f25-c322-427a-88d5-dee649506e93'
# Shape, header and the extra trailing RCON newline were observed read-only on
# the installed server on 2026-09-14. Coordinates are samples, never destinations.
LIVE_ROWS = (
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . @ . . ^ .',
    '. . . . . . . # #',
    '. . . . . . . . .',
    '. . . . . . . . ^',
    '. . . . . . . . .',
)


def native_map(radius=4, center=(-642, 64, 1050), facing='east', rows=None):
    size = 2 * radius + 1
    if rows is None:
        rows = [['.' for _ in range(size)] for _ in range(size)]
        rows[radius][radius] = '@'
        rows = [' '.join(row) for row in rows]
    return (f'look_around center=({center[0]},{center[1]},{center[2]}) facing={facing}'
            ' | 1 cell = 1 block, @ = you, North = up (-Z), East = right (+X)\n\n'
            + '\n'.join(rows) + '\n\n' + scene.LEGEND + '\n' + scene.ROUTE + '\n\n')


class NativeFixture:
    """Use real gateway identity checks and status decoding; allow reads only."""
    def __init__(self):
        self.commands = []
        self.body, self.actor = 'Kirito', ACTOR
        self.dimension = 'minecraft:overworld'
        self.position = {'x': -641.8129423553256, 'y': 64.0, 'z': 1050.9623275769848}
        self.center = (-642, 64, 1050)
        self.facing = 'east'
        self.raw = None
        self.status_values = []
        self.roster_values = []
        self.error = None
        self.on_map = None
        self.gateway = NumenGateway(rcon=self)
        self.gateway._settings = lambda: {'bodyName': self.body, 'bodyUuid': self.actor}

    def status(self):
        return {'name': self.body, 'dimension': self.dimension, 'position': dict(self.position)}

    def cmd(self, command):
        self.commands.append(command)
        if self.error:
            raise self.error
        if command == 'numen_act list':
            if self.roster_values:
                return self.roster_values.pop(0)
            return f'count=1\n{self.body}|uuid={self.actor}|online=true'
        if command == f'numen_act invoke "{self.body}" get_self_status {{}}':
            return json.dumps(self.status_values.pop(0) if self.status_values else self.status())
        prefix = f'numen_act invoke "{self.body}" look_around '
        if command.startswith(prefix):
            args = json.loads(command[len(prefix):])
            assert set(args) == {'radius'}
            if self.on_map:
                self.on_map()
            return (native_map(args['radius'], self.center, self.facing)
                    if self.raw is None else self.raw)
        raise AssertionError('Unexpected or mutating native command: ' + command)


class SceneViewTests(unittest.TestCase):
    def setUp(self):
        self.native = NativeFixture()
        self.now = 1000
        self.monotonic = 10
        self.view = scene.SceneView(self.native.gateway, clock=lambda: self.now,
                                   monotonic=lambda: self.monotonic)

    def assert_no_image(self, result, code=None):
        self.assertFalse(result['metadata']['ok'])
        self.assertFalse(result['metadata']['imageAvailable'])
        self.assertFalse(result['metadata']['retryAutomatically'])
        self.assertIsNone(result['png'])
        if code is not None:
            self.assertEqual(result['metadata']['code'], code)

    def test_actual_native_sample_decodes_as_png_with_own_identity_and_truthful_limits(self):
        self.native.raw = native_map(rows=LIVE_ROWS)
        result = self.view.capture(4)
        meta = result['metadata']
        self.assertTrue(meta['ok'])
        self.assertEqual(meta['actorUuid'], ACTOR)
        self.assertEqual(meta['actorName'], 'Kirito')
        self.assertEqual(meta['center'], {'x': -642, 'y': 64, 'z': 1050})
        self.assertEqual(meta['dimension'], 'minecraft:overworld')
        self.assertEqual(meta['facing'], 'east')
        self.assertEqual(meta['viewType'], 'semantic_top_down')
        self.assertEqual(meta['axes'], {'up': '-Z north', 'right': '+X east'})
        self.assertIsNone(meta['fovDegrees'])
        self.assertFalse(meta['isScreenshot'])
        self.assertFalse(meta['atomicSnapshot'])
        self.assertFalse(meta['lineOfSightFiltered'])
        self.assertTrue(meta['loadedOnly'])
        self.assertEqual(result['png'][:8], b'\x89PNG\r\n\x1a\n')
        with Image.open(io.BytesIO(result['png'])) as picture:
            picture.load()
            self.assertEqual(picture.format, 'PNG')
            self.assertEqual(picture.size, (meta['width'], meta['height']))
            self.assertLessEqual(max(picture.size), 640)
        self.assertLessEqual(len(result['png']), scene.MAX_PNG_BYTES)
        self.assertEqual(self.native.commands, [
            'numen_act list', 'numen_act invoke "Kirito" get_self_status {}',
            'numen_act invoke "Kirito" look_around {"radius": 4}',
            'numen_act invoke "Kirito" get_self_status {}', 'numen_act list'])

    def test_every_glyph_is_preserved_in_correct_cell_and_unknown_is_not_air(self):
        rows = [['.' for _ in range(9)] for _ in range(9)]
        rows[4][4] = '@'
        for index, glyph in enumerate(scene.GLYPHS.replace('@', '')):
            rows[index // 9][index % 9] = glyph
        self.native.raw = native_map(rows=[' '.join(row) for row in rows])
        result = self.view.capture(4)
        self.assertEqual(result['metadata']['unknownCellCount'], 1)
        with Image.open(io.BytesIO(result['png'])) as picture:
            left, top, cell = (620 - 9 * 26) // 2, 74, 26
            for row in range(9):
                for col in range(9):
                    expected = scene.COLORS[rows[row][col]][0]
                    rgb = tuple(int(expected[offset:offset + 2], 16) for offset in (1, 3, 5))
                    self.assertEqual(picture.getpixel((left + col * cell + 2, top + row * cell + 2)), rgb)
        changed = self.native.raw.replace('?', '.', 1)
        self.native.raw = changed
        other = self.view.capture(4)
        self.assertNotEqual(result['png'], other['png'])
        self.assertNotEqual(result['metadata']['mapSha256'], other['metadata']['mapSha256'])

    def test_bad_radius_never_reads_world(self):
        for value in (3, 13, -1, True, False, 8.0, None, '4'):
            with self.subTest(value=value):
                self.assert_no_image(self.view.capture(value), 'invalid_radius')
        self.assertEqual(self.native.commands, [])

    def test_radius_4_8_12_and_all_native_facings_are_bounded(self):
        for radius in (4, 8, 12):
            for facing in ('north', 'east', 'south', 'west'):
                with self.subTest(radius=radius, facing=facing):
                    self.native.facing = facing
                    result = self.view.capture(radius)
                    self.assertTrue(result['metadata']['ok'])
                    self.assertEqual(result['metadata']['gridSize'], radius * 2 + 1)
                    self.assertEqual(result['metadata']['facing'], facing)
                    self.assertLessEqual(result['metadata']['height'], 640)
                    self.assertLessEqual(len(self.view._cache), 2)

    def test_incomplete_altered_or_summarized_native_text_cannot_become_an_image(self):
        raw = native_map(rows=LIVE_ROWS)
        variants = [None, {}, raw[:-50], 'nearby flat terrain', 'no companion: Kirito',
                    raw.replace('. . . . . . . . .\n', '. .\n', 1),
                    raw.replace('. . . . . . . . .\n', '. . . . . . . . . .\n', 1),
                    raw.replace('. .', '.  .', 1), raw.replace('. .', '$ .', 1),
                    raw.replace('. .', '@ .', 1), raw.replace('@ . . ^', '. . . ^', 1),
                    raw.replace('North = up', 'South = up'), raw.replace('facing=east', 'facing=up'),
                    raw.replace(' | ? unloaded', ''), raw.replace('drop>=3', 'drop>=4'),
                    raw.replace('\n', '\r\n'), raw + 'additional invented context',
                    raw + '\n' * scene.MAX_SOURCE_BYTES, raw.replace('Kirito', '\u8c01') + '\u96ea',
                    raw.replace('(-642,64,1050)', '(30000001,64,1050)')]
        for value in variants:
            with self.subTest(value=str(value)[:80]):
                with self.assertRaises(scene.SceneError):
                    scene.parse_native_grid(value, 4)

    def test_wrong_radius_grid_fails_without_old_frame_fallback(self):
        self.assertTrue(self.view.capture(4)['metadata']['ok'])
        self.native.raw = native_map(4)
        self.assert_no_image(self.view.capture(8), 'scene_format_invalid')

    def test_cache_requires_fresh_reads_and_new_frame_receipt(self):
        first = self.view.capture(4)
        self.now += 1
        second = self.view.capture(4)
        self.assertEqual(first['png'], second['png'])
        self.assertFalse(first['metadata']['encodingReused'])
        self.assertTrue(second['metadata']['encodingReused'])
        self.assertNotEqual(first['metadata']['frameId'], second['metadata']['frameId'])
        self.assertGreater(second['metadata']['observedAt'], first['metadata']['observedAt'])
        self.assertTrue(second['metadata']['freshWorldRead'])
        self.assertEqual(len(self.native.commands), 10)
        self.native.error = OSError('private raw failure must not leak')
        failed = self.view.capture(4)
        self.assert_no_image(failed, 'scene_unavailable')
        self.assertNotIn('private', json.dumps(failed))

    def test_cache_key_includes_actor_dimension_position_and_map(self):
        self.assertTrue(self.view.capture(4)['metadata']['ok'])
        changes = [lambda: setattr(self.native, 'actor', OTHER_ACTOR),
                   lambda: setattr(self.native, 'dimension', 'minecraft:the_nether'),
                   lambda: self.native.position.update(x=-641.5),
                   lambda: setattr(self.native, 'facing', 'west'),
                   lambda: setattr(self.native, 'raw', native_map(facing='west', rows=LIVE_ROWS))]
        for change in changes:
            change()
            result = self.view.capture(4)
            self.assertTrue(result['metadata']['ok'])
            self.assertFalse(result['metadata']['encodingReused'])
            self.assertLessEqual(len(self.view._cache), scene.MAX_CACHED_FRAMES)

    def test_identity_failures_do_not_read_other_actor_or_return_cached_image(self):
        self.view.capture(4)
        original = f'count=1\nKirito|uuid={ACTOR}|online=true'
        wrong = f'count=1\nKirito|uuid={OTHER_ACTOR}|online=true'
        self.native.roster_values = [original, wrong]
        self.assert_no_image(self.view.capture(4), 'scene_unavailable')
        self.native.roster_values = ['count=0']
        self.assert_no_image(self.view.capture(4), 'scene_unavailable')
        self.native.status_values = [dict(self.native.status(), name='SomeoneElse')]
        self.assert_no_image(self.view.capture(4), 'body_sample_invalid')

    def test_changed_dimension_or_body_cell_between_samples_is_not_a_fresh_frame(self):
        before = self.native.status()
        changed_samples = [dict(before, dimension='minecraft:the_end'),
                           dict(before, position=dict(before['position'], x=-643.0)),
                           dict(before, position=dict(before['position'], y=70.0))]
        for after in changed_samples:
            self.native.status_values = [before, after]
            self.assert_no_image(self.view.capture(4), 'scene_body_changed')

    def test_native_farmland_and_slab_feet_offsets_are_accepted_without_guessing_height(self):
        for y in (64.0, 63.9375, 63.5):
            self.native.position['y'] = y
            result = self.view.capture(4)
            self.assertTrue(result['metadata']['ok'])
            self.assertEqual(result['metadata']['center']['y'], 64)
        self.native.position['y'] = 62.0
        self.assert_no_image(self.view.capture(4), 'scene_body_changed')

    def test_malformed_body_samples_fail_closed(self):
        sample = self.native.status()
        bad = [None, {}, dict(sample, dimension='unknown'),
               dict(sample, dimension='minecraft:' + 'x' * 101),
               dict(sample, position={'x': 1, 'y': 2}),
               dict(sample, position={'x': True, 'y': 64, 'z': 1050}),
               dict(sample, position={'x': float('nan'), 'y': 64, 'z': 1050}),
               dict(sample, position={'x': -642, 'y': float('inf'), 'z': 1050})]
        for value in bad:
            self.native.status_values = [value]
            # The real native gateway rejects non-object JSON before the
            # scene-specific sample validator sees it.
            expected = 'scene_unavailable' if value is None else 'body_sample_invalid'
            self.assert_no_image(self.view.capture(4), expected)

    def test_expired_capture_returns_no_image_not_a_relabelled_cache_hit(self):
        self.view.capture(4)
        self.native.on_map = lambda: setattr(self, 'monotonic', 10 + scene.MAX_CAPTURE_SECONDS + 1)
        self.assert_no_image(self.view.capture(4), 'scene_capture_expired')
        self.native.on_map = None
        self.assertTrue(self.view.capture(4)['metadata']['ok'])

    def test_concurrent_capture_has_no_unbounded_queue_or_duplicate_world_read(self):
        entered, release = threading.Event(), threading.Event()
        results = []

        def hold():
            entered.set()
            self.assertTrue(release.wait(2))

        self.native.on_map = hold
        worker = threading.Thread(target=lambda: results.append(self.view.capture(4)))
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            commands_before = len(self.native.commands)
            self.assert_no_image(self.view.capture(4), 'scene_busy')
            self.assertEqual(len(self.native.commands), commands_before)
        finally:
            release.set()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(results[0]['metadata']['ok'])

    def test_failed_encoding_is_explicit_and_never_uses_previous_image(self):
        self.view.capture(4)
        self.native.facing = 'north'
        with patch.object(scene, 'render_grid', side_effect=OSError('private path')):
            result = self.view.capture(4)
            self.assert_no_image(result, 'scene_unavailable')
            self.assertNotIn('private', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
