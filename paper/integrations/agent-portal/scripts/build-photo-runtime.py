"""Apply only the photo delta to a verified, separately deployed server source."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--base', type=Path, required=True)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--active', type=Path, required=True)
parser.add_argument('--active-sha256', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert hashlib.sha256(args.active.read_bytes()).hexdigest() == args.active_sha256
assert not args.output.exists(), 'Use a fresh frozen runtime output'
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='photo-runtime-', dir=args.output.parent) as directory:
    assert Path(directory).resolve().is_relative_to(args.output.parent.resolve())
    inputs = []
    for name, file in [('source', args.source), ('base', args.base), ('active', args.active)]:
        path = Path(directory) / (name + '.mjs')
        path.write_bytes(file.read_bytes().replace(b'\r\n', b'\n'))
        inputs.append(path)
    merged = subprocess.run(['git', 'merge-file', '-p', *map(str, inputs)], capture_output=True)
    assert merged.returncode in [0, 1], 'Inspect merge failure'
    result = merged.stdout.decode('utf-8')
    if merged.returncode:
        assert result.count('<<<<<<< ') == result.count('=======\n') == result.count('>>>>>>> ') == 1, 'Review overlapping production changes'
        start = result.index('<<<<<<< ')
        first = result.index('\n', start) + 1
        middle = result.index('=======\n', first)
        end = result.index('>>>>>>> ', middle)
        after = result.index('\n', end) + 1
        source_return, active_return = result[first:middle], result[middle + 8:end]
        assert source_return.strip().startswith('return { server, store, game, world,')
        expected = active_return.replace('gallery, archives,', 'gallery, photoUploads, archives,')
        assert source_return.replace('nekoAuth, nekoLinks, ', '') == expected, 'Only the reviewed return-object conflict may be resolved'
        result = result[:start] + expected + result[after:]
    assert '<<<<<<< ' not in result and 'nekoAuth' not in result and 'nekoLinks' not in result
    assert "import { SharedRealmAccess } from './shared-realm-access.mjs';" in result
    assert 'const photoUploads = new PhotoUploads(' in result
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf-8', newline='\n')
print('Verified photo-only runtime merge; existing shared-realm access retained')
