"""First-person image transport never relabels a map or mismatched body frame."""
import base64
import io
import json
import random
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from frame_view import FrameView

ACTOR = 'd4ac9523-4962-43ed-98c5-19b49e104048'


class Gateway:
    def _check_binding(self):
        return 'Kirito', ACTOR

    def _invoke(self, name):
        assert name == 'get_self_status'
        return {'name': 'Kirito', 'dimension': 'minecraft:overworld',
                'position': {'x': 12.5, 'y': 65, 'z': -8.5}}


class FrameTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.token = Path(temp.name) / 'token'
        self.token.write_text('x' * 48, encoding='ascii')
        picture = Image.frombytes('RGB', (640, 360), random.Random(7).randbytes(640 * 360 * 3))
        stream = io.BytesIO(); picture.save(stream, format='PNG'); self.png = stream.getvalue()
        assert len(self.png) > 10000
        self.frame = {'ok': True, 'metadata': {'schema': 2, 'viewType': 'first_person',
            'isScreenshot': True, 'actorName': 'Kirito', 'actorUuid': ACTOR, 'dimension': 'overworld',
            'position': {'x': 12.5, 'y': 65, 'z': -8.5}, 'sampledAt': 999500,
            'geometrySampledAt': 995000,
            'width': 640, 'height': 360, 'fovDegrees': 120},
            'pngBase64': base64.b64encode(self.png).decode('ascii')}

    def capture(self):
        def opener(request, timeout):
            self.assertEqual(timeout, 32)
            self.assertEqual(request.get_header('X-qd-vision-token'), 'x' * 48)
            return io.BytesIO(json.dumps(self.frame).encode('utf-8'))
        return FrameView(Gateway(), token_file=self.token, clock=lambda: 1000, opener=opener).capture()

    def test_real_png_and_actor_provenance(self):
        result = self.capture()
        self.assertTrue(result['metadata']['ok'])
        self.assertEqual(result['metadata']['frameAgeMs'], 500)
        self.assertEqual(result['metadata']['geometryAgeMs'], 5000)
        self.assertEqual(result['metadata']['dimension'], 'minecraft:overworld')
        self.assertEqual(result['png'], self.png)
        self.assertFalse(result['metadata']['hudOverlay'])

    def test_native_aim_and_nearby_items_are_drawn_as_hud(self):
        self.frame['metadata']['hud'] = {
            'aimBlock': {'id': 'minecraft:stone', 'distance': 3.5, 'x': 12, 'y': 65, 'z': -5},
            'nearbyBlocks': [{'id': 'minecraft:chest', 'distance': 6.0, 'x': 15, 'y': 65, 'z': -9}],
            'nearbyEntities': []}
        result = self.capture()
        self.assertTrue(result['metadata']['hudOverlay'])
        self.assertNotEqual(result['png'], self.png)
        with Image.open(io.BytesIO(result['png'])) as picture:
            self.assertEqual(picture.size, (640, 360))

    def test_wrong_actor_or_old_frame_has_no_image(self):
        self.frame['metadata']['actorUuid'] = '00000000-0000-4000-8000-000000000001'
        result = self.capture()
        self.assertFalse(result['metadata']['ok']); self.assertIsNone(result['png'])
        self.assertEqual(result['metadata']['code'], 'frame_provenance_invalid')
        self.frame['metadata']['actorUuid'] = ACTOR
        self.frame['metadata']['sampledAt'] = 990000
        self.assertEqual(self.capture()['metadata']['code'], 'frame_stale')

    def test_old_geometry_does_not_gain_fresh_pose_label(self):
        self.frame['metadata']['geometrySampledAt'] = 980000
        self.assertEqual(self.capture()['metadata']['code'], 'frame_geometry_stale')


if __name__ == '__main__': unittest.main()
