"""Permit the pinned ALI read-only bootstrap without relaxing game authentication.

Planning is read-only. Applying writes only DirectAuth's payload exception list,
with verified E/F preimages; use the normal console to reload DirectAuth next.
"""
from pathlib import Path
import argparse, copy, hashlib, json, os, shutil, uuid

ROOT=Path('E:/MC/servers/sao-0.76.1')
ALI_JAR='AdvancedLootInfo-forge-1.20.1-2.2.0.jar'
ALI_SHA256='6f74e1b1463d1df3d6b2509ec8a02a905a5c71ab8301ffa0441eefe22e5df622'
# Exact JAR: registerClient takes IDs 1..3; registerCommon then takes ID 4.
# RequestLootDataMessage has an empty body and only synchronizes loot metadata.
EXCEPTION='ali:network#4'

def sha(file):
    with Path(file).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()

def verify_mods(directory):
    if sha(Path(directory)/ALI_JAR)!=ALI_SHA256:
        raise ValueError('ali_version_changed_reinspect_the_wire_contract')

def draft(config):
    if config.get('sessionGracePeriod')!=0 or config.get('minPasswordLength',0)<8:
        raise ValueError('existing_sao_auth_policy_required')
    entries=config.get('heldPayloadExceptions')
    if not isinstance(entries,list) or any(not isinstance(x,str) for x in entries):
        raise ValueError('heldPayloadExceptions_expected_string_array')
    if any(x=='ali:network' or x.startswith('ali:network#') and x!=EXCEPTION for x in entries):
        raise ValueError('unexpected_ali_exception_requires_review')
    result=copy.deepcopy(config)
    if EXCEPTION not in entries:result['heldPayloadExceptions'].append(EXCEPTION)
    return result

def apply(root,primary,secondary):
    root=Path(root).resolve();primary=Path(primary).resolve();secondary=Path(secondary).resolve()
    if root!=ROOT.resolve():raise ValueError('explicit_owned_sao_root_required')
    if not primary.is_relative_to(Path('E:/MC/backups').resolve()) or not secondary.is_relative_to(Path('F:/MC-backups').resolve()):
        raise ValueError('independent_e_f_backup_directories_required')
    marker=json.loads((root/'pack-source.json').read_text('utf-8'))
    if marker.get('scope')!='managed_server' or marker.get('pack')!='SAO-0.76.1-lite.zip':raise ValueError('owned_sao_marker_required')
    verify_mods(root/'server/mods')
    file=root/'server/world/serverconfig/DirectAuth-config.json';before=file.read_bytes();config=json.loads(before);after=draft(config)
    if after==config:return {'changed':False,'exception':EXCEPTION,'reloadRequired':False}
    if primary.exists() or secondary.exists():raise FileExistsError('preserve_existing_maintenance_record')
    encoded=(json.dumps(after,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    result={'schemaVersion':1,'phase':'preparing','exception':EXCEPTION,'aliSha256':ALI_SHA256,'beforeSha256':hashlib.sha256(before).hexdigest(),'afterSha256':hashlib.sha256(encoded).hexdigest(),'authPolicyUnchanged':True,'onlyChangedField':'heldPayloadExceptions','clientPackageUnchanged':True,'restartRequired':False,'reloadRequired':True}
    for directory in [primary,secondary]:
        directory.mkdir(parents=True)
        (directory/'DirectAuth-config.before.json').write_bytes(before)
        (directory/'DirectAuth-config.after.json').write_bytes(encoded)
        for name,digest in [('DirectAuth-config.before.json',result['beforeSha256']),('DirectAuth-config.after.json',result['afterSha256'])]:
            if sha(directory/name)!=digest:raise RuntimeError('backup_verification_failed')
        (directory/'maintenance.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    if file.read_bytes()!=before:raise RuntimeError('config_changed_during_preparation_reconcile_preimage')
    temp=file.with_name(file.name+'.'+str(uuid.uuid4())+'.tmp')
    try:
        with temp.open('xb')as out:out.write(encoded);out.flush();os.fsync(out.fileno())
        shutil.copymode(file,temp);os.replace(temp,file)
    finally:temp.unlink(missing_ok=True)
    if sha(file)!=result['afterSha256']:raise RuntimeError('config_write_result_unknown_do_not_replay')
    result.update(phase='written_awaiting_native_reload',changed=True)
    for directory in [primary,secondary]:(directory/'maintenance.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--apply',action='store_true');p.add_argument('--primary-backup',type=Path);p.add_argument('--secondary-backup',type=Path);a=p.parse_args()
    if a.apply:
        if not a.primary_backup or not a.secondary_backup:p.error('apply requires both backup directories')
        print(json.dumps(apply(a.root,a.primary_backup,a.secondary_backup)))
    else:
        verify_mods(a.root/'server/mods');config=json.loads((a.root/'server/world/serverconfig/DirectAuth-config.json').read_text('utf-8'))
        print(json.dumps({'changed':draft(config)!=config,'exception':EXCEPTION,'readOnlyPlan':True}))
