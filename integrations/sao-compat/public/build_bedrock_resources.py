"""Convert verified installed assets with the existing item-pack converter.

All binaries/textures remain outside Git. Ambiguous resource overrides are
reported, never arbitrarily advertised as an exact renderer.
"""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, sys, zipfile

def digest(raw):return hashlib.sha256(raw).hexdigest()
def extract(root,work,vanilla):
    root,work,vanilla=Path(root),Path(work),Path(vanilla);output=work/'bedrock-assets';output.mkdir(exist_ok=True)
    lock=json.loads((root/'ops/release.json').read_text());assets={};sources={}
    origin=json.loads((work/'vanilla-client-source.json').read_text())
    if origin.get('version')!='1.20.1' or digest(vanilla.read_bytes())!=origin.get('sha256'):raise ValueError('verified_vanilla_client_required')
    jars=[vanilla,*sorted((root/'server/mods').glob('*.jar'))]
    for jar in jars:
        sha=digest(jar.read_bytes());sources[jar.name]=sha
        if jar!=vanilla and sha!=lock['mods'].get(jar.name):raise ValueError('installed_mod_hash_mismatch')
        with zipfile.ZipFile(jar)as archive:
            for entry in archive.infolist():
                name=entry.filename;p=PurePosixPath(name)
                if not name.startswith('assets/')or entry.is_dir()or not name.endswith(('.png','.png.mcmeta','.json','.ogg')):continue
                # SAO's installed armor_models.json is 34,706,932 bytes. It is
                # a verified model document, not a texture; retain a separate
                # bounded JSON budget instead of rejecting the whole pack.
                limit=(64 if name.endswith('.json') else 32)*1024*1024
                if p.is_absolute()or'..'in p.parts or'\\'in name or entry.file_size>limit:raise ValueError('unsafe_asset_entry:'+jar.name+':'+name)
                raw=archive.read(entry);fingerprint=digest(raw);prior=assets.get(name)
                if prior:
                    if prior['sha256']!=fingerprint:prior.setdefault('variants',[]).append({'source':jar.name,'sha256':fingerprint})
                    continue
                target=output.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
                assets[name]={'bytes':len(raw),'sha256':fingerprint,'source':jar.name}
    manifest={'schemaVersion':1,'minecraft':'1.20.1','assetIntegrityVerified':True,'sources':sources,'assets':assets}
    (output/'native-assets.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    return output

def build(root,work,vanilla):
    root,work=Path(root),Path(work);assetroot=extract(root,work,vanilla)
    base=root/'server/maw-sao/registry';meta=json.loads((base/'current.json').read_text());items=[json.loads(x)for x in(base/meta['serverEpoch']/'items.jsonl').read_text().splitlines()if x.strip()]
    registry=work/'sao-items.tsv';registry.write_text('\n'.join(x['name']+'\t'+str(x['id'])for x in items)+'\n',encoding='utf-8')
    sys.path.insert(0,str(Path(__file__).parent/'resource_tools'));from maw_bedrock_resources import build as convert
    output=work/'bedrock-icons';output.mkdir(exist_ok=True)
    version=digest((work/'bedrock-idmap.json').read_bytes()+(assetroot/'native-assets.json').read_bytes()+(Path(__file__).parent/'resource_tools/maw_bedrock_resources.py').read_bytes())[:24]
    contract=convert(assetroot,registry,work/'bedrock-idmap.json',output,identity='sao-'+version)
    return {'assetCount':len(json.loads((assetroot/'native-assets.json').read_text())['assets']),'itemCount':contract['itemCount'],'output':str(output)}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--work',required=True);p.add_argument('--vanilla',required=True);a=p.parse_args();print(json.dumps(build(a.root,a.work,a.vanilla)))
