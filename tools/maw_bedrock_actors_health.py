"""Read-only health for the deployed Bedrock actor presentation pipeline."""
from pathlib import Path
import hashlib,json,time
from urllib.request import urlopen
import maw_bedrock_modpacks as models
ROOT=Path(r'E:\QiandengJiSocietyLab')
def health(root=ROOT):
    report={'schemaVersion':1,'checks':{},'actualPhoneTested':False,'paidModelCalls':0,'ok':False}
    try:
        directory=root/'bedrock/plugins/Geyser';contract=models.validate(directory,deployed=True)
        native=json.loads((root/'build/society-bridge/build-record.json').read_bytes())
        main=json.load(urlopen('http://127.0.0.1:28985/healthz',timeout=4));bridge=json.load(urlopen('http://127.0.0.1:28996/healthz',timeout=4))
        row=next(r for r in bridge['services'] if r['id']=='bedrock')
        registered=models.registered_models(root/'bedrock/ops/logs/bedrock.log',contract,time.time()-row['uptimeSeconds']-5)
        checks=report['checks'];checks['supervised-services']=main['healthy'] and bridge['healthy'] and not main['paused'] and not bridge['paused']
        checks['actor-extension-registered']=registered.get('actorAnimationVersion')==1
        checks['all-native-models-animated']=contract.get('animationVersion')==1 and contract['animatedModelCount']==contract['modelCount']>0
        checks['server-actor-producer-matches-packs']=all(native['sources'].get(p)==h for p,h in contract['inputs']['actorBridgeSources'].items())
        checks['installed-native-bridge-matches-build']=hashlib.sha256((root/'server/mods/maw_agent_bridge-0.1.0.jar').read_bytes()).hexdigest()==native['sha256']
        checks['locked-maid-api']=native['maidSha256']==models.TLM_SHA
        checks['public-display-only-budget']=contract.get('actorProtocol')=={'channel':'maw_agent:scene_state','hz':4,'maxActors':24,'radius':32,'nativeMaidBubbles':True,'playerPublicChat':True,'privateChatBubbles':False}
        if contract.get('voiceVersion') == 1:
            import maw_bedrock_voices as voices
            checks['original-maid-voices-registered']=registered.get('voiceVersion')==1
            checks['native-voice-audience-and-codec']=contract.get('voiceProtocol')=={
                'channels':voices.CHANNELS,'configChannel':'mawbedrock:voice_config',
                'maidMetadata':{'soundPack':24,'soundFrequency':50,'silent':4},
                'originalAudience':True,'synthesizedSpeech':False}
            checks['voice-source-matches-installed-maid']=hashlib.sha256((root/'server/mods/touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar').read_bytes()).hexdigest()==voices.TLM_SHA
            report['voices']=contract['voices']
        report['counts']={k:contract[k] for k in ('modelCount','animatedModelCount','nativeClipCount')};report['ok']=all(checks.values())
    except Exception as e:report['reason']=f'{type(e).__name__}: {e}'
    return report
if __name__=='__main__':
    value=health();print(json.dumps(value,ensure_ascii=False));raise SystemExit(0 if value['ok'] else 1)
