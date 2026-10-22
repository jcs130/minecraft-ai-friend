"""Pinned optional Numen host policy and read-only health for the FOM JVM."""
from pathlib import Path
import hashlib,http.client,json

VERSION='0.1.4.1'
OFFICIAL_RELEASE='https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta'
FILES={
    'numen-neoforge-1.21.1-0.1.4.1.jar':'ed4a5936aa182b0d9ab685cb993da54f72514eafb0838bb9a64cd69962cb1226',
    'maw_numen_compat-0.1.0.jar':'1f1ad2a47f7bbdbfab456735bc131f8650e87a9f3ca6fee6c9a5fdee08e0f6f0',
    'maw_numen_server-0.2.1.jar':'11a6dbabd2117b1bb94e4b5ff24ced2de57495b7c580614e7786df89134fc5a7'
}
HOSTS={
    'maw_numen_server-0.2.0.jar':'b31bc8ad4e0c3b35682dcf917c172b8f916b1238374dea19cd1a0b44b6dc75cc',
    'maw_numen_server-0.2.1.jar':FILES['maw_numen_server-0.2.1.jar']
}

def policy(server,selected,mod_files,*,production):
    if selected is None:return None
    if not isinstance(selected,dict) or set(selected)!={'enabled','port'} or selected.get('enabled') is not True:
        raise ValueError('Numen host requires explicit enabled/port selection')
    port=selected['port']
    if type(port)!=int or (production and port!=28989) or (not production and not 39000<=port<=39999):
        raise ValueError('Numen admin endpoint must use the selected private port')
    selected_hosts=[name for name in mod_files if name.startswith('maw_numen_server-')]
    if (any(mod_files.get(name)!=digest for name,digest in FILES.items() if name not in HOSTS)
        or len(selected_hosts)!=1 or selected_hosts[0] not in HOSTS
        or mod_files[selected_hosts[0]]!=HOSTS[selected_hosts[0]]):
        raise ValueError('Numen host requires the pinned official core, optional-client adapter and server host')
    if sorted(n for n in mod_files if n.startswith('numen'))!=['numen-neoforge-1.21.1-0.1.4.1.jar']:
        raise ValueError('Duplicate Numen core or standalone embedded API')
    path=Path(server)/'config/maw-numen-server.json';raw=path.read_bytes();config=json.loads(raw)
    if (config.get('enabled') is not True or config.get('bind')!='127.0.0.1' or config.get('port')!=port
        or config.get('allowedHosts')!=['127.0.0.1:'+str(port)]
        or config.get('publicEndpoint')!='http://127.0.0.1:'+str(port)+'/mcp'
        or config.get('testOnlyAllowLoopbackModels',False) is not False):
        raise ValueError('FOM Numen host must retain loopback-only authenticated management')
    private=Path(server)/'config/maw-numen-private'
    if any(not (private/name).is_file() for name in ('accounts.json','bridge.json')):
        raise ValueError('Missing private Numen authentication files')
    return {'port':port,'version':VERSION,'configFile':str(path),'configSha256':hashlib.sha256(raw).hexdigest()}

def check_unchanged(expected):
    if expected and hashlib.sha256(Path(expected['configFile']).read_bytes()).hexdigest()!=expected['configSha256']:
        raise ValueError('Numen host policy changed while running; review and restart owner')

def health(port,pid):
    from maw_service import check_owned_listener
    check_owned_listener(port,pid,expected_host='127.0.0.1')
    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=1.5)
    try:
        connection.request('GET','/healthz',headers={'Host':'127.0.0.1:'+str(port)})
        response=connection.getresponse();raw=response.read(65537)
        if response.status!=200 or len(raw)>65536:raise ValueError('Numen host health unavailable')
        value=json.loads(raw)
        if not (value.get('ok') is True and value.get('serverResident') is True and value.get('clientRequired') is False and value.get('numenVersion')==VERSION):
            raise ValueError('Unexpected Numen host version or body provider')
        return {'ready':True,'version':VERSION,'serverResident':True,'clientRequired':False,
            'nativeModAccess':value.get('nativeModAccess') is True,'nativeModOperationCount':value.get('nativeModOperationCount',0),
            'managedBodyChunkLoading':value.get('managedBodyChunkLoading') is True}
    finally:connection.close()


def gameplay_checks(mod_files,value):
    """FOM feature readiness is required only when its optional extension is selected."""
    if not any(name.startswith('maw_numen_mods-') for name in mod_files):return {}
    checks={'numen_native_gameplay_extension_loaded':value.get('nativeModAccess') is True,
            'numen_native_gameplay_catalog_available':value.get('nativeModOperationCount',0)>=17}
    if 'maw_numen_server-0.2.1.jar' in mod_files:
        checks['numen_owner_offline_chunk_loading']=value.get('managedBodyChunkLoading') is True
    if any(name.startswith('minecolonies-') for name in mod_files):
        checks['numen_colony_gameplay_catalog_available']=value.get('nativeModOperationCount',0)>=35
    return checks
