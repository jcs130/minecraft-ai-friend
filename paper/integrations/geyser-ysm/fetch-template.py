"""Fetch pinned Mojang player template into a private build/runtime directory.
No third-party assets are checked into Git. Runtime conversion needs no network.
"""
from pathlib import Path
from urllib.request import urlopen
import argparse, hashlib, json

REV='46ba6ea985fb5a92d79a9419198f10dda14c199d'
BASE=f'https://raw.githubusercontent.com/Mojang/bedrock-samples/{REV}/'
PINS={'player.entity.json':('resource_pack/entity/player.entity.json','7e520d872fc72be266223b3db2883c2818742a9a450330753a6de4d2ad813608')}
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
root=args.output.resolve();assert not root.is_relative_to(Path(__file__).resolve().parents[3]), 'third-party output must stay outside Git'
root.mkdir(parents=True,exist_ok=True)
for name,(source,expected) in PINS.items():
    data=urlopen(BASE+source,timeout=30).read(65537)
    assert len(data)<=65536 and hashlib.sha256(data).hexdigest()==expected, 'pinned template mismatch'
    target=root/name
    if target.exists():assert target.read_bytes()==data, 'refuse overwriting a different template'
    else:target.write_bytes(data)
license_file=root/'LICENSE.md'
license_data=urlopen(BASE+'LICENSE.md',timeout=30).read(65537)
assert len(license_data)<=65536
if license_file.exists():assert license_file.read_bytes()==license_data
else:license_file.write_bytes(license_data)
(root/'source.json').write_text(json.dumps({'repository':'Mojang/bedrock-samples','revision':REV,'templateSha256':PINS['player.entity.json'][1],'license':'Minecraft EULA; see LICENSE.md'},indent=2),encoding='utf-8')
print('Pinned template and upstream license ready; no runtime listener or restart.')
