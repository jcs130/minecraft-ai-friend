"""Read-only client bridge/package probe. No login, lease, model or input actions."""
from pathlib import Path
import argparse,hashlib,json,time
from urllib.parse import urlsplit
from urllib.request import Request,urlopen
DEFAULT_MANIFEST=Path('E:/QiandengJiSocietyLab/integrations/java-client-bridge/installation.json')
def probe(config_file=None,manifest_file=DEFAULT_MANIFEST):
    checks={};report={'schemaVersion':1,'scope':'optional_real_java_client_bridge','checks':checks,'modelRequests':0,'worldActions':0,
        'bodyConnections':0,'managedBy':'owning_minecraft_client_lifecycle','allModsVerified':False}
    try:
        manifest=json.loads(Path(manifest_file).read_bytes());bundle=Path(manifest['directory']).resolve()
        checks['exact_bundle']=all(bundle in (bundle/name).resolve().parents and hashlib.sha256((bundle/name).read_bytes()).hexdigest()==digest for name,digest in manifest['files'].items())
        checks['client_only_mod']=manifest['clientOnly'] and not manifest['serverRequired'] and manifest['customPayloadChannels']==[]
        checks['three_explicit_providers']=manifest['providers']==['mineflayer','numen','java-client']
        checks['no_background_model_or_new_service']=manifest['modelRequests']==manifest['newServices']==0
        checks['operation_contract']=manifest['operationCount']==23
        if config_file:
            config=json.loads(Path(config_file).read_bytes());auth=json.loads(Path(config['credentialsFile']).read_bytes());url=urlsplit(auth['endpoint'])
            checks['loopback_only']=url.scheme=='http' and url.hostname=='127.0.0.1' and url.path=='/rpc' and not url.query and not url.fragment and not url.username
            if not checks['loopback_only']:raise ValueError('Refusing non-local endpoint')
            def rpc(method):
                params={k:config[k] for k in ['expectedUuid','expectedServer','controllerId']}
                data=json.dumps({'instanceId':auth['instanceId'],'method':method,'params':params}).encode()
                request=Request(auth['endpoint'],data,headers={'Authorization':'Bearer '+auth['token'],'Content-Type':'application/json'})
                with urlopen(request,timeout=7) as response:return json.load(response)
            health=rpc('health');state=rpc('snapshot');catalog=rpc('operations')
            checks['client_tick_fresh']=health['ok'] and 0<=time.time()*1000-health['lastTickAt']<5000
            checks['original_player_and_server']=state['ok'] and state['bodyId']==config['expectedUuid'] and state['server']==config['expectedServer']
            checks['actual_inventory_and_native_menu']=state['inventory']['slotNamespace']=='player_menu_46' and len(state['inventory']['slots'])==46 and state['menu']['playerUuid']==state['bodyId']
            checks['actual_api_smoke']=catalog['operationCount']==23 and len({r['id'] for r in catalog['operations']})==23 and catalog['serverRequired'] is False
            checks['original_framebuffer_available']=state['screen']['framebufferWidth']>0 and state['screen']['framebufferHeight']>0
            report['actualClientChecked']=True
        else:report['actualClientChecked']=False
    except Exception as error:report['error']=type(error).__name__
    report['ok']=bool(checks) and all(checks.values()) and 'error' not in report
    return report
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--config',type=Path);ap.add_argument('--manifest',type=Path,default=DEFAULT_MANIFEST)
    a=ap.parse_args();result=probe(a.config,a.manifest);print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result['ok'] else 1)
