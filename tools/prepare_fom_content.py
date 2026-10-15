"""Prepare a new, verified FOM content overlay; never edit an installed game."""
from pathlib import Path
import argparse, hashlib, json, shutil, zipfile, tomllib

LOCK = Path(__file__).resolve().parents[1] / 'docs/fom-content-20261015.lock.json'
DATA_PACK = Path(__file__).resolve().parents[1] / 'world/fom-content-data'

def prepare(downloads, output, lock=LOCK):
    downloads, output = Path(downloads).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError('Use a new overlay directory; installed games are never modified')
    record = json.loads(Path(lock).read_text('utf-8'))
    if record.get('schemaVersion') != 1 or record.get('minecraft') != '1.21.1':
        raise ValueError('Unsupported content lock')
    rows = record['mods']; names = set(); mods = set()
    for row in rows:
        name = row['file']
        if not name.endswith('.jar') or '/' in name or '\\' in name or ':' in name or name in names:
            raise ValueError('Invalid or duplicate JAR filename')
        names.add(name)
        source = downloads / name
        if source.is_symlink() or not source.is_file():
            raise ValueError('Expected local downloaded JAR: ' + name)
        raw = source.read_bytes()
        if any(hashlib.new(kind, raw).hexdigest() != row[kind] for kind in ('sha256', 'sha512')):
            raise ValueError('Downloaded bytes differ from official lock: ' + name)
        with zipfile.ZipFile(source) as jar:
            metadata = next((key for key in ('META-INF/neoforge.mods.toml', 'META-INF/mods.toml') if key in jar.namelist()), None)
            if metadata is None:
                raise ValueError('Missing NeoForge metadata: ' + name)
            ids = {m['modId'] for m in tomllib.loads(jar.read(metadata).decode('utf-8-sig'))['mods']}
        if ids != set(row['modIds']) or mods.intersection(ids):
            raise ValueError('Mismatched or duplicate native mod identity: ' + name)
        mods.update(ids)
    pack_files = record.get('serverDataPackFiles', {})
    for relative, digest in pack_files.items():
        if not isinstance(relative, str) or Path(relative).is_absolute() or '\\' in relative or ':' in relative or '..' in Path(relative).parts:
            raise ValueError('Invalid server data pack file')
        source = (DATA_PACK / relative).resolve()
        if not source.is_relative_to(DATA_PACK.resolve()) or not source.is_file() or source.is_symlink():
            raise ValueError('Invalid server data pack file')
        # Git may check text resources out as CRLF on Windows. Lock and emit
        # their canonical LF bytes so a fresh checkout reproduces the pack.
        if hashlib.sha256(source.read_bytes().replace(b'\r\n', b'\n')).hexdigest() != digest:
            raise ValueError('Server data pack differs from content lock')
    # Validate every input before creating output. This directory is an overlay,
    # not a complete pack or a server deployment. No network or game action.
    output.mkdir(parents=True)
    (output / 'mods').mkdir()
    for row in rows:
        target = output / 'mods' / row['file']
        shutil.copy2(downloads / row['file'], target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Copied overlay bytes differ: ' + row['file'])
    for relative in pack_files:
        target = output / 'server-only/datapacks/qdfom_content_compat' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((DATA_PACK / relative).read_bytes().replace(b'\r\n', b'\n'))
    (output / 'content.lock.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'README.txt').write_text(
        'FOM 2.42 / Minecraft 1.21.1 / NeoForge 21.1.248 内容增量包。\n'
        '此为增量包，不是完整整合包；请对照服务端发布说明安装。\n'
        '客户端和服务端都增加这六个 JAR；保留原包及已有 Curios 9.5.1。\n'
        'server-only/datapacks 中的兼容数据包仅放服务端 world/datapacks。\n'
        '部署前正常退出游戏/服务器并完成世界、认证库、配置、原 mods 冷备。\n'
        '新增模组后重新导出注册表并构建网关；不可沿用旧数字映射。\n'
        'playerAnimator 官方将此兼容版本标为 beta。原作者许可见锁文件。\n'
        '不要把第三方 JAR、世界、账号资料或密钥提交到公共仓库。\n', encoding='utf-8-sig')
    return {'schemaVersion': 1, 'output': str(output), 'jarCount': len(rows), 'installedGameChanged': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--lock', type=Path, default=LOCK)
    args = parser.parse_args()
    print(json.dumps(prepare(args.downloads, args.output, args.lock), ensure_ascii=False))
