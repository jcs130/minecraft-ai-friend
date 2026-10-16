"""Prepare a blocks-only derivative for temporary encounter lifecycle ownership.

Natural world-generation templates remain untouched. In a temporary encounter,
the encounter plugin creates and owns wave entities, so template villagers or
armor stands must not survive its terrain rollback. Output remains native NBT.
"""
from pathlib import Path, PurePosixPath
import argparse,importlib.util,hashlib,json,zipfile
spec=importlib.util.spec_from_file_location('builder',Path(__file__).with_name('build-world-variety-packs.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pack',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--entry',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
if hashlib.sha256(a.pack.read_bytes()).hexdigest()!=a.sha256:raise ValueError('Unverified source pack')
entry=PurePosixPath(a.entry)
if entry.is_absolute()or'..'in entry.parts or'\\'in a.entry or not a.entry.endswith('.nbt'):raise ValueError('Unsafe structure entry')
with zipfile.ZipFile(a.pack)as z:raw=z.read(a.entry)
out=b.rewrite_nbt_namespace(raw,'__unchanged_namespace__','__unchanged_namespace__',strip_template_entities=True)
with a.output.open('xb')as file:file.write(out)
print(json.dumps({'sourcePack':a.pack.name,'entry':a.entry,'sourceNbtSha256':hashlib.sha256(raw).hexdigest(),'blocksOnlySha256':hashlib.sha256(out).hexdigest(),'naturalTemplateUnchanged':True}))
