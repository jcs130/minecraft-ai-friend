"""Build the NAS-only Villager News compatibility artifact; does not install it or restart services."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from patch_villager_news_settlements import prepare, NEWS_SHA, SETTLEMENTS_SHA

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / 'world/villager-news-compat-src/cn/blockforge/generated/villagernews/SettlementsCompat$SettlementsBackpackView.java'


def build(news: Path, settlements: Path, libraries: Path, output: Path, javac: Path):
    if not libraries.is_dir() or not javac.is_file() or output.exists():
        raise ValueError('Use installed server libraries, Java 21 javac, and a fresh private artifact path')
    if hashlib.sha256(news.read_bytes()).hexdigest() != NEWS_SHA or hashlib.sha256(settlements.read_bytes()).hexdigest() != SETTLEMENTS_SHA:
        raise ValueError('Unsupported input bytes; re-audit this release before compiling')
    spec = importlib.util.spec_from_file_location('owned_botgate_builder', REPO / 'world/botgate-src/build.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    classpath = builder.full_cp(libraries.resolve()) + ';' + str(settlements.resolve())
    with TemporaryDirectory(prefix='maw-news-compat-') as temporary:
        classes = Path(temporary) / 'classes'
        classes.mkdir()
        subprocess.run([str(javac), '--release', '21', '-proc:none', '-encoding', 'UTF-8', '-cp', classpath,
                        '-d', str(classes), str(SOURCE)], check=True)
        compiled = classes / 'cn/blockforge/generated/villagernews/SettlementsCompat$SettlementsBackpackView.class'
        result = prepare(news, settlements, output, compiled)
    result['containerSourceSha256'] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    result['compilerRelease'] = 21
    output.with_suffix('.build.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['news', 'settlements', 'libraries', 'output', 'javac']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.news, args.settlements, args.libraries, args.output, args.javac), indent=2))
