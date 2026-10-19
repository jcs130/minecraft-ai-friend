"""Read-only FOM release probe; no login, control lease, model or game mutation."""
from pathlib import Path
from urllib.request import urlopen
import argparse,json,time
from fom_service import load_config
DEFAULT=Path('E:/MC/servers/fom-2.42/ops/service.json')

def probe(file=DEFAULT):
    checks={};result={'schemaVersion':1,'scope':'fom_public_server','checks':checks,'modelRequests':0,'worldActions':0,'allModGameplayVerified':False}
    try:
        cfg=load_config(file);checks['release_files_and_login_policy_verified']=True
        from fom_smart_npc import check_policy
        checks.update(check_policy(Path(cfg['serverDir'])))
        with urlopen('http://127.0.0.1:'+str(cfg['healthPort'])+'/healthz',timeout=6) as response:state=json.load(response)
        checks['correct_server_owner']=state['serverDir']==cfg['serverDir'] and [r['id'] for r in state['services']]==[r['id'] for r in cfg['services']]
        checks['owner_heartbeat']=0<=time.time()-state['heartbeatEpoch']<15
        child=state['services'][0]
        checks['actual_minecraft_status']=state['healthy'] and child['ready'] and child['metrics']['version']['protocol']==767
        checks['explicit_game_bind']=child['port']==cfg['gamePort'] and child['listenHost']==cfg['services'][0]['listenHost']
        checks['private_admin_http']=child['host']=='127.0.0.1'
        checks['mixed_login_database_created']=(Path(cfg['serverDir'])/'mixauth/mixauth.mv.db').is_file()
        if len(cfg['services'])>1:
            gate=state['services'][1]
            checks['agent_gateway_ready']=gate['ready'] and gate['port']==cfg['services'][1]['port'] and gate['metrics']['version']['protocol']==767
            checks['agent_gateway_lan_only']=cfg['services'][1]['env']['GATE_PUBLIC_GAME_ACCESS']=='0'
        result.update(gamePort=cfg['gamePort'],healthPort=cfg['healthPort'],runId=state['runId'],physicsTransport='TCP',publicGameAccess=cfg['networkExposure']['publicGameAccess'],supervisedBy='existing owned-child supervisor')
    except Exception as error:result['error']=type(error).__name__+': '+str(error)
    result['ok']=bool(checks) and all(checks.values()) and 'error' not in result;return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=Path,default=DEFAULT)
    a=parser.parse_args();r=probe(a.config);print(json.dumps(r,ensure_ascii=True,indent=2));raise SystemExit(0 if r['ok'] else 1)
