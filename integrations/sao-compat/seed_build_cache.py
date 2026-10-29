"""Cache official artifacts with publisher SHA-1 when Java TLS downloads fail."""
import argparse
import hashlib
from pathlib import Path
import urllib.request
import json

ARTIFACTS = {
    'https://libraries.minecraft.net/': ['com/mojang/authlib/4.0.43/authlib-4.0.43'],
    'https://repo.maven.apache.org/maven2/': ['org/antlr/antlr4/4.9.1/antlr4-4.9.1'],
}

def seed(root):
    root = Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope'] != 'isolated_testing':
        raise ValueError('isolated_lab_marker_required')
    cache = root/'native-addon-build/verified-maven'
    records = []
    for base, names in ARTIFACTS.items():
        for name in names:
            for ext in ('.pom', '.jar'):
                relative = name+ext
                request = urllib.request.Request(base+relative, headers={'User-Agent':'maw-sao-build/0.1'})
                data = urllib.request.urlopen(request, timeout=60).read()
                published = urllib.request.urlopen(base+relative+'.sha1', timeout=60).read().decode().split()[0]
                if hashlib.sha1(data).hexdigest() != published:
                    raise ValueError('publisher_checksum_mismatch:'+relative)
                dest = cache/relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                records.append({'source':base+relative,'sha1':published,'bytes':len(data)})
    (root/'build-cache-provenance.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
    print(json.dumps(records))

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);seed(p.parse_args().root)
