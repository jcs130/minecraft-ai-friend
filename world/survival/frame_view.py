"""Read-only, actor-bound capture of the running Prismarine first-person renderer."""
import base64
import io
import json
import math
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

from scene_view import _status_sample


MAX_RESPONSE_BYTES = 1500000
MAX_PNG_BYTES = 1024 * 1024
MAX_FRAME_AGE_MS = 5000


class FrameError(ValueError):
    pass


class FrameView:
    def __init__(self, gateway, *, url=None, token_file=None, clock=time.time, opener=urllib.request.urlopen):
        self.gateway = gateway
        self.url = url or os.environ.get('KIRITO_FRAME_URL', 'http://world:3071/agent-frame')
        self.token_file = Path(token_file or os.environ.get('SURVIVOR_MCP_TOKEN_FILE', '/run/secrets/survivor-mcp'))
        self.clock, self.opener = clock, opener
        self._lock = threading.Lock()

    @staticmethod
    def _failure(code):
        return {'metadata': {'schema': 2, 'ok': False, 'code': code,
                             'viewType': 'first_person', 'imageAvailable': False,
                             'retryAutomatically': False}, 'png': None}

    @staticmethod
    def _with_hud(png, metadata):
        hud = metadata.get('hud')
        if not isinstance(hud, dict):
            return png, False
        position = metadata['position']
        lines = [f"KIRITO  V-FOV {metadata['fovDegrees']}  XYZ "
                 f"{position['x']:.0f}, {position['y']:.0f}, {position['z']:.0f}"]
        aim = hud.get('aimBlock')
        if isinstance(aim, dict) and isinstance(aim.get('id'), str) and type(aim.get('distance')) in (int, float):
            lines.append(f"AIM  {aim['id'][:38]}  {aim['distance']:.1f} m")
        else:
            lines.append('AIM  no solid block within 16 m')
        nearby = []
        for key in ('nearbyEntities', 'nearbyBlocks'):
            for item in (hud.get(key) or [])[:2]:
                if isinstance(item, dict) and isinstance(item.get('id'), str) and type(item.get('distance')) in (int, float):
                    nearby.append(f"{item['id'].split(':')[-1][:16]} {item['distance']:.1f}m")
        lines.append('NEAR (visibility unknown)  ' + (', '.join(nearby[:3]) or 'none'))
        with Image.open(io.BytesIO(png)) as source:
            image = source.convert('RGBA')
        overlay = Image.new('RGBA', image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        try:
            font = ImageFont.truetype('DejaVuSans.ttf', 13)
        except OSError:
            font = ImageFont.load_default()
        draw.rounded_rectangle((8, 8, 628, 68), radius=5, fill=(0, 0, 0, 184))
        for index, line in enumerate(lines):
            draw.text((16, 11 + index * 18), line[:88], font=font,
                      fill=(255, 231, 140, 255) if index == 1 else (242, 246, 252, 255))
        cx, cy = image.width // 2, image.height // 2
        draw.line((cx - 8, cy, cx - 3, cy), fill=(0, 0, 0, 230), width=3)
        draw.line((cx + 3, cy, cx + 8, cy), fill=(0, 0, 0, 230), width=3)
        draw.line((cx, cy - 8, cx, cy - 3), fill=(0, 0, 0, 230), width=3)
        draw.line((cx, cy + 3, cx, cy + 8), fill=(0, 0, 0, 230), width=3)
        draw.line((cx - 8, cy, cx - 3, cy), fill=(255, 255, 255, 255), width=1)
        draw.line((cx + 3, cy, cx + 8, cy), fill=(255, 255, 255, 255), width=1)
        draw.line((cx, cy - 8, cx, cy - 3), fill=(255, 255, 255, 255), width=1)
        draw.line((cx, cy + 3, cx, cy + 8), fill=(255, 255, 255, 255), width=1)
        output = io.BytesIO()
        Image.alpha_composite(image, overlay).convert('RGB').save(output, format='PNG')
        return output.getvalue(), True

    def capture(self):
        if not self._lock.acquire(blocking=False):
            return self._failure('frame_busy')
        try:
            body, actor = self.gateway._check_binding()
            before_dimension, _ = _status_sample(self.gateway._invoke('get_self_status'), body)
            token = self.token_file.read_text(encoding='ascii').strip()
            if not 32 <= len(token) <= 256 or any(ch.isspace() for ch in token):
                raise FrameError('frame_auth_unavailable')
            request = urllib.request.Request(self.url, headers={
                'Host': '127.0.0.1:3071', 'X-QD-Vision-Token': token, 'Accept': 'application/json'})
            try:
                with self.opener(request, timeout=32) as response:
                    raw = response.read(MAX_RESPONSE_BYTES + 1)
            except urllib.error.HTTPError as error:
                if error.code in (429, 503):
                    value = json.loads(error.read(512))
                    code = value.get('code')
                    if isinstance(code, str) and code.startswith(('frame_', 'kirito_')):
                        raise FrameError(code) from None
                raise FrameError('frame_service_unavailable') from None
            if len(raw) > MAX_RESPONSE_BYTES:
                raise FrameError('frame_response_too_large')
            value = json.loads(raw)
            metadata = value.get('metadata')
            if (value.get('ok') is not True or not isinstance(metadata, dict)
                    or metadata.get('schema') != 2 or metadata.get('viewType') != 'first_person'
                    or metadata.get('isScreenshot') is not True or metadata.get('actorName') != body
                    or metadata.get('actorUuid') != actor or metadata.get('width') != 640
                    or metadata.get('height') != 360 or metadata.get('fovDegrees') != 120):
                raise FrameError('frame_provenance_invalid')
            captured = metadata.get('sampledAt')
            if type(captured) is not int or not 0 <= self.clock() * 1000 - captured <= MAX_FRAME_AGE_MS:
                raise FrameError('frame_stale')
            geometry_time = metadata.get('geometrySampledAt')
            if (type(geometry_time) is not int or geometry_time > captured
                    or not 0 <= self.clock() * 1000 - geometry_time <= 15000):
                raise FrameError('frame_geometry_stale')
            dimension = metadata.get('dimension')
            if dimension in ('overworld', 'the_nether', 'the_end'):
                dimension = 'minecraft:' + dimension
            if dimension != before_dimension:
                raise FrameError('frame_dimension_changed')
            position = metadata.get('position')
            if (not isinstance(position, dict) or any(type(position.get(key)) not in (int, float)
                    or not math.isfinite(position[key]) for key in ('x', 'y', 'z'))):
                raise FrameError('frame_provenance_invalid')
            png = base64.b64decode(value.get('pngBase64', ''), validate=True)
            if not 10000 <= len(png) <= MAX_PNG_BYTES:
                raise FrameError('frame_pixels_invalid')
            with Image.open(io.BytesIO(png)) as image:
                if image.format != 'PNG' or image.size != (640, 360):
                    raise FrameError('frame_pixels_invalid')
                image.verify()
            after_dimension, after_position = _status_sample(self.gateway._invoke('get_self_status'), body)
            if (after_dimension != before_dimension or self.gateway._check_binding() != (body, actor)
                    or math.dist((position['x'], position['y'], position['z']), after_position) > 4):
                raise FrameError('frame_body_changed')
            png, hud_overlay = self._with_hud(png, metadata)
            if len(png) > MAX_PNG_BYTES:
                raise FrameError('frame_pixels_invalid')
            return {'metadata': {**metadata, 'ok': True, 'imageAvailable': True,
                                 'dimension': dimension, 'mimeType': 'image/png',
                                 'freshWorldRead': True, 'frameAgeMs': int(self.clock() * 1000 - captured),
                                 'geometryAgeMs': int(self.clock() * 1000 - geometry_time),
                                 'hudOverlay': hud_overlay},
                    'png': png}
        except FrameError as error:
            return self._failure(str(error))
        except (OSError, ValueError, TypeError, KeyError, AttributeError, urllib.error.URLError):
            return self._failure('frame_unavailable')
        finally:
            self._lock.release()
