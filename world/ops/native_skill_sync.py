"""Offline native SkillService installation of reviewed complete skill packages."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile

from native_role_capabilities import directory_hashes, native_lock, native_package_files


def sync_native_pool(state, backup):
    """Update only the three known builtin pool entries through native APIs."""
    from qwenpaw.agents.skill_system.registry import import_builtin_skills, update_single_builtin
    from qwenpaw.agents.skill_system.store import get_skill_pool_dir
    from native_role_capabilities import NATIVE_SKILLS
    state, backup = Path(state), Path(backup)
    pool = Path(get_skill_pool_dir())
    assert pool.resolve() == (state/'skill_pool').resolve() and not pool.is_symlink()
    selected = native_lock('2.2.1')
    legacy = native_lock('2.2.0')
    manifest_path = pool/'skill.json'
    original = manifest_path.read_bytes() if manifest_path.exists() else None
    manifest = json.loads(original) if original else {'skills':{}}
    planned = []
    for name in NATIVE_SKILLS:
        native_package_files(name, version='2.2.1')
        target=pool/name
        entry=manifest.get('skills',{}).get(name)
        if target.exists() or target.is_symlink():
            actual=directory_hashes(target)
            if (entry is None or entry.get('source')!='builtin'
                    or entry.get('builtin_language') not in (None,'','zh')
                    or actual not in (selected['skills'][name]['files'],{'SKILL.md':legacy['skills'][name]['sha256']})):
                raise ValueError('user_modified_native_pool_skill:'+name)
            if actual == selected['skills'][name]['files']:
                continue
        elif entry is not None:
            raise ValueError('native_pool_manifest_without_files:'+name)
        planned.append((name,target,entry))
    if not planned:
        return {'changed':[],'packageVersion':'2.2.1'}
    saved=backup/'native-pool'
    saved.mkdir(parents=True,exist_ok=False)
    if original is not None: (saved/'skill.json').write_bytes(original)
    for name,target,entry in planned:
        if target.exists():
            shutil.copytree(target,saved/name)
            assert directory_hashes(saved/name)==directory_hashes(target)
    changes=[]
    for name,target,entry in planned:
        if entry is None:
            result=import_builtin_skills([{'skill_name':name,'language':'zh'}],overwrite_conflicts=False)
            assert name in result.get('imported',[]),result
        else:
            result=update_single_builtin(name,language='zh')
            assert result.get('source')=='builtin',result
        assert directory_hashes(target)==selected['skills'][name]['files']
        changes.append(name)
    return {'changed':changes,'packageVersion':'2.2.1','backup':str(saved)}


def sync_native_skill(service, folder, name, backup, *, version=None, source_root=None):
    """Install/update one supplied skill, preserving modified copies by refusal.

    The caller must stop the Qwen writer first. Original package and manifest
    bytes are backed up before moving the old directory. No models are called.
    """
    folder, backup = Path(folder), Path(backup)
    selected = native_lock(version)
    assert selected['packageVersion'] == '2.2.1'
    entry = selected['skills'][name]
    files = native_package_files(name, source_root, selected['packageVersion'])
    target = folder / 'skills' / name
    manifest_path = folder / 'skill.json'
    manifest_bytes = manifest_path.read_bytes() if manifest_path.exists() else None
    manifest = json.loads(manifest_bytes) if manifest_bytes is not None else {'skills': {}}
    old_entry = manifest.get('skills', {}).get(name)
    target_exists = target.exists() or target.is_symlink()
    if target_exists:
        actual = directory_hashes(target)
        current = {path: row['sha256'] for path, row in files.items()}
        legacy = native_lock('2.2.0')['skills'][name]
        previous = {'SKILL.md': legacy['sha256']}
        if actual not in (current, previous):
            raise ValueError('user_modified_native_skill:' + name)
        if old_entry is None or old_entry.get('source') != 'builtin':
            raise ValueError('unmanaged_native_skill:' + name)
        if actual == current:
            return {'name':name,'changed':False,'packageVersion':'2.2.1','files':len(files)}
    elif old_entry is not None:
        raise ValueError('native_skill_manifest_without_files:' + name)
    backup = backup / folder.name / 'native-packages' / name
    backup.mkdir(parents=True, exist_ok=False)
    if manifest_bytes is not None:
        (backup/'skill.json').write_bytes(manifest_bytes)
    with tempfile.TemporaryDirectory(prefix='qd-native-skill-') as temporary:
        stage = Path(temporary) / name
        stage.mkdir()
        for relative, row in files.items():
            path = stage / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(row['path'], path)
        # Official scanning occurs before the current workspace is changed.
        candidate = type(service)(Path(temporary)/'scan-workspace')
        result = candidate.install_skill_directory(stage, enable=False, source='builtin',
            installed_from='qwenpaw:2.2.1:' + entry['source'])
        assert result.get('success'), result
        saved = backup / 'package'
        if target_exists:
            target.rename(saved)
        try:
            result = service.install_skill_directory(stage, enable=old_entry.get('enabled', True) if old_entry else True,
                source='builtin', installed_from='qwenpaw:2.2.1:' + entry['source'],
                config=old_entry.get('config') if old_entry else None)
            assert result.get('success'), result
            assert directory_hashes(target) == entry['files']
            if old_entry and old_entry.get('channels'):
                assert service.set_skill_channels(name, old_entry['channels']) is True
        except BaseException:
            # Keep a failed candidate for inspection; do not remove user data.
            if target.exists():
                target.rename(backup/'failed-candidate')
            if saved.exists():
                saved.rename(target)
            if manifest_bytes is not None:
                manifest_path.write_bytes(manifest_bytes)
            raise
    return {'name':name,'changed':True,'packageVersion':'2.2.1','files':len(files),'backup':str(backup)}
