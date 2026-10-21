"""Private read-only FOM Bedrock health, not a claim of complete mod parity."""
from pathlib import Path
from urllib.request import urlopen
import argparse,json,time
from fom_bedrock_service import load_config,DEFAULT

def probe(file=DEFAULT):
    out={'schemaVersion':1,'scope':'fom_bedrock','checks':{},'modelRequests':0,'worldActions':0,'actualPhoneTested':False,'allModGameplayVerified':False}
    try:
        config=load_config(Path(file));checks=out['checks'];checks['release_and_actual_fom_registry']=True
        with urlopen('http://127.0.0.1:'+str(config['healthPort'])+'/healthz',timeout=5) as response:state=json.load(response)
        checks['correct_owner']=state['serverDir']==config['serverDir']
        checks['fresh_heartbeat']=0<=time.time()-state['heartbeatEpoch']<15
        checks['supervised_children_ready']=state['healthy'] and all(s['ready'] and s['pid'] for s in state['services'])
        bedrock=next(s for s in state['services'] if s['id']=='bedrock')
        checks['actual_udp_pong']=bedrock['metrics']['bedrock']['port']==config['udpPort']
        checks['native_icon_registration']=bedrock['metrics']['customItems']['nativeItems']==config['resourceContract']['itemCount']
        if config.get('modelContract'):
            checks['native_maid_model_registration']=bedrock['metrics']['customModels']['registeredModels']==config['modelContract']['modelCount']
            checks['native_maid_download_stack']=bedrock['metrics']['customModels']['packsLoaded']==len(config['modelContract']['packs'])
            if config['modelContract'].get('packetMotionVersion')==1:
                checks['native_packet_motion_registration']=bedrock['metrics']['customModels'].get('packetMotionVersion')==1
        if config.get('blockContract'):
            checks['native_block_registration']=bedrock['metrics']['customBlocks']['registeredStates']==config['blockContract']['stateCount']
            checks['native_block_download_stack']=bedrock['metrics']['customBlocks']['packLoaded'] is True
            if config['blockContract'].get('blockItemCount',0):checks['native_3d_block_item_registration']=bedrock['metrics']['customBlocks']['registeredBlockItems']==config['blockContract']['blockItemCount']
        gate=config['services'][0]
        checks['private_upstream']=gate['listenHost']=='127.0.0.1' and gate['env']['GATE_BEDROCK_ACCOUNT_NAMESPACE']=='1'
        checks['xbox_required_on_lan']=config['mode']=='lan'
        out.update(udpPort=config['udpPort'],udpAddress=config['udpAddress'],runId=state['runId'],customItems=config['resourceContract']['itemCount'])
    except Exception as error:out['error']=type(error).__name__+': '+str(error)
    out['ok']=bool(out['checks']) and all(out['checks'].values()) and 'error' not in out
    return out

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=Path,default=DEFAULT)
    out=probe(parser.parse_args().config);print(json.dumps(out,ensure_ascii=False,indent=2));raise SystemExit(0 if out['ok'] else 1)
