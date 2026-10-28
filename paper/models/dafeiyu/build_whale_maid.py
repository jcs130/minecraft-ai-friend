"""Build a new whale-maid fan model from the reviewed character references.

References and character authors are recorded in README and ysm.json. No input
from the encrypted ccci202 model, third-party meshes, or reference-image pixels.
Python 3.11+, Pillow; output must not exist. Retains qd_dafeiyu and texture IDs.
"""
from __future__ import annotations

from copy import deepcopy
from io import BytesIO
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from PIL import Image, ImageDraw

from build import bone, cube, encoded, geometry, loop, validate, wave

MODEL_ID = 'qd_dafeiyu'
VERSION = '1.1.0'
COLORS = ['ffe4d6', 'efb8aa', '253d7c', '4165b0', '669bdb', '8fc7ed',
          '18253f', '293c61', 'f5f6f7', 'c8d5e8', '467dc1', 'd6bf86',
          '111b2c', '497db6', 'eeabb7', 'e7f1fb']
VARIANTS = {'pearl': {}, 'moon': {2: '1c2c62', 3: '365291', 4: '527db9', 5: '80afda'},
            'sunset': {2: '315386', 3: '527fbd', 4: '7db3df', 5: 'aad6ed'}}


def atlas(overrides):
    colors = list(COLORS)
    for index, value in overrides.items():
        colors[index] = value
    image = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for i, color in enumerate(colors):
        x, y = i % 8 * 16, i // 8 * 16
        draw.rectangle((x, y, x + 15, y + 15), fill='#' + color)
    # A hand-painted pixel face. It is not a crop or trace of a reference image.
    face = Image.new('RGBA', (64, 64), '#' + colors[0])
    p = ImageDraw.Draw(face)
    p.rectangle((0, 0, 63, 8), fill='#fbdccf')
    for x in (9, 39):
        p.ellipse((x, 25, x + 17, 43), fill='#fffafb')
        p.ellipse((x + 3, 26, x + 15, 44), fill='#4262a4')
        p.rectangle((x + 5, 33, x + 14, 42), fill='#78b9ed')
        p.ellipse((x + 6, 26, x + 12, 39), fill='#203a69')
        p.ellipse((x + 3, 27, x + 8, 32), fill='#ffffff')
        p.rectangle((x + 12, 37, x + 14, 39), fill='#d9f6ff')
        p.arc((x - 2, 23, x + 19, 42), 190, 343, fill='#18243d', width=3)
        p.line((x - 2, 26, x + 1, 28), fill='#18243d', width=2)
        p.line((x + 16, 27, x + 20, 24), fill='#18243d', width=2)
        p.line((x + 2, 19, x + 14, 18), fill='#526496', width=1)
    p.ellipse((4, 43, 16, 48), fill='#f0b4bc')
    p.ellipse((48, 43, 60, 48), fill='#f0b4bc')
    p.point((32, 44), fill='#d29591')
    p.line((28, 49, 30, 50, 32, 49, 34, 50, 36, 49), fill='#a86573', width=1)
    image.paste(face, (0, 48))
    out = BytesIO()
    image.save(out, format='PNG', optimize=False)
    return out.getvalue()


def main_model():
    bones = [bone('Root', None, [0, 0, 0]), bone('AllBody', 'Root', [0, 15, 0]),
             bone('Body', 'AllBody', [0, 21, 0], [
                 cube([-3.3, 15, -2], [6.6, 9.7, 4], 6),
                 cube([-1.3, 24, -1.2], [2.6, 2, 2.4], 0),
                 cube([-3.7, 14.5, -2.4], [7.4, 1.1, 4.8], 8),
                 cube([-2.65, 18, -2.35], [5.3, 5.7, .6], 8),
                 cube([-2.9, 15.7, -2.5], [5.8, 2.5, .65], 9),
                 cube([-.22, 19.1, -2.99], [.44, .44, .2], 6),
                 cube([-.22, 20.4, -2.99], [.44, .44, .2], 6),
                 cube([-.22, 21.7, -2.99], [.44, .44, .2], 6),
                 cube([-2.1, 23.5, -2.7], [2.1, 1.5, .6], 8, pivot=[0, 24, -2], rotation=[0, 0, -20]),
                 cube([0, 23.5, -2.7], [2.1, 1.5, .6], 8, pivot=[0, 24, -2], rotation=[0, 0, 20]),
                 cube([-2, 22.55, -3.1], [2, 1.4, .5], 6, pivot=[0, 23.3, -2.8], rotation=[0, 0, -20]),
                 cube([0, 22.55, -3.1], [2, 1.4, .5], 6, pivot=[0, 23.3, -2.8], rotation=[0, 0, 20]),
                 cube([-.5, 22.85, -3.6], [1, 1, .6], 10),
                 cube([-.3, 23.05, -3.9], [.6, .6, .3], 5)])]
    # Shoulder straps have a separate white scallop at every step.
    for side in (-1, 1):
        for y in (19.5, 21, 22.5, 24):
            bones[2].setdefault('cubes', []).append(cube([side * 3 - .5, y, -2.5], [1, 1.2, .8], 8))
    head = cube([-4.6, 25.4, -3.8], [9.2, 8.8, 7.6], 0)
    head['uv']['north'] = {'uv': [0, 48], 'uv_size': [64, 64]}
    bones += [bone('Head', 'Body', [0, 25.4, 0], [head]),
              bone('HairCap', 'Head', [0, 33, 0], [
                  cube([-4.9, 33, -4], [9.8, 1.7, 8.1], 3),
                  cube([-4.8, 26, 2.6], [9.6, 7.4, 1.7], 2),
                  cube([-4.8, 31.4, -4.15], [2.4, 2.8, 1], 3, pivot=[-2, 34, -3.8], rotation=[0, 0, -12]),
                  cube([-2.6, 32, -4.25], [2.7, 2.3, 1.1], 3, pivot=[-.2, 34, -3.8], rotation=[0, 0, -9]),
                  cube([-.7, 30.7, -4.3], [1.5, 3.6, 1.15], 3, pivot=[0, 34, -3.8], rotation=[0, 0, 6]),
                  cube([.5, 32, -4.25], [2, 2.4, 1.1], 3, pivot=[0, 34, -3.8], rotation=[0, 0, 9]),
                  cube([2.4, 31.4, -4.12], [2.5, 2.9, 1.1], 3, pivot=[2, 34, -3.8], rotation=[0, 0, 12]),
                  cube([-3.6, 32.7, -4.3], [.8, 1.1, .4], 4),
                  cube([.4, 32.6, -4.4], [.8, 1.1, .4], 4)]),
              bone('HairBack', 'Head', [0, 29, 3.1], [
                  cube([-4.7, 22.4, 2.7], [9.4, 7.6, 2], 3),
                  cube([-3.8, 22.5, 4.4], [1.6, 6.5, .5], 4),
                  cube([1.4, 22.5, 4.4], [1.8, 6.5, .5], 4)]),
              bone('HairBackTip', 'HairBack', [0, 23, 3.7], [
                  cube([-4.9, 15.3, 2.7], [3, 8, 2.3], 4, pivot=[-2, 23, 3.7], rotation=[0, 0, -6]),
                  cube([-1.8, 14, 2.8], [3.6, 9.2, 2.4], 4),
                  cube([1.9, 15.3, 2.7], [3, 8, 2.3], 4, pivot=[2, 23, 3.7], rotation=[0, 0, 6]),
                  cube([-4.2, 13.8, 2.8], [2.7, 2.7, 2.2], 5, rotation=[0, 0, -9], pivot=[-2, 16, 3.7]),
                  cube([1.5, 13.8, 2.8], [2.7, 2.7, 2.2], 5, rotation=[0, 0, 9], pivot=[2, 16, 3.7])])]
    frill = []
    for i in range(-3, 4):
        frill.append(cube([i * 1.35 - .8, 34.4 - abs(i) * .23, -.6], [1.6, 1.4, 3], 8,
                          pivot=[0, 34.8, 0], rotation=[0, 0, -i * 6]))
    bones.append(bone('Headdress', 'Head', [0, 34, 0], frill))
    bones.append(bone('Ahoge', 'Head', [0, 34.7, -1], [
        cube([.5, 34.8, -1], [.8, 2.8, .8], 3, pivot=[.5, 35, -1], rotation=[0, 0, -18]),
        cube([1, 37.3, -1], [1.2, 1.3, .8], 3, pivot=[1, 37.3, -1], rotation=[0, 0, -40]),
        cube([.15, 38.3, -1], [1.4, .7, .8], 3),
        cube([-.75, 37.6, -1], [1.1, .7, .8], 4, pivot=[.2, 38.3, -1], rotation=[0, 0, 35]),
        cube([-1, 36.8, -1], [.6, 1, .7], 3)]))
    for side, label in ((-1, 'Right'), (1, 'Left')):
        # Whale pectoral fins: wide and low, with pale undersides; no cat ears.
        bones.append(bone(label + 'WhaleEar', 'Head', [side * 4.6, 30, .2], [
            cube([4.4 if side > 0 else -7.8, 29.5, -1], [3.4, 1.2, 3.2], 2,
                 pivot=[side * 4.6, 30, .2], rotation=[0, 0, -side * 15]),
            cube([6.5 if side > 0 else -8.7, 28.7, -.5], [2.2, .9, 2.5], 2,
                 pivot=[side * 4.6, 30, .2], rotation=[0, 0, -side * 12]),
            cube([5 if side > 0 else -7.8, 29.15, -1.06], [2.8, .4, 3.2], 8,
                 pivot=[side * 4.6, 30, .2], rotation=[0, 0, -side * 15])]))
        bones.append(bone(label + 'Hair', 'Head', [side * 4.4, 32, -1.4], [
            cube([4.2 if side > 0 else -5.6, 24.4, -3.4], [1.5, 8.7, 3.3], 3),
            cube([4.6 if side > 0 else -5.4, 24.8, -3.6], [.65, 6, .5], 4)]))
        bones.append(bone(label + 'HairTip', label + 'Hair', [side * 5, 24.5, -1.6], [
            cube([4.3 if side > 0 else -6.1, 17.5, -2.5], [1.8, 7.5, 3], 4,
                 pivot=[side * 5, 24.5, -1.6], rotation=[0, 0, side * -8]),
            cube([5 if side > 0 else -7.1, 15.4, -2], [2.1, 3, 2.7], 5,
                 pivot=[side * 5, 20, -1.6], rotation=[0, 0, side * -12])]))
        bowx = side * 4.8
        bones.append(bone(label + 'Ribbon', 'Head', [bowx, 29, -.2], [
            cube([bowx - 1.2, 28.7, -2.4], [1.2, 1.2, .7], 10, pivot=[bowx, 29, -2], rotation=[0, 0, -20]),
            cube([bowx, 28.7, -2.4], [1.2, 1.2, .7], 10, pivot=[bowx, 29, -2], rotation=[0, 0, 20]),
            cube([bowx - .35, 29, -2.7], [.7, .7, .8], 5)]))
    skirt = []
    for y, h, width, depth in ((5.6, 2.1, 14, 9.5), (7.7, 2.3, 13, 8.8), (10, 2.4, 11.2, 7.6), (12.4, 2.4, 9.2, 6.2)):
        skirt.append(cube([-width / 2, y, -depth / 2], [width, h, depth], 6 if y < 10 else 7))
    skirt.append(cube([-7.1, 4.8, -4.8], [14.2, 1, 9.6], 9))
    for x in range(-7, 7):
        skirt.append(cube([x, 4.5 + (x % 2) * .25, -4.95], [1.05, 1.1, .7], 8))
        skirt.append(cube([x, 4.5 + (x % 2) * .25, 4.25], [1.05, 1.1, .7], 8))
    for side in (-1, 1):
        for z in range(-4, 5):
            skirt.append(cube([side * 6.7 - .3, 4.65 + (z % 2) * .2, z], [.7, 1, 1.05], 8))
        for x in (4.4, 5.5):
            skirt.append(cube([side * x - .16, 6.1, -4.82], [.32, 1.3, .25], 11))
    # Four front panels make the white apron curve outward with the bell skirt.
    for y, h, width, z in ((12.6, 1.9, 5.6, -3.35), (10.1, 2.5, 6.9, -4.1), (7.8, 2.3, 8.1, -4.7), (6.7, 1.1, 7.4, -5)):
        skirt.append(cube([-width / 2, y, z], [width, h, .65], 8))
        for side in (-1, 1):
            skirt.append(cube([side * width / 2 - .35, y, z - .15], [.7, h, .7], 15))
    # A small blue whale emblem, drawn as blocks rather than a texture logo.
    skirt += [cube([-1.3, 7.2, -5.42], [2.6, .9, .22], 10),
              cube([1, 7.8, -5.42], [.7, .8, .22], 10),
              cube([-.85, 7.8, -5.44], [.35, .25, .24], 8)]
    bones.append(bone('Skirt', 'Body', [0, 15, 0], skirt))
    for side, label in ((-1, 'Right'), (1, 'Left')):
        x = side * 4.9
        bones += [bone(label + 'Arm', 'Body', [side * 3.7, 23.6, 0], [
            cube([x - 1.45, 19.7, -1.6], [2.9, 4.5, 3.2], 6),
            cube([x - 1.65, 21.8, -1.75], [3.3, 2, 3.5], 7),
            cube([x - 1.3, 19.2, -1.6], [2.6, .7, 3.2], 8)]),
            bone(label + 'ForeArm', label + 'Arm', [x, 19.3, 0], [
                cube([x - 1.1, 15.6, -1.3], [2.2, 3.7, 2.6], 6),
                cube([x - 1.3, 15.3, -1.5], [2.6, 1, 3], 8),
                cube([x - .95, 13.8, -1.2], [1.9, 1.8, 2.4], 0)]),
            bone(label + 'HandLocator', label + 'ForeArm', [x, 14.7, -.7]),
            bone(label + 'Leg', 'AllBody', [side * 1.9, 10, 0], [
                cube([side * 1.9 - 1.25, 1.8, -1.3], [2.5, 8.3, 2.6], 8),
                cube([side * 1.9 - 1.4, 0, -2], [2.8, 2.1, 4.1], 6),
                cube([side * 1.9 - 1.2, 1.7, -2.2], [2.4, .6, .5], 9)])]
    # Broad horizontal flukes distinguish a whale tail from a fish's vertical fin.
    bones += [bone('Tail', 'Body', [0, 12, 2], [cube([-1.3, 9.6, 2], [2.6, 2.9, 6.2], 3)]),
              bone('TailMid', 'Tail', [0, 11, 7], [cube([-1.05, 9, 7], [2.1, 2.5, 4.8], 3, pivot=[0, 10, 7], rotation=[-18, 0, 0])]),
              bone('TailEnd', 'TailMid', [0, 10.2, 11], [cube([-.85, 10, 10.5], [1.7, 2.1, 3.8], 4)])]
    for side, label in ((-1, 'Right'), (1, 'Left')):
        bones.append(bone(label + 'Fluke', 'TailEnd', [0, 11, 13], [
            cube([0 if side > 0 else -3.7, 10.4, 12.6], [3.7, 1.3, 3.1], 3,
                 pivot=[0, 11, 13], rotation=[0, -side * 16, side * 5]),
            cube([2.7 if side > 0 else -5.3, 10.5, 14.3], [2.6, 1, 2.1], 3,
                 pivot=[0, 11, 13], rotation=[0, -side * 18, side * 6]),
            cube([.4 if side > 0 else -3.6, 10.2, 12.9], [3.2, .3, 2.6], 9,
                 pivot=[0, 11, 13], rotation=[0, -side * 16, side * 5])]))
    bowl = [cube([-2.2, 17.5, -7.3], [4.4, .6, 4.4], 9),
            cube([-2.6, 18, -7.7], [5.2, 1.1, .5], 8),
            cube([-2.6, 18, -3.4], [5.2, 1.1, .5], 8),
            cube([-2.6, 18, -7.2], [.5, 1.1, 3.8], 8),
            cube([2.1, 18, -7.2], [.5, 1.1, 3.8], 8),
            cube([-2, 18.25, -7], [4, .75, 3.7], 15)]
    for x, z in ((-1.2, -6.2), (-.1, -5.8), (.9, -6.3), (-.8, -4.6), (.7, -4.7)):
        bowl.append(cube([x, 18.95, z], [.75, .45, .6], 8))
    bones.append(bone('RiceBowl', 'Body', [0, 18, -5], bowl))
    return geometry(bones, 'whale_maid')


def arm_model():
    bones = []
    for side, label in ((-1, 'Right'), (1, 'Left')):
        x = side * 3
        bones += [bone(label + 'Arm', None, [x, 24, 0], [cube([x - 1.5, 18, -1.5], [3, 6, 3], 6)]),
                  bone(label + 'ForeArm', label + 'Arm', [x, 18, 0], [
                      cube([x - 1.2, 13, -1.3], [2.4, 5, 2.6], 6),
                      cube([x - 1.5, 12.6, -1.5], [3, 1.2, 3], 8),
                      cube([x - 1.1, 10.8, -1.2], [2.2, 2, 2.4], 0)]),
                  bone(label + 'HandLocator', label + 'ForeArm', [x, 11.8, -.6])]
    return geometry(bones, 'whale_maid_arm')


def animations():
    from build import arm_animations
    def gait(length, leg=18, arm=12, tail=7):
        return loop(length, {'AllBody': {'position': wave(1, .12, length)},
            'LeftLeg': {'rotation': wave(0, leg, length)}, 'RightLeg': {'rotation': wave(0, -leg, length)},
            'LeftArm': {'rotation': wave(0, -arm, length)}, 'RightArm': {'rotation': wave(0, arm, length)},
            'Tail': {'rotation': wave(1, tail, length)}, 'TailMid': {'rotation': wave(1, tail * -.65, length)},
            'HairBackTip': {'rotation': wave(0, 3, length)}, 'LeftHairTip': {'rotation': wave(2, 3, length)},
            'RightHairTip': {'rotation': wave(2, -3, length)}, 'Skirt': {'rotation': wave(2, 1.3, length)}})
    clips = {'idle': loop(3, {'AllBody': {'position': wave(1, .07, 3)}, 'Tail': {'rotation': wave(1, 4, 3)},
             'TailMid': {'rotation': wave(1, -3, 3)}, 'Ahoge': {'rotation': wave(2, 4, 3)},
             'LeftHairTip': {'rotation': wave(2, 1.5, 3)}, 'RightHairTip': {'rotation': wave(2, -1.5, 3)}}),
             'walk': gait(.9), 'run': gait(.55, 30, 22, 12), 'sneak': gait(1.3, 9, 6, 5),
             'swim': gait(.8, 16, 35, 20), 'swim_stand': gait(1.6, 5, 8, 6),
             'jump': loop(1, {'LeftArm': {'rotation': [-12, 0, -12]}, 'RightArm': {'rotation': [-12, 0, 12]},
                             'LeftLeg': {'rotation': [-15, 0, 0]}, 'RightLeg': {'rotation': [12, 0, 0]},
                             'HairBackTip': {'rotation': [-8, 0, 0]}, 'Tail': {'rotation': wave(1, 12)}}),
             'sneaking': loop(2, {'AllBody': {'position': [0, -1, 0], 'rotation': [8, 0, 0]}, 'Skirt': {'rotation': [-8, 0, 0]}}),
             'attacked': {'animation_length': .35, 'bones': {'AllBody': {'rotation': {'0': [0, 0, -6], '0.15': [0, 0, 5], '0.35': [0, 0, 0]}}}},
             'sit': loop(2, {'LeftLeg': {'rotation': [-70, 0, 0]}, 'RightLeg': {'rotation': [-70, 0, 0]}, 'Skirt': {'rotation': [-8, 0, 0]}}),
             'sleep': loop(3, {'Tail': {'rotation': wave(1, 2, 3)}}), 'empty': loop(1, {})}
    for name in ('fly', 'elytra_fly', 'climbing', 'boat', 'ride', 'ride_pig', 'riptide'):
        clips[name] = deepcopy(clips['jump'] if name in ('fly', 'elytra_fly', 'riptide') else clips['sit'])
    clips['death'] = {'animation_length': 1, 'bones': {'AllBody': {'rotation': {'0': [0, 0, 0], '1': [0, 0, 80]}}}}
    arm = arm_animations()
    clips['swing_hand'] = deepcopy(arm['animations']['swing'])
    clips['swing_offhand'] = deepcopy(arm['animations']['swing_offhand'])
    for clip in clips.values():
        clip.setdefault('bones', {})['RiceBowl'] = {'scale': [0, 0, 0]}
    extra = {'format_version': '1.8.0', 'animations': {
        'extra1': {'animation_length': 2, 'bones': {'RightArm': {'rotation': [-145, 0, 20]}, 'RightForeArm': {'rotation': wave(2, 18, .5)}}},
        'extra2': {'animation_length': 2.4, 'bones': {'LeftArm': {'rotation': [-65, 0, -20]}, 'RightArm': {'rotation': [-65, 0, 20]},
                   'Tail': {'rotation': wave(1, 20, .6)}, 'AllBody': {'position': wave(1, .25, 1.2)}, 'RiceBowl': {'scale': [1, 1, 1]}}},
        'extra3': {'animation_length': 1.5, 'bones': {'AllBody': {'rotation': {'0': [0, 0, 0], '0.6': [22, 0, 0], '0.9': [22, 0, 0], '1.5': [0, 0, 0]}},
                   'HairBackTip': {'rotation': {'0': [0, 0, 0], '0.6': [-10, 0, 0], '1.5': [0, 0, 0]}}}}}}
    return {'format_version': '1.8.0', 'animations': clips}, arm, extra


def build_files():
    main, arm, extra = animations()
    spec = {'spec': 2, 'metadata': {'name': '大肥鱼 · 蓝发鲸鱼娘 · ' + VERSION,
        'tips': '蓝发鲸鱼娘 / 鲸鳍耳 / 卷翘呆毛 / 蓝白女仆裙 / 水平鲸尾。人物设定二创；新建几何、贴图、动作。',
        'authors': [{'name': '上善无形', 'role': '角色原型「溟月」'}, {'name': 'ZipZipPipe', 'role': '女仆鲸鱼娘形象参考'},
                    {'name': 'jcs130 / Codex', 'role': '本次方块模型、像素贴图和动作重建'}],
        'license': {'type': 'Custom', 'desc': '角色形象权利归原作者；非商用二创，保留署名。未复制或转换 ccci202 的加密模型。'},
        'link': {'home': 'https://www.bilibili.com/opus/1231977657712771073'}},
        'properties': {'height_scale': .88, 'width_scale': .92, 'free': True, 'default_texture': 'pearl', 'preview_animation': 'idle',
            'extra_animation': {'extra1': '鲸鱼娘招手', 'extra2': '开饭啦', 'extra3': '礼貌鞠躬'}},
        'files': {'player': {'model': {'main': 'models/main.json', 'arm': 'models/arm.json'},
            'animation': {'main': 'animations/main.animation.json', 'arm': 'animations/arm.animation.json', 'extra': 'animations/extra.animation.json'},
            'texture': [f'textures/{name}.png' for name in VARIANTS]}}}
    credits = ('Whale-maid character reference: Mingyue by 上善无形; maid adaptation by ZipZipPipe.\n'
               'New block mesh, painted atlas and animation: jcs130 / Codex, 2026-10-28.\n'
               'Character fan work, non-commercial, retain attribution and original character rights.\n'
               'No encrypted YSM, third-party geometry or source-image pixels used.\n')
    files = {'ysm.json': encoded(spec), 'models/main.json': encoded(main_model()), 'models/arm.json': encoded(arm_model()),
             'animations/main.animation.json': encoded(main), 'animations/arm.animation.json': encoded(arm),
             'animations/extra.animation.json': encoded(extra), 'CREDITS.txt': credits.encode()}
    files.update({f'textures/{name}.png': atlas(overrides) for name, overrides in VARIANTS.items()})
    return files


def build(output):
    files = build_files()
    report = validate(files)
    report.update(version=VERSION, character='DeepSeek whale-maid fan model',
                  visualReferences=['https://www.bilibili.com/opus/1231977657712771073',
                                    'https://tech.ifeng.com/c/8xSXpkNB7YG'])
    output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        path = output / MODEL_ID / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    with zipfile.ZipFile(output / f'{MODEL_ID}-{VERSION}.zip', 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(MODEL_ID + '/' + name, (2026, 10, 28, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    (output / 'manifest.json').write_bytes(encoded(report))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    print(json.dumps(build(parser.parse_args().output), ensure_ascii=False))
