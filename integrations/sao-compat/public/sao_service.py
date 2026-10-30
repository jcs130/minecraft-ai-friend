"""Own the SAO JVM/fronts/Bedrock bridge through the existing tested supervisor."""
from pathlib import Path
import argparse, hashlib, json, os, re, sys
import maw_service as base
from publish_assets import publish
import bedrock_health
from listener_policy import validate_voice

ROOT=Path('E:/MC/servers/sao-0.76.1').resolve()
BACKEND=39676

def sha(file):
    with Path(file).open('rb')as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def load_config(file,verify=True):
    file=Path(file).resolve();raw=base.read_json(file);root=Path(raw['root']).resolve();public=raw.get('publicGameAccess')
    if root!=ROOT or raw.get('schemaVersion')!=1 or type(public)is not bool:raise ValueError('explicit_owned_sao_deployment_required')
    if file!=root/'ops/service.json':raise ValueError('canonical_sao_config_required')
    server=root/'server';p=base.properties(server/'server.properties')
    required={'server-ip':'127.0.0.1','server-port':str(BACKEND),'online-mode':'false','enforce-secure-profile':'false','enable-rcon':'false','enable-query':'false','level-name':'world'}
    if any(p.get(k)!=v for k,v in required.items()):raise ValueError('sao_private_backend_policy_changed')
    marker=base.read_json(root/'pack-source.json')
    if marker.get('scope')!='managed_server':raise ValueError('managed_sao_marker_required')
    numen=base.read_json(server/'config/maw-numen-server.json')
    if not numen.get('enabled')or numen.get('bind')!='127.0.0.1'or numen.get('port')!=39689:raise ValueError('numen_must_remain_private')
    auth=base.read_json(server/'world/serverconfig/DirectAuth-config.json')
    if auth.get('sessionGracePeriod')!=0 or auth.get('minPasswordLength',0)<8:raise ValueError('sao_password_policy_changed')
    lock=base.read_json(root/'ops/release.json',4*1024*1024);stats={}
    for relative,expected in lock['files'].items():
        target=(root/relative).resolve()
        if not target.is_relative_to(root)or target.is_symlink()or not target.is_file()or verify and sha(target)!=expected:raise ValueError('sao_release_hash_mismatch:'+relative)
        s=target.stat();stats[target]=(s.st_size,s.st_mtime_ns)
    mods={p.name:sha(p)for p in(server/'mods').glob('*.jar')}if verify else {p.name:lock['mods'].get(p.name)for p in(server/'mods').glob('*.jar')}
    if mods!=lock['mods']or not any(n.startswith('directauth-forge-1.20.1-')for n in mods):raise ValueError('exact_authenticated_mod_set_required')
    java=Path(raw['java']).resolve();node=root/'ops/gateway/node.exe';gw=root/'ops/gateway';host='0.0.0.0'if public else'127.0.0.1';game,agent,bedrock,health=(28976,28977,28988,28985)if public else(38976,38977,38988,38985)
    voice_file=server/'config/voicechat/voicechat-server.properties'
    validate_voice(voice_file,public)
    def role(name,port,command,cwd,depends=(),listen='127.0.0.1',timeout=180,stop='{"kind":"shutdown"}'):
        return {'id':name,'port':port,'host':'127.0.0.1','listenHost':listen,'command':command,'cwd':str(cwd),'env':{},'dependsOn':list(depends),'readiness':'minecraft','startupTimeoutSeconds':timeout,'stopMode':'stdin','stopText':stop}
    services=[role('java',BACKEND,[str(java),'-Dfile.encoding=UTF-8','@user_jvm_args.txt','@libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt','nogui'],server,timeout=600,stop='stop')]
    for name,port in [('java_front',game),('agent_front',agent)]:
        f=root/'ops'/('front-'+name+'.json');expected={'host':host,'port':port,'backendPort':BACKEND,'assetsRoot':str(root/'ops/public-assets')if name=='agent_front'else None}
        if base.read_json(f)!=expected:raise ValueError('explicit_front_exposure_changed')
        services.append(role(name,port,[str(node),str(gw/'public/native-front.cjs'),str(f)],gw,['java'],host))
    if raw.get('bedrockEnabled'):
        bridge=root/'ops/bedrock';cfg=base.read_json(root/'ops/compat.json')
        if cfg.get('backendPort')!=BACKEND or cfg.get('port')!=39694:raise ValueError('private_bedrock_gateway_required')
        geyser=(bridge/'plugins/Geyser/config.yml').read_text(encoding='utf-8')
        if f'  address: {host}\n'not in geyser or f'  port: {bedrock}\n'not in geyser:raise ValueError('bedrock_exposure_mismatch')
        if '    validate-bedrock-login: true\n'not in geyser and(public or not raw.get('privateOfflineBedrockQA')):raise ValueError('public_bedrock_requires_xbox_authentication')
        services.append(role('compat_gate',39694,[str(node),str(gw/'public/compat-gate.cjs'),str(root/'ops/compat.json')],gw,['java']))
        services.append(role('bedrock',39695,[raw['bridgeJava'],'-Djava.net.preferIPv4Stack=true','-Xms128M','-Xmx2048M','-jar',str(bridge/'ViaProxy-3.4.14.jar'),'cli','--target-address','127.0.0.1:39694','--target-version','1.20.1','--auth-method','NONE','--bind-address','127.0.0.1:39695','--wildcard-domain-handling','NONE'],bridge,['compat_gate'],stop='stop'))
        services[-1]['bedrockUdp']={'port':bedrock,'address':host}
    config={'schemaVersion':1,'serverDir':str(server),'runtimeDir':str(root/'ops/runtime'),'gamePort':BACKEND,'healthPort':health,'services':services,'networkExposure':{'mode':'public'if public else'loopback','listenHost':host,'gamePort':game,'agentPort':agent,'bedrockUdp':bedrock if raw.get('bedrockEnabled')else None},'_raw':raw,'_file':str(file),'_stats':stats,'_lock':lock,'_root':root}
    def validate():
        validate_voice(voice_file,public)
        if base.read_json(file)!=raw or base.read_json(root/'ops/release.json',4*1024*1024)!=lock:raise ValueError('sao_configuration_changed')
        actual=base.properties(server/'server.properties')
        if any(actual.get(k)!=v for k,v in required.items()):raise ValueError('sao_private_backend_policy_changed')
        current_auth=base.read_json(server/'world/serverconfig/DirectAuth-config.json')
        if current_auth.get('sessionGracePeriod')!=0 or current_auth.get('minPasswordLength',0)<8:raise ValueError('sao_authentication_policy_changed')
        for target,old in stats.items():
            s=target.stat()
            if(s.st_size,s.st_mtime_ns)!=old:raise ValueError('sao_release_changed:'+target.name)
        if set(mods)!={p.name for p in(server/'mods').glob('*.jar')}:raise ValueError('sao_mod_set_changed')
    config['_validate']=validate
    return config

class SaoChild(base.Child):
    def __init__(self,*args,root,source,**kw):super().__init__(*args,**kw);self.root=root;self.source=source;self.registry_epoch=None
    def tick(self):
        super().tick()
        if self.spec['id']=='bedrock'and self.process and self.ready and not self.stopping:
            try:
                endpoint=self.spec['bedrockUdp'];bedrock_health.check_owner(endpoint['port'],self.process.pid,endpoint['address']);self.metrics['bedrock']=bedrock_health.probe(endpoint['port'])
            except(OSError,ValueError,RuntimeError)as error:self.ready=False;self.problem='bedrock_not_ready:'+str(error)[:160]
            return
        if self.spec['id']!='java'or not self.process or not self.ready:return
        try:
            meta=base.read_json(self.root/'server/maw-sao/registry/current.json')
            if meta.get('processId')!=self.process.pid:raise ValueError('waiting_for_current_jvm_registry')
            if self.registry_epoch!=meta['serverEpoch']:
                asset=publish(self.root,self.source)
                base.atomic_json(self.root/'lab-process.json',{'scope':'managed_server','pid':self.process.pid,'owner_pid':os.getpid(),'phase':'ready','port':BACKEND,'bind':'127.0.0.1'})
                self.registry_epoch=meta['serverEpoch'];self.metrics['registry']=asset
        except(Exception)as error:self.ready=False;self.problem='registry_not_ready:'+str(error)[:160]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['plan','run','status','console','shutdown','stop','resume']);p.add_argument('--config',required=True);p.add_argument('--request-id');p.add_argument('--command');a=p.parse_args();c=load_config(a.config,verify=a.action in['run','plan'])
    if a.action=='plan':print(json.dumps({'serverDir':c['serverDir'],'networkExposure':c['networkExposure'],'services':[{'id':s['id'],'port':s['port']}for s in c['services']]}));return
    if a.action=='status':print(json.dumps(base.read_json(Path(c['runtimeDir'])/'health.json')));return
    if a.action=='run':
        source=Path(c['_raw']['sourceDirectory']).resolve()
        supervisor=base.Supervisor(c,validator=c['_validate'],child_factory=lambda *args,**kw:SaoChild(*args,root=c['_root'],source=source,**kw));supervisor.run();return
    request={'requestId':a.request_id,'action':a.action,'reason':'authorized_sao_maintenance'}
    if a.action=='console':request['command']=a.command
    print(json.dumps(base.submit(c,request)))

if __name__=='__main__':main()
