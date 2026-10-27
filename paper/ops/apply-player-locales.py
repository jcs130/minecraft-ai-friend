"""Six player-facing locale scalars; preserve every other byte and credential.

Requires PyYAML. Default is review only. --apply needs two distinct backup dirs.
Reload each plugin with its own supported command after reviewing the report.
Never copy a real SkinsRestorer config into source control.
"""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,urllib.request
import yaml

MANIFEST=Path(__file__).resolve().parents[1]/'config-candidates/adventure-release/player-locales.json'

def digest(data):return hashlib.sha256(data).hexdigest()

def patch_scalars(blob,patches):
    raw=blob.decode('utf-8-sig');before=yaml.safe_load(raw);expected=copy.deepcopy(before)
    replacements={tuple(p['path']):p['value'] for p in patches}
    assert len(replacements)==len(patches),'Duplicate field'
    for keys,value in replacements.items():
        item=expected
        for key in keys[:-1]:item=item[key]
        assert keys[-1] in item,'Missing expected field'
        previous=item[keys[-1]]
        if isinstance(previous,str) and isinstance(value,str):
            assert sorted(re.findall(r'%[A-Za-z]',previous))==sorted(re.findall(r'%[A-Za-z]',value)),'Message placeholder changed'
        item[keys[-1]]=value
    stack=[];found=set();lines=[]
    for line in raw.splitlines(keepends=True):
        match=re.match(r'^( *)([A-Za-z0-9_-]+):(.*?)(\r?\n|$)',line)
        if match:
            indent,key,rest,ending=match.groups();depth=len(indent)
            while stack and stack[-1][0]>=depth:stack.pop()
            keys=tuple(v for _,v in stack)+(key,)
            if keys in replacements:
                assert keys not in found,'Ambiguous field';found.add(keys)
                value=json.dumps(replacements[keys],ensure_ascii=False)
                line=indent+key+': '+value+ending
            if not rest.strip() or rest.lstrip().startswith('#'):stack.append((depth,key))
        lines.append(line)
    assert found==set(replacements),'Field location missing'
    after=''.join(lines);assert yaml.safe_load(after)==expected,'Unrelated setting changed'
    return (b'\xef\xbb\xbf' if blob.startswith(b'\xef\xbb\xbf') else b'')+after.encode('utf-8')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--server-dir',type=Path,required=True);p.add_argument('--translation-file',type=Path)
    p.add_argument('--apply',action='store_true');p.add_argument('--backup-dir',type=Path);p.add_argument('--mirror-dir',type=Path);a=p.parse_args()
    root=a.server_dir.resolve();manifest=json.loads(MANIFEST.read_text(encoding='utf-8'));assert manifest['schemaVersion']==1
    grouped={}
    for patch in manifest['patches']:grouped.setdefault(patch['file'],[]).append(patch)
    changes={};original={}
    for name,patches in grouped.items():
        target=(root/name).resolve();assert target.is_relative_to(root) and target.is_file()
        before=target.read_bytes();after=patch_scalars(before,patches)
        if after!=before:original[name]=before;changes[name]=after
    language=manifest['translation'];blob=a.translation_file.read_bytes() if a.translation_file else urllib.request.urlopen(language['url'],timeout=30).read()
    assert digest(blob)==language['sha256'],'Translation digest mismatch'
    target=(root/language['file']).resolve();assert target.is_relative_to(root)
    if not target.exists():original[language['file']]=None;changes[language['file']]=blob
    else:assert digest(target.read_bytes())==language['sha256'],'Preserve an existing custom translation; review manually'
    if a.apply and changes:
        assert a.backup_dir and a.mirror_dir,'Both backup directories required'
        backups=[a.backup_dir.resolve(),a.mirror_dir.resolve()]
        assert backups[0]!=backups[1] and all(not b.is_relative_to(root) and not b.exists() for b in backups),'Fresh distinct backup directories required'
        for backup in backups:
            backup.mkdir(parents=True)
            for name,before in original.items():
                if before is not None:
                    dest=backup/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(before);assert digest(dest.read_bytes())==digest(before)
            (backup/'manifest.json').write_text(json.dumps({n:None if b is None else digest(b) for n,b in original.items()},indent=2),encoding='utf-8')
        # Recheck every preimage after both backups, before any file is changed.
        for name,before in original.items():
            target=root/name;assert (not target.exists()) if before is None else target.read_bytes()==before,'Config changed during review'
        for name,after in changes.items():
            target=root/name;target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_name(target.name+'.locale-candidate');assert not temp.exists()
            temp.write_bytes(after);os.replace(temp,target)
    print(json.dumps({'applied':bool(a.apply),'changedFiles':list(changes),'sha256':{n:digest(b) for n,b in changes.items()},'unrelatedSettingsPreserved':True,'automaticReload':False}))

if __name__=='__main__':main()
