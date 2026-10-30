"""Apply reviewed SAO public configuration while both game services are cold.

Does not start a process, alter the router, or overwrite the old deployment.
"""
from pathlib import Path
import argparse, importlib.util, json, re, shutil
from migrate_mixauth import migrate
from prepare_bridge import prepare
from stage_public import freeze

def cutover(root,source,work):
 root,source,work=map(lambda p:Path(p).resolve(),(root,source,work))
 if root!=Path('E:/MC/servers/sao-0.76.1').resolve():raise ValueError('explicit_new_sao_root_required')
 for deployment in [root,Path('E:/MC/servers/tau-ceti-1.3.3')]:
  health=json.loads((deployment/'ops/runtime/health.json').read_text())
  if any(row.get('pid')for row in health['services'])or not health.get('shutdownRequested'):raise ValueError('both_services_must_be_normally_stopped')
 verified=Path('E:/MC/backups/sao-public-cutover-20261030/sao-candidate-cold-121806.verified.json')
 if not json.loads(verified.read_text()).get('fullContentVerified'):raise ValueError('verified_new_candidate_cold_backup_required')
 report=root/'ops/public-cutover-prepared.json'
 if report.exists():raise ValueError('already_prepared_reconcile_existing_report')
 gw=root/'ops/gateway';destination=gw/'integrations/sao-compat'
 for name in ['sao_bot.cjs','native_registry.cjs']:shutil.copy2(source/name,destination/name)
 for dest in [gw/'public',destination/'public']:
  shutil.copytree(source/'public',dest,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
 for name in ['sao_service.py','publish_assets.py','bedrock_health.py','listener_policy.py']:shutil.copy2(source/'public'/name,root/'ops/service-tools'/name)
 bridge=prepare(root,'E:/MC/servers/fom-2.42/ops/bedrock-twilight-20261023-v1',work/'bedrock-icons',public=True)
 auth=migrate(root,work/'private/tau-auth.csv');(root/'ops/auth-migration.json').write_text(json.dumps(auth,indent=2))
 config=json.loads((root/'ops/service.json').read_text());config.update(publicGameAccess=True,bedrockEnabled=True);config.pop('privateOfflineBedrockQA',None);(root/'ops/service.json').write_text(json.dumps(config,indent=2))
 for name,port in [('java_front',28976),('agent_front',28977)]:
  f=root/'ops'/('front-'+name+'.json');value=json.loads(f.read_text());value.update(host='0.0.0.0',port=port);f.write_text(json.dumps(value,indent=2))
 p=root/'server/server.properties';text=p.read_text(encoding='utf-8');text=re.sub(r'(?m)^max-players=.*$','max-players=20',text);text=re.sub(r'(?m)^motd=.*$','motd=My Agent World SAO 0.76.1-lite | Java + Agent + Bedrock',text);p.write_text(text,encoding='utf-8')
 p=root/'server/user_jvm_args.txt';text=p.read_text();text=re.sub(r'(?m)^-Xms.*$','-Xms2G',text);text=re.sub(r'(?m)^-Xmx.*$','-Xmx6G',text);p.write_text(text)
 p=root/'server/config/voicechat/voicechat-server.properties';text=p.read_text();text=re.sub(r'(?m)^port=.*$','port=28989',text);text=re.sub(r'(?m)^bind_address=.*$','bind_address=0.0.0.0',text);p.write_text(text)
 p=root/'pack-source.json';marker=json.loads(p.read_text());marker.update(networkExposure='public',managedPublicPorts={'javaTcp':28976,'agentTcp':28977,'bedrockUdp':28988,'voiceUdp':28989});p.write_text(json.dumps(marker,indent=2))
 frozen=freeze(root)
 result={'schemaVersion':1,'root':str(root),'publicPorts':marker['managedPublicPorts'],'bedrock':bridge,'authentication':auth,'frozenFiles':frozen,'oldWorldRetained':True,'paperModified':False,'started':False}
 report.write_text(json.dumps(result,indent=2));return result
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--source',required=True);p.add_argument('--work',required=True);a=p.parse_args();print(json.dumps(cutover(a.root,a.source,a.work)))
