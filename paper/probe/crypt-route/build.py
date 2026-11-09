"""Build the console-only geometry fixture; never install or start a server."""
import argparse
from pathlib import Path
import subprocess
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--classpath-file', type=Path, required=True,
                        help='UTF-8 file containing one native Java classpath line (API, ProtocolLib, Gson)')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--javac', default='javac')
    args = parser.parse_args()
    stage = args.stage.resolve()
    assert (stage / '.shop-qa').read_text() == 'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA'
    output = args.output.resolve()
    assert not output.exists(), 'Preserve prior build evidence'
    assert not output.is_relative_to(stage / 'plugins'), 'No automatic fixture installation'
    classes = output.with_suffix('.classes')
    classes.mkdir()
    classpath = args.classpath_file.read_text(encoding='utf-8-sig').strip()
    assert classpath and '\n' not in classpath and '\r' not in classpath
    subprocess.run([
        args.javac, '-proc:none', '--release', '21', '-encoding', 'UTF-8',
        '-cp', classpath, '-d', str(classes),
        str(Path(__file__).with_name('CryptRouteFixture.java')),
    ], check=True)
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as jar:
        for item in sorted(classes.rglob('*.class')):
            jar.write(item, item.relative_to(classes).as_posix())
        jar.writestr('plugin.yml',
            'name: CryptRouteQA\nversion: 1\n'
            'main: org.qiandengji.cryptqa.CryptRouteFixture\n'
            'api-version: "1.21.1"\ndepend: [ProtocolLib]\n'
            'commands:\n  qdcrypt:\n    description: Marked synthetic geometry movement audit\n')
    print(output.name)


if __name__ == '__main__':
    main()
