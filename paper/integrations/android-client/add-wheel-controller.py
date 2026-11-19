"""Build the Control Flex spell preset and the native FCL import from its released base."""
import argparse
import io
import json
from pathlib import Path
from zipfile import ZipFile

from build import archive, digest, encoded, text_input

BASE_VERSION = '1.0.0-preview.6'
BASE_HASH = 'e2ae327f1c219b4782119fdf4f3857a842adecb9714fc6161116bbe3be7db84b'
VERSION = '1.0.0-preview.6-wheel.1'
PROFILE = 'qiandeng_spells'
ACTION = 'qiandeng_controls:key.qiandeng_controls.wheel'
WHEEL_JAR = 'mods/qiandeng-controls-0.1.2.jar'
WHEEL_HASH = '13d33c6fe65974a5b7b52db977c044711cb18737f84abbc34704c1ec9fdc1420'
CFG = 'config/controlflex/'
GUIDE = """## Xbox 手柄施法

长按 Xbox 左侧的 View 键（两个小方框）打开千灯纪施法轮盘。打开后可以松开 View。
向目标技能推右摇杆，看到技能名后按 A 确认；B 返回。左摇杆可移动光标到下方的「配置轮盘」。
在配置页选槽位和技能，服务器会按你的角色保存。传送等需要目标的技能会继续询问。
Control Flex 设置侧栏的 ◀ / ▶ 可切换「千灯纪·施法」和原有 Recommend 等模板。
"""


def preset_files(recommended):
    template = json.loads(recommended)
    bindings = template['mainActionBindings']
    previous = 'controlflex:key.controlflex.open_radial_menu_1'
    if bindings.get(previous) != 'buttonBack|HOLD' or ACTION in bindings:
        raise ValueError('Unexpected upstream View binding')
    bindings[previous] = ''
    bindings[ACTION] = 'buttonBack|HOLD'
    template['templateMeta'].update(name=PROFILE, displayName='千灯纪·施法',
                                    description='View 打开个人施法轮盘，右摇杆选择，A 确认，B 返回。')
    # Control Flex enumerates templates/. The player's editable profile is created by
    # Control Flex on selection. Drop-in upgrades must never replace profiles/ or cfx-client.json.
    return {
        CFG + 'templates/' + PROFILE + '.json': encoded(template),
        CFG + 'compat/mods/qiandeng_controls.json': text_input('spell-wheel-controller.json'),
    }


def build(base):
    original = base.read_bytes()
    if digest(original) != BASE_HASH:
        raise ValueError('Expected the published Android native preview.6 pack')
    with ZipFile(io.BytesIO(original)) as z:
        entries = {name: z.read(name) for name in z.namelist()}
    index_key = 'modrinth.index.json'
    manifest_key = 'overrides/qiandengji-android-manifest.json'
    index = json.loads(entries[index_key])
    manifest = json.loads(entries[manifest_key])
    if index['versionId'] != BASE_VERSION or manifest['version'] != BASE_VERSION:
        raise ValueError('Unexpected Android client version')
    if digest(entries['overrides/' + WHEEL_JAR]) != WHEEL_HASH:
        raise ValueError('This preset targets the published QDJ wheel 0.1.2')
    added = preset_files(entries['overrides/' + CFG + 'profiles/recommend.json'])
    for key, data in {**added, CFG + 'cfx-client.json': encoded({'profile': PROFILE})}.items():
        if 'overrides/' + key in entries:
            raise ValueError('Cannot replace an existing configuration: ' + key)
        entries['overrides/' + key] = data
    index['versionId'] = manifest['version'] = VERSION
    index['name'] = '千灯纪 · FCL 手柄施法'
    index['summary'] += ' 含 Xbox View 键个人施法轮盘。'
    manifest['spellWheelController'] = {'profile': PROFILE, 'confirm': 'buttonA',
                                         'open': 'buttonBack|HOLD', 'select': 'rightStick',
                                         'androidDeviceVerified': False}
    entries[index_key] = encoded(index)
    entries[manifest_key] = encoded(manifest)
    entries['overrides/README-Qiandengji-Android.md'] += ('\n' + GUIDE).encode()
    items = {
        'qiandengji-android-1.21.1-neoforge-' + VERSION + '.mrpack': archive(entries),
        'qiandengji-fcl-spell-wheel-1.zip': archive({
            **added,
            'LICENSES/ControlFlex-MIT.txt': entries['overrides/LICENSES/ControlFlex-0.8.9-beta.3-MIT.txt'],
            'README.txt': ('退出游戏，把 config 文件夹合并到现有安卓原生手柄版游戏实例的目录。'
                           '重开游戏，在 Control Flex 设置侧栏用 ◀ / ▶ 选择「千灯纪·施法」。\n\n' + GUIDE).encode(),
        }),
    }
    return items


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in build(args.base).items():
        path = args.output / name
        if path.exists() and path.read_bytes() != data:
            raise ValueError('Output already exists with different content: ' + name)
        path.write_bytes(data)
        print(name, len(data), digest(data))
