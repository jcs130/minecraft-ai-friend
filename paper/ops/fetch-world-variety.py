"""Fetch pinned official inputs; build private packs without changing a server.

Third-party archives and converted outputs must stay outside the Git checkout.
The deployment helper has separate stopped-server and backup gates.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys
from urllib.request import Request, urlopen


def fetch(row, root):
    url = row['artifact']
    if not url.startswith(('https://cdn.modrinth.com/', 'https://maven.citizensnpcs.co/')):
        raise ValueError('Only reviewed official artifact hosts are allowed')
    extension = '.jar' if url.lower().endswith('.jar') else '.zip'
    target = root / (row['slug'] + '-' + row['sha256'][:16] + extension)
    if not target.exists():
        temporary = target.with_suffix(target.suffix + '.part')
        request = Request(url, headers={'User-Agent': 'Qiandengji-world-variety/1.0'})
        with urlopen(request, timeout=90) as response, temporary.open('xb') as out:
            while data := response.read(1024 * 1024):
                out.write(data)
        verify(temporary, row)
        temporary.rename(target)
    verify(target, row)
    return target


def verify(path, row):
    raw = path.read_bytes()
    for algorithm, expected in [('sha256', row['sha256']),
                                ('sha512', row.get('artifactSha512', row.get('sha512')))]:
        if expected and hashlib.new(algorithm, raw).hexdigest() != expected:
            raise ValueError('Artifact digest mismatch: ' + path.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--block-states', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    for path in (args.downloads, args.output):
        if path.resolve().is_relative_to(repo):
            raise ValueError('Third-party artifacts must remain outside this repository')
    if args.output.exists():
        raise ValueError('Output directory must be new')
    args.downloads.mkdir(parents=True, exist_ok=True)
    content = Path(__file__).parents[1] / 'content/world-variety'
    manifest = json.loads((content / 'packs.lock.json').read_text(encoding='utf-8'))
    for row in manifest['packs']:
        row['local'] = str(fetch(row, args.downloads))
        print('Verified ' + row['slug'], flush=True)
    for row in json.loads((content / 'plugins.lock.json').read_text())['plugins']:
        fetch(row, args.downloads)
        print('Verified ' + row['slug'], flush=True)
    resolved = args.downloads / 'resolved-packs.json'
    resolved.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    subprocess.run([sys.executable, str(Path(__file__).with_name('build-world-variety-packs.py')),
                    str(resolved), str(args.output), '--block-states', str(args.block_states)], check=True)


if __name__ == '__main__':
    main()
