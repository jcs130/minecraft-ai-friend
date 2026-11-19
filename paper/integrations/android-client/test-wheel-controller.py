"""Verify the real released FCL pack and its optional, non-destructive preset overlay."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
import math
from pathlib import Path
from zipfile import ZipFile

spec = spec_from_file_location('wheel_controller', Path(__file__).with_name('add-wheel-controller.py'))
wheel = module_from_spec(spec)
spec.loader.exec_module(wheel)


def unpack(data):
    with ZipFile(io.BytesIO(data)) as z:
        assert len(z.namelist()) == len(set(z.namelist()))
        return {name: z.read(name) for name in z.namelist()}


def verify(base):
    files = wheel.build(base)
    assert files == wheel.build(base), 'build should be deterministic'
    assert {name: wheel.digest(data) for name, data in files.items()} == {
        'qiandengji-fcl-spell-wheel-1.zip': '0e8bfc02d4a6982efd6dcb92d7417057616efdb396d9ffb4bc02b614071c2acc',
        'qiandengji-android-1.21.1-neoforge-1.0.0-preview.6-wheel.1.mrpack':
            'bb6194dcf9721b17a1bab59b9688e414b6bc541d8efce75c7ceacf2bc4cd54c9',
    }, 'released downloads should be reproducible across OS line endings'
    pack = unpack(next(data for name, data in files.items() if name.endswith('.mrpack')))
    addon = unpack(files['qiandengji-fcl-spell-wheel-1.zip'])
    original = unpack(base.read_bytes())
    cfg = wheel.CFG
    preset = cfg + 'templates/' + wheel.PROFILE + '.json'
    compat = cfg + 'compat/mods/qiandeng_controls.json'
    assert set(addon) == {preset, compat, 'README.txt', 'LICENSES/ControlFlex-MIT.txt'}
    assert not any(key in original for key in ('overrides/' + preset, 'overrides/' + compat))
    assert all(addon[key] == pack['overrides/' + key] for key in (preset, compat))
    legacy = json.loads(original['overrides/' + cfg + 'profiles/recommend.json'])
    selected = json.loads(addon[preset])
    assert selected['templateMeta']['name'] == wheel.PROFILE
    game = selected['mainActionBindings']
    assert game[wheel.ACTION] == 'buttonBack|HOLD'
    assert game['controlflex:key.controlflex.open_radial_menu_1'] == ''
    assert [key for key, val in game.items() if val == 'buttonBack|HOLD'] == [wheel.ACTION]
    assert game['voicechat:key.push_to_talk'] == legacy['mainActionBindings']['voicechat:key.push_to_talk']
    assert selected['guiActionBindings'] == legacy['guiActionBindings']
    assert selected['guiActionBindings']['gui_press'] == 'buttonA|PRESS'
    assert selected['guiActionBindings']['gui_back'] == 'buttonB|PRESS'
    rule, = json.loads(addon[compat])['mod_versions']
    assert rule['version'] == '0.1.2'
    assert rule['inGameKeys'] == {'key.qiandeng_controls.wheel': {'channels': ['keyMapping']}}
    assert set(rule['screen']) == {'dev.qiandeng.controls.SpellWheelScreen'}
    for size in (240, 270, 360, 440, 720):
        radius = max(50, min(120, (size - 92) // 2))
        target = rule['screen']['dev.qiandeng.controls.SpellWheelScreen']['rightStick']['cursorRadius']
        for index in range(8):
            angle = index * math.pi / 4
            dx, dy = target * math.sin(angle), 6 - target * math.cos(angle)
            assert radius * .54 <= math.hypot(dx, dy) <= radius + 23
            assert math.floor((math.atan2(dy, dx) + math.pi / 2) / (math.pi / 4) + .5) % 8 == index
    modified = {name for name in original if original[name] != pack.get(name)}
    assert modified == {'modrinth.index.json', 'overrides/qiandengji-android-manifest.json',
                        'overrides/README-Qiandengji-Android.md'}
    assert json.loads(pack['modrinth.index.json'])['files'] == json.loads(original['modrinth.index.json'])['files']
    assert set(pack) - set(original) == {'overrides/' + key for key in (preset, compat, cfg + 'cfx-client.json')}
    assert json.loads(pack['overrides/' + cfg + 'cfx-client.json']) == {'profile': wheel.PROFILE}
    print('Verified eight directions, confirm/cancel, preserved profiles and mods, and both real archives.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('released_base', type=Path)
    verify(parser.parse_args().released_base)
