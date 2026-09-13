"""Package the two locked client JARs needed for the missing staff registry fix.

Does not install anything or change either side's mods, saves or configuration.
The complete current mrpack remains the preferred update for older releases.
"""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ('qiandeng-chanting-0.1.0.jar', 'voicechat-neoforge-1.21.1-2.6.22.jar')
README = '''千灯纪：法杖注册表错误补丁

适用：Minecraft Java 1.21.1，NeoForge 21.1.248，已有千灯纪整合客户端。
修复：qiandeng_chanting:whispering_staff / resonance_staff 未知注册表。

1. 完整退出 Minecraft，不是仅断开服务器。
2. 在启动器中选中实际报错的实例，打开该实例的游戏文件夹。
3. 备份其中 mods 内旧的 qiandeng-chanting 和 voicechat JAR 到 mods 之外。
   同一模组不要同时保留多个版本。其他模组不动。
4. 把本补丁 mods 文件夹内的两个 JAR 放入这个实例的 mods 文件夹。
5. 完整重启该实例，仍使用原来的玩家昵称，连接 192.168.3.133。

voicechat 需要精确版本 1.21.1-2.6.22，故与法杖一起提供。
本补丁只补齐法杖及其强制依赖，不能把原 Rapid Optimization 底包变成完整千灯纪。
若使用旧 0.1.0～0.1.4，推荐直接导入新的 QiandengJi-1.21.1-0.1.5-local.mrpack，
以同步神谕语音、人物桥接等其余组件。不要把 .mrpack 文件当 JAR 放到 mods 中。
本补丁没有账号、存档、启动器配置或服务端专用模组。
'''


def main():
    lock = json.loads((ROOT / 'manifests/client.lock.json').read_text('utf8'))
    expected = {row['path']: row['sha256'] for row in lock['files']}
    payloads = {}
    for name in FILES:
        relative = 'mods/' + name
        data = (ROOT / 'client' / relative).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != expected[relative]:
            raise ValueError('Client JAR differs from locked build: ' + name)
        # Both components must match the running server's installed files too.
        if (ROOT / 'server/mc' / relative).read_bytes() != data:
            raise ValueError('Client/server mismatch: ' + name)
        payloads[relative] = data
    manifest = {'schema': 1, 'minecraft': '1.21.1', 'neoforge': '21.1.248',
                'files': [{'path': name, 'sha256': hashlib.sha256(data).hexdigest(),
                           'bytes': len(data)} for name, data in payloads.items()]}
    output = ROOT / 'dist/QiandengJi-chanting-fix-1.21.1-20260913.zip'
    if output.exists():
        raise FileExistsError('Keep existing artifacts immutable; choose a new release name')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in payloads.items():
            archive.writestr(name, data)
        archive.writestr('安装说明.txt', README.encode('utf-8-sig'))
        archive.writestr('patch-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None or any(archive.read(name) != data for name, data in payloads.items()):
            raise ValueError('Exported patch verification failed')
    print(json.dumps({'artifact': str(output), 'bytes': output.stat().st_size,
                      'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                      'verifiedAgainstClientAndServer': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
