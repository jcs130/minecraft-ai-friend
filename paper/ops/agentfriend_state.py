"""Read an immutable AF snapshot with Windows rename sharing and commit validation.
No game writes, unlocking, process shutdown, or inference from incomplete records.
"""
from pathlib import Path
import hashlib,json,os,re
import yaml

MAX_RECORDS=128
def shared_read(path,max_bytes):
    path=Path(path)
    if os.name=='nt':
        import ctypes as c,msvcrt
        from ctypes import wintypes as w
        kernel=c.WinDLL('kernel32',use_last_error=True)
        kernel.CreateFileW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,c.c_void_p,w.DWORD,w.DWORD,w.HANDLE]
        kernel.CreateFileW.restype=w.HANDLE;kernel.CloseHandle.argtypes=[w.HANDLE]
        handle=kernel.CreateFileW(str(path),0x80000000,1|2|4,None,3,0x08000080,None)
        if handle==c.c_void_p(-1).value:raise c.WinError(c.get_last_error())
        try:fd=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY)
        except Exception:kernel.CloseHandle(handle);raise
        try:stream=os.fdopen(fd,'rb')
        except Exception:os.close(fd);raise
    else:stream=path.open('rb')
    with stream:
        before=os.fstat(stream.fileno())
        if before.st_size>max_bytes:raise ValueError('source_size_limit')
        data=stream.read(max_bytes+1);after=os.fstat(stream.fileno())
        if len(data)>max_bytes:raise ValueError('source_size_limit')
        if(before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('source_changing')
        return data,after.st_mtime

def _hash(data):return hashlib.sha256(data).hexdigest()
def _revision(value):
    meta=value.get('__agentfriend_storage',{})
    if not isinstance(meta,dict):raise ValueError('state_revision_invalid')
    revision=meta.get('revision',0)
    if type(revision)is not int or not 0<=revision<2**63:raise ValueError('state_revision_invalid')
    return revision
def _yaml(data):
    value=yaml.safe_load(data.decode('utf-8-sig'))
    if not isinstance(value,dict):raise ValueError('source_not_mapping')
    return value
def _records(directory):
    result=[];paths=list(directory.glob('commit-*.json'))
    if len(paths)>MAX_RECORDS:raise ValueError('state_record_scan_budget')
    for path in paths:
        if path.is_symlink():raise ValueError('state_record_is_link')
        data,_=shared_read(path,4096)
        if not data.endswith(b'\n'):continue
        value=json.loads(data)
        required=['format','revision','image','bytes','sha256','baseRevision','baseSha256','recordSha256']
        if not isinstance(value,dict)or set(value)!=set(required):raise ValueError('invalid_state_record')
        if any(type(value[key])is not int for key in ['format','revision','bytes','baseRevision']):raise ValueError('invalid_state_record')
        if value['format']!=1 or not 0<=value['baseRevision']<value['revision']<2**63 or not 0<value['bytes']<=16*1024*1024:raise ValueError('invalid_state_record')
        if not isinstance(value['image'],str)or not re.fullmatch(r'config\.yml\.site-dungeon-[A-Za-z0-9_-]+\.(?:tmp|state)',value['image']):raise ValueError('invalid_state_image_name')
        if any(not isinstance(value[key],str)or not re.fullmatch('[a-f0-9]{64}',value[key])for key in ['sha256','baseSha256','recordSha256']):raise ValueError('invalid_state_record_hash')
        canonical=f"1\n{value['revision']}\n{value['image']}\n{value['bytes']}\n{value['sha256']}\n{value['baseRevision']}\n{value['baseSha256']}\n".encode('ascii')
        if _hash(canonical)!=value['recordSha256']:raise ValueError('invalid_state_record_hash')
        result.append(value)
    return sorted(result,key=lambda value:value['revision'])

def read_yaml_snapshot(file,max_bytes=8*1024*1024):
    file=Path(file)
    for attempt in range(2):
        try:
            data,at=shared_read(file,max_bytes);value=_yaml(data)
            if file.name!='config.yml'or file.parent.name!='AgentFriend':return value,at
            directory=file.parent/'.state-pending'
            if not directory.exists():return value,at
            if directory.is_symlink():raise ValueError('state_directory_is_link')
            records=_records(directory)
            if not records:return value,at
            latest=records[-1]
            if any(row['revision']==latest['revision']and row!=latest for row in records):raise ValueError('conflicting_state_commits')
            revision=_revision(value)
            if revision>=latest['revision']:
                if revision==latest['revision']and _hash(data)!=latest['sha256']:raise ValueError('state_projection_hash_conflict')
                return value,at
            if revision!=latest['baseRevision']or _hash(data)!=latest['baseSha256']:raise ValueError('state_projection_conflict')
            image=directory/latest['image']
            if image.is_symlink():raise ValueError('state_image_is_link')
            data,at=shared_read(image,max_bytes)
            if len(data)!=latest['bytes']or _hash(data)!=latest['sha256']:raise ValueError('state_image_hash_mismatch')
            value=_yaml(data)
            if _revision(value)!=latest['revision']:raise ValueError('state_record_revision_mismatch')
            return value,at
        except (FileNotFoundError,ValueError)as error:
            if attempt:raise
    raise ValueError('source_changing')
