"""Fetch an exact official ViaProxy release into a new, private runtime folder."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

HERE = Path(__file__).resolve().parent


def prepare(root):
    root = root.resolve()
    if root.exists():
        raise ValueError('Use a new proxy runtime; existing directories are never overwritten')
    lock = json.loads((HERE / 'proxy.lock.json').read_text(encoding='utf-8'))
    if not lock['url'].startswith('https://github.com/ViaVersion/ViaProxy/releases/download/'):
        raise ValueError('Unexpected proxy origin')
    root.mkdir(parents=True)
    target = root / lock['filename']
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(lock['url'], timeout=60) as response, target.open('xb') as output:
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > lock['maxBytes']:
                raise ValueError('Proxy exceeds download budget')
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != lock['sha256']:
        raise ValueError('Proxy checksum mismatch; failed download retained for diagnosis')
    receipt = {**lock, 'bytes': total, 'verified': True}
    (root / 'download-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runtime', type=Path)
    print(json.dumps(prepare(parser.parse_args().runtime)))
