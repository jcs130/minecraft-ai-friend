"""Bounded, read-only PNG visualization of Numen's native movement grid.

This is a semantic top-down map, NOT a screenshot or a 110-degree perspective
view. It preserves the native glyphs; it cannot recover missing block geometry,
textures, line of sight, entity positions, or mod mechanics from those glyphs.
"""
from collections import OrderedDict
import hashlib
import io
import math
import re
import threading
import time
import uuid

from PIL import Image, ImageDraw, ImageFont


VISION_PROTOCOL = 1
SCHEMA = VISION_PROTOCOL
MIN_RADIUS, MAX_RADIUS = 4, 12
MAX_SOURCE_BYTES = 4096
MAX_PNG_BYTES = 256 * 1024
MAX_CAPTURE_SECONDS = 5
MAX_CACHED_FRAMES = 2
HEADER = re.compile(
    r'look_around center=\((-?\d{1,8}),(-?\d{1,8}),(-?\d{1,8})\) '
    r'facing=(north|east|south|west) \| '
    r'1 cell = 1 block, @ = you, North = up \(-Z\), East = right \(\+X\)\Z')
LEGEND = ('legend: @ you | . flat | ^ step-up 1 | , step-down 1-2 | v drop>=3 '
          '| # wall/blocked | ~ water | ! lava/hazard | x caution | T tree | ? unloaded')
ROUTE = 'to route: trace cell by cell (. ^ , are walkable; # ~ ! v x block or endanger you).'
GLYPHS = '@.^,v#~!xT?'
COLORS = {
    '@': ('#e6d5ff', '#321958'), '.': ('#b7d9ad', '#152d18'),
    '^': ('#e5d898', '#332909'), ',': ('#a8cfb2', '#173b29'),
    'v': ('#34283d', '#ffd480'), '#': ('#4b535f', '#ffffff'),
    '~': ('#2666ac', '#ffffff'), '!': ('#b82e36', '#ffffff'),
    'x': ('#f0ab52', '#3a220a'), 'T': ('#256846', '#ffffff'),
    '?': ('#737b87', '#ffffff'),
}
LABELS = ('@ you', '. flat', '^ step up 1', ', step down 1-2', 'v drop 3+',
          '# wall / blocked', '~ water', '! lava / hazard', 'x caution',
          'T tree', '? unloaded')
DIMENSION = re.compile(r'[a-z0-9_.-]+:[a-z0-9_./-]+\Z')


class SceneError(ValueError):
    """A fixed failure code, never the raw server response."""


def parse_native_grid(raw, radius):
    """Accept only the complete existing look_around protocol, not summaries."""
    if type(radius) is not int or not MIN_RADIUS <= radius <= MAX_RADIUS:
        raise SceneError('invalid_radius')
    if (not isinstance(raw, str) or len(raw) > MAX_SOURCE_BYTES
            or not raw.isascii() or len(raw.encode('ascii')) > MAX_SOURCE_BYTES):
        raise SceneError('scene_format_invalid')
    # RCON adds a final newline. No other normalization: missing cells, unknown
    # symbols and changed legends must not silently acquire invented semantics.
    canonical = raw.rstrip('\n')
    lines = canonical.split('\n')
    size = 2 * radius + 1
    if (len(lines) != size + 5 or lines[1] != '' or lines[size + 2] != ''
            or lines[-2:] != [LEGEND, ROUTE]):
        raise SceneError('scene_format_invalid')
    match = HEADER.fullmatch(lines[0])
    if not match:
        raise SceneError('scene_format_invalid')
    center = tuple(int(match[i]) for i in range(1, 4))
    if (abs(center[0]) > 30000000 or abs(center[2]) > 30000000
            or not -2048 <= center[1] <= 2048):
        raise SceneError('scene_format_invalid')
    rows = tuple(tuple(line.split(' ')) for line in lines[2:size + 2])
    if (any(len(row) != size or any(len(cell) != 1 or cell not in GLYPHS
                                    for cell in row) for row in rows)
            or rows[radius][radius] != '@'
            or sum(row.count('@') for row in rows) != 1):
        raise SceneError('scene_format_invalid')
    return {'center': center, 'facing': match[4], 'rows': rows,
            'mapSha256': hashlib.sha256(canonical.encode('ascii')).hexdigest()}


def _status_sample(value, body):
    if not isinstance(value, dict) or value.get('name') != body:
        raise SceneError('body_sample_invalid')
    dimension, position = value.get('dimension'), value.get('position')
    if (not isinstance(dimension, str) or len(dimension) > 100
            or not DIMENSION.fullmatch(dimension) or not isinstance(position, dict)):
        raise SceneError('body_sample_invalid')
    coords = tuple(position.get(key) for key in ('x', 'y', 'z'))
    if (any(type(v) not in (int, float) or not math.isfinite(v) for v in coords)
            or abs(coords[0]) > 30000000 or abs(coords[2]) > 30000000
            or not -2048 <= coords[1] <= 2048):
        raise SceneError('body_sample_invalid')
    return dimension, coords


def _matches_center(position, center):
    # Native Movement.feet adds 0.1251 to Y, then raises slabs/stairs one cell.
    # We cannot inspect that block here: accept those two native possibilities,
    # while the actual displayed Y remains the authoritative map header's Y.
    return (math.floor(position[0]) == center[0] and math.floor(position[2]) == center[2]
            and center[1] in (math.floor(position[1] + 0.1251),
                              math.floor(position[1] + 0.1251) + 1))


def render_grid(grid):
    """One native glyph -> one visible cell; Pillow is already in survivor."""
    rows, center = grid['rows'], grid['center']
    size = len(rows)
    cell = min(26, 450 // size)
    width, height = 620, 80 + size * cell + 94
    picture = Image.new('RGB', (width, height), '#101821')
    draw, font = ImageDraw.Draw(picture), ImageFont.load_default()
    draw.text((18, 12), 'LOCAL MOVEMENT MAP - semantic top-down, not a screenshot',
              fill='#ffffff', font=font)
    draw.text((18, 31), f'Center {center}   Facing {grid["facing"]}', fill='#d6e2ed', font=font)
    draw.text((18, 49), 'NORTH = UP (-Z)   EAST = RIGHT (+X)   1 cell = 1 block',
              fill='#d6e2ed', font=font)
    left, top = (width - size * cell) // 2, 74
    for row_index, row in enumerate(rows):
        for column, glyph in enumerate(row):
            x, y = left + column * cell, top + row_index * cell
            background, foreground = COLORS[glyph]
            draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=background, outline='#263340')
            bounds = draw.textbbox((0, 0), glyph, font=font)
            tx = x + (cell - (bounds[2] - bounds[0])) // 2 - bounds[0]
            ty = y + (cell - (bounds[3] - bounds[1])) // 2 - bounds[1]
            draw.text((tx, ty), glyph, fill=foreground, font=font)
    legend_top = top + size * cell + 10
    for index, label in enumerate(LABELS):
        x, y = 18 + (index % 3) * 200, legend_top + (index // 3) * 16
        draw.rectangle((x, y + 1, x + 10, y + 11), fill=COLORS[label[0]][0])
        draw.text((x + 16, y), label, fill='#d6e2ed', font=font)
    draw.text((18, height - 18), 'Loaded cells only; no textures, exact heights, entities, or line-of-sight filtering.',
              fill='#aebdcb', font=font)
    stream = io.BytesIO()
    picture.save(stream, format='PNG')
    encoded = stream.getvalue()
    if len(encoded) > MAX_PNG_BYTES or width > 640 or height > 640:
        raise SceneError('scene_image_too_large')
    return encoded, width, height


class SceneView:
    """Fixed gateway body, one capture at a time, at most two encoded frames.

    Cache hits ONLY reuse encoding after a new full world read. An unavailable
    or changed world sample never falls back to an older image. No filesystem,
    player connection, game action, model, camera control or worker is created.
    """
    def __init__(self, gateway, clock=time.time, monotonic=time.monotonic):
        self.gateway, self.clock, self.monotonic = gateway, clock, monotonic
        self._lock = threading.Lock()
        self._cache = OrderedDict()

    @staticmethod
    def _failure(code):
        return {'metadata': {'schema': SCHEMA, 'ok': False, 'code': code,
                             'viewType': 'semantic_top_down', 'imageAvailable': False,
                             'retryAutomatically': False}, 'png': None}

    def capture(self, radius=8):
        if type(radius) is not int or not MIN_RADIUS <= radius <= MAX_RADIUS:
            return self._failure('invalid_radius')
        if not self._lock.acquire(blocking=False):
            return self._failure('scene_busy')
        try:
            started, deadline = int(self.clock() * 1000), self.monotonic() + MAX_CAPTURE_SECONDS

            def check_time():
                if self.monotonic() > deadline:
                    raise SceneError('scene_capture_expired')

            body, actor = self.gateway._check_binding()
            if (not isinstance(body, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,16}', body)
                    or not isinstance(actor, str) or str(uuid.UUID(actor)) != actor):
                raise SceneError('body_binding_invalid')
            check_time()
            before_dimension, before = _status_sample(self.gateway._invoke('get_self_status'), body)
            check_time()
            raw = self.gateway._native_scene(body, radius)
            grid = parse_native_grid(raw, radius)
            check_time()
            dimension, after = _status_sample(self.gateway._invoke('get_self_status'), body)
            if (before_dimension != dimension or not _matches_center(before, grid['center'])
                    or not _matches_center(after, grid['center'])):
                raise SceneError('scene_body_changed')
            check_time()
            if self.gateway._check_binding() != (body, actor):
                raise SceneError('scene_body_changed')
            check_time()
            key = (body, actor, dimension, before, after, radius, grid['center'],
                   grid['facing'], grid['mapSha256'])
            cached = key in self._cache
            if cached:
                encoded, width, height = self._cache[key]
                self._cache.move_to_end(key)
            else:
                encoded, width, height = render_grid(grid)
                self._cache[key] = (encoded, width, height)
                while len(self._cache) > MAX_CACHED_FRAMES:
                    self._cache.popitem(last=False)
            check_time()
            metadata = {
                'schema': SCHEMA, 'ok': True, 'imageAvailable': True,
                'viewType': 'semantic_top_down', 'source': 'numen.look_around',
                'actorName': body, 'actorUuid': actor, 'dimension': dimension,
                'center': dict(zip(('x', 'y', 'z'), grid['center'])), 'facing': grid['facing'],
                'radius': radius, 'gridSize': radius * 2 + 1, 'cellSizeBlocks': 1,
                'axes': {'up': '-Z north', 'right': '+X east'},
                'mapSha256': grid['mapSha256'], 'frameId': uuid.uuid4().hex,
                'observedAt': int(self.clock() * 1000), 'captureStartedAt': started,
                'width': width, 'height': height, 'mimeType': 'image/png',
                'freshWorldRead': True, 'encodingReused': cached, 'atomicSnapshot': False,
                'loadedOnly': True, 'unknownCellCount': sum(row.count('?') for row in grid['rows']),
                'isScreenshot': False, 'fovDegrees': None, 'lineOfSightFiltered': False,
                'notice': 'Native movement summary around this body, not a first-person view. '
                    'Height bands are collapsed; no block IDs/textures, entity overlay or mod-specific '
                    'details are inferred. Unknown cells stay unknown. Capture is several bounded '
                    'read-only samples, not one atomic server tick.'}
            return {'metadata': metadata, 'png': encoded}
        except SceneError as error:
            return self._failure(str(error))
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            return self._failure('scene_unavailable')
        finally:
            self._lock.release()
