"""Build a pinned native Java TEST client. Never edits or deploys a server."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import unquote, urlsplit
import zipfile

PROJECTS = {
    'twilightforest', 'lootr', 'yes-steve-model', 'touhou-little-maid',
    'better-combat', 'cloth-config', 'playeranimator',
}
HOSTS = {'cdn.modrinth.com', 'mediafilez.forgecdn.net'}


def validate_lock(lock):
    if lock.get('schemaVersion') != 1 or lock.get('minecraft') != '1.21.1':
        raise ValueError('Expected schemaVersion 1 / Minecraft 1.21.1')
    if lock.get('loader') != 'neoforge' or lock.get('clientLoaderVersion') != '21.1.248':
        raise ValueError('Only the actually tested NeoForge client profile is allowed')
    if lock.get('deployment') != 'isolated_only':
        raise ValueError('This builder produces an isolated candidate, never a production release')
    artifacts = lock.get('artifacts', [])
    if len(artifacts) != len(PROJECTS) or {a.get('project') for a in artifacts} != PROJECTS:
        raise ValueError('Expected exactly the seven reviewed upstream client artifacts')
    filenames = set()
    for artifact in artifacts:
        name = artifact['filename']
        if (PurePosixPath(name).name != name or '\\' in name or ':' in name
                or not name.endswith('.jar') or name in filenames):
            raise ValueError('Invalid or duplicate artifact filename')
        filenames.add(name)
        for algorithm, length in [('sha256', 64), ('sha512', 128)]:
            if not re.fullmatch('[0-9a-f]{' + str(length) + '}', artifact.get(algorithm, '')):
                raise ValueError('Missing fixed artifact digest: ' + algorithm)
        if not isinstance(artifact.get('bytes'), int) or artifact['bytes'] <= 0:
            raise ValueError('Artifact byte count required')
        url = urlsplit(artifact['url'])
        if (url.scheme != 'https' or url.hostname not in HOSTS or url.query or url.fragment
                or url.username or url.password or unquote(url.path.rsplit('/', 1)[-1]) != name):
            raise ValueError('Artifact must use its public official, credential-free download URL')
    return artifacts


def build(lock, cache, output):
    artifacts = validate_lock(lock)
    cache, output = Path(cache).resolve(), Path(output).resolve()
    if output.exists():
        raise FileExistsError('Candidate already exists; never overwrite an earlier result')
    files = []
    for artifact in artifacts:
        path = cache / artifact['filename']
        data = path.read_bytes()
        if len(data) != artifact['bytes']:
            raise ValueError('Artifact size mismatch: ' + path.name)
        for algorithm in ['sha256', 'sha512']:
            if hashlib.new(algorithm, data).hexdigest() != artifact[algorithm]:
                raise ValueError('Artifact hash mismatch: ' + path.name)
        if not zipfile.is_zipfile(path):
            raise ValueError('Artifact is not a JAR: ' + path.name)
        with zipfile.ZipFile(path) as jar:
            if 'META-INF/neoforge.mods.toml' not in jar.namelist():
                raise ValueError('Expected original NeoForge mod metadata: ' + path.name)
        files.append(dict(path='mods/' + path.name,
            hashes=dict(sha512=artifact['sha512'], sha1=hashlib.sha1(data).hexdigest()),
            env=dict(client='required', server='unsupported'),
            downloads=[artifact['url']], fileSize=len(data)))
    index = dict(formatVersion=1, game='minecraft', versionId='0.1.0-isolated-20261031',
        name='千灯纪 · 原生冒险兼容测试',
        summary='隔离测试候选；正式服及基岩/Mineflayer兼容尚未发布', files=files,
        dependencies=dict(minecraft='1.21.1', neoforge=lock['clientLoaderVersion']))
    instructions = '''千灯纪 · 原生冒险兼容测试

这是独立 Java 客户端候选，不是官网正式客户端。请导入启动器的新实例。
Minecraft 1.21.1 / NeoForge 21.1.248；通过自动下载取得七个原作者模组。
包含暮色森林、Lootr、YSM 2.6.5、女仆 1.5.3、Better Combat 2.4.0 及两项依赖。
playerAnimator 2.0.4 在上游标为 Beta；本清单保留其真实发布类型。

本包不包含账号、模型 Key、世界、人物模型、QA 插件或服务端改版 JAR。
仅连接运营者明确给出的隔离测试入口；当前没有为本候选开放新的公网端口。
正式千灯纪仍沿用原客户端、认证和模型分发。基岩与普通 Mineflayer 尚未通过本候选验收。
Lootr 在新维度的转换一旦发生，不能直接卸载并假定所有宝箱仍在。

原作者与来源：
暮色森林 TeamTwilight: https://www.curseforge.com/minecraft/mc-mods/the-twilight-forest
Lootr Noobanidus: https://modrinth.com/mod/lootr
YSM YS Group: https://modrinth.com/mod/yes-steve-model
车万女仆 TartaricAcid: https://modrinth.com/mod/touhou-little-maid
Better Combat Daedelus: https://modrinth.com/mod/better-combat
Cloth Config shedaniel: https://modrinth.com/mod/cloth-config
playerAnimator KosmX: https://modrinth.com/mod/playeranimator
资源及代码的许可分别以原作者发行文件为准。本包只引用公开的原始下载。
'''
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in [('modrinth.index.json', json.dumps(index, ensure_ascii=False, indent=2)),
                           ('overrides/原生冒险测试说明.txt', instructions)]:
            entry = zipfile.ZipInfo(name, (2026, 10, 31, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data.encode('utf-8'))
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return dict(filename=output.name, sha256=digest, bytes=output.stat().st_size,
        artifacts=len(files), deployment='isolated_only', productionModified=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock', type=Path, default=Path(__file__).with_name('artifacts.lock.json'))
    parser.add_argument('--downloads', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(json.loads(args.lock.read_text(encoding='utf-8')), args.downloads, args.output), ensure_ascii=False))
