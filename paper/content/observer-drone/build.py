"""Build our small original spectator model into a fresh external directory."""
import argparse
import hashlib
import json
import struct
import zlib
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
output = args.output.resolve()
assert not output.exists() and not output.is_relative_to(Path(__file__).resolve().parent)
output.mkdir(parents=True)

def save(name, value):
    (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

palette = [(39, 50, 64, 255), (155, 171, 186, 255), (34, 211, 238, 255),
           (8, 17, 28, 255), (251, 191, 36, 255), (74, 222, 128, 255)]
pixels = b''.join(b'\x00' + b''.join(bytes(palette[min(x // 8, 5)]) for x in range(64)) for y in range(64))

def chunk(kind, value):
    return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)

(output / 'default.png').write_bytes(b'\x89PNG\r\n\x1a\n'
    + chunk(b'IHDR', struct.pack('>IIBBBBB', 64, 64, 8, 6, 0, 0, 0))
    + chunk(b'IDAT', zlib.compress(pixels, 9)) + chunk(b'IEND', b''))

def cube(origin, size, color):
    faces = {face: {'uv': [color * 8, 0], 'uv_size': [7, 7]} for face in ['north', 'south', 'east', 'west', 'up', 'down']}
    return {'origin': origin, 'size': size, 'uv': faces}

bones = [{'name': 'Root', 'pivot': [0, 0, 0]},
         {'name': 'Body', 'parent': 'Root', 'pivot': [0, 18, 0], 'cubes': [
             cube([-4, 16.5, -3], [8, 3, 6], 0), cube([-3, 19.5, -2], [6, 1, 4], 1),
             cube([-2, 16.75, -4.5], [4, 2, 1.5], 3), cube([-1.5, 17.1, -4.75], [3, 1.2, .25], 2),
             cube([-10, 17.5, -.6], [20, 1, 1.2], 1), cube([-.6, 17.5, -8], [1.2, 1, 16], 1),
             cube([-3.5, 14.5, -2], [.75, 2, 4], 3), cube([2.75, 14.5, -2], [.75, 2, 4], 3),
             cube([-1, 17.5, 3], [2, .75, .25], 5)]}]
for index, (x, z) in enumerate([(-8, -6), (8, -6), (-8, 6), (8, 6)]):
    bones.append({'name': f'Rotor{index}', 'parent': 'Body', 'pivot': [x, 19, z], 'cubes': [
        cube([x - .75, 18, z - .75], [1.5, 1.25, 1.5], 4),
        cube([x - 3, 19.25, z - .4], [6, .2, .8], 3),
        cube([x - .4, 19.25, z - 3], [.8, .2, 6], 3)]})

def geometry(name, parts):
    return {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': name, 'texture_width': 64, 'texture_height': 64,
                        'visible_bounds_width': 3, 'visible_bounds_height': 3, 'visible_bounds_offset': [0, 1, 0]},
        'bones': parts}]}

save('main.json', geometry('geometry.qiandengji_observer_drone', bones))
save('arm.json', geometry('geometry.qiandengji_observer_drone_arms', [
    {'name': 'LeftArm', 'pivot': [0, 0, 0]}, {'name': 'RightArm', 'pivot': [0, 0, 0]}]))
tracks = {'Body': {'position': {'0': [0, 0, 0], '1': [0, .4, 0], '2': [0, 0, 0]}}}
for index in range(4):
    tracks[f'Rotor{index}'] = {'rotation': {'0': [0, 0, 0], '2': [0, 7200 if index % 2 == 0 else -7200, 0]}}
animation = {'loop': True, 'animation_length': 2, 'bones': tracks}
states = ['idle', 'walk', 'run', 'fly', 'swim', 'swim_stand', 'jump', 'sneak', 'sneaking',
          'elytra_fly', 'climbing', 'boat', 'ride', 'ride_pig', 'riptide', 'sit', 'empty']
save('main.animation.json', {'format_version': '1.8.0', 'animations': {name: animation for name in states}})
save('arm.animation.json', {'format_version': '1.8.0', 'animations': {'idle': {'loop': True, 'animation_length': 2, 'bones': {}}}})
save('ysm.json', {'spec': 2, 'metadata': {'name': '千灯纪 · 观战无人机',
    'tips': '观战账号专用形象。模型只改变外观；无敌、飞行和不碰撞由服务器旁观模式提供。',
    'authors': [{'name': 'jcs130 / Codex', 'role': '原创几何、贴图和动画'}],
    'license': {'type': 'CC0', 'desc': 'Original observer drone assets, CC0-1.0.'}},
    'properties': {'free': True, 'height_scale': 1, 'width_scale': 1,
                   'default_texture': 'default', 'preview_animation': 'idle'},
    'files': {'player': {'model': {'main': 'main.json', 'arm': 'arm.json'},
                         'animation': {'main': 'main.animation.json', 'arm': 'arm.animation.json'},
                         'texture': ['default.png']}}})
manifest = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in output.iterdir() if file.is_file()}
print(json.dumps({'model': 'qd_observer_drone', 'files': manifest, 'bytes': sum(file.stat().st_size for file in output.iterdir())}))
