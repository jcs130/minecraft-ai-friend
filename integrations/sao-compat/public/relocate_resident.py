"""Copy the normally stopped SAO resident, preserving its local memory/ledger.

The new realm is the same cold-copied SAO world. No Paper or Cormy personal
information is imported. This script never starts inference or changes a goal.
"""
from pathlib import Path
import hashlib, json, re, shutil, os

def extended(p):return Path('\\\\?\\'+str(Path(p).resolve()))if os.name=='nt'else Path(p)

def relocate(root,source):
 root,source=Path(root).resolve(),Path(source).resolve();old=Path('E:/MC/research/sao-0.76.1-agent-20261029');origin=old/'kirito-runtime';dest=root/'kirito-runtime'
 if root!=Path('E:/MC/servers/sao-0.76.1').resolve():raise ValueError('owned_resident_destination_required')
 pending=root/'ops/resident-relocation.pending.json';identity={'source':str(origin),'destination':str(dest),'scope':'stopped_sao_resident_relocation'}
 if dest.exists()and(not pending.exists()or json.loads(pending.read_text())!=identity):raise ValueError('existing_resident_requires_exact_pending_record')
 state=json.loads(Path('E:/MC/research/sao-public-20261030/old-kirito-stop-status.log').read_text(encoding='utf-8-sig'))
 if state.get('phase')!='stopped'or state.get('pending')or state.get('inflight')or state.get('disconnect_confirmed')is not True:raise ValueError('normally_stopped_old_resident_required')
 pending.write_text(json.dumps(identity));dest.mkdir(exist_ok=True)
 for name in ['.venv','adapter','core','data']:shutil.copytree(extended(origin/name),extended(dest/name),dirs_exist_ok=True)
 for name in ['config.toml','engine.mjs','composition.json','goal.txt']:shutil.copy2(origin/name,dest/name)
 adapter=dest/'adapter/integrations/sao-compat'
 for name in ['sao_bot.cjs','native_registry.cjs']:shutil.copy2(source/name,adapter/name)
 engine="import {createSAOEnginePort} from './adapter/integrations/sao-compat/sao-engine.mjs';\nexport const {EngineBridge,EngineWorld,SERVER_TOOLS,createEngine}=await createSAOEnginePort("+json.dumps({'root':str(root),'packageDirectory':str(dest/'core'),'adapterDirectory':str(adapter)})+");\n"
 (dest/'engine.mjs').write_text(engine,encoding='utf-8');engine_sha=hashlib.sha256((dest/'engine.mjs').read_bytes()).hexdigest()
 config=(dest/'config.toml').read_text();config=config.replace(str(old).replace('\\','\\\\'),str(root).replace('\\','\\\\'));config=re.sub(r'engine_sha256 = "[a-f0-9]+"','engine_sha256 = "'+engine_sha+'"',config);(dest/'config.toml').write_text(config)
 composition=json.loads((dest/'composition.json').read_text());composition.update(scope='managed_server',realm=str(root),engineSha256=engine_sha)
 for relative in composition['adapterFiles']:composition['adapterFiles'][relative]=hashlib.sha256((dest/'adapter'/relative).read_bytes()).hexdigest()
 composition['saoAddonSha256']=hashlib.sha256((root/'server/mods/maw-sao-native-0.1.0.jar').read_bytes()).hexdigest();(dest/'composition.json').write_text(json.dumps(composition,indent=2))
 memory_root=extended(origin/'data');memory_files=list(memory_root.rglob('*'));verified=0
 for p in memory_files:
  if p.is_file():
   q=extended(dest/'data')/p.relative_to(memory_root)
   if hashlib.sha256(p.read_bytes()).digest()!=hashlib.sha256(q.read_bytes()).digest():raise ValueError('resident_memory_copy_mismatch')
   verified+=1
 from managed_resident_engine import configure
 private_login=configure(root,source/'public')
 result={'root':str(root),'memoryFilesVerified':verified,'sameBody':'ag_Kirito','sameWorldCopied':True,'oldResidentRetained':True,'privateLogin':private_login,'started':False}
 (root/'ops/resident-relocation.json').write_text(json.dumps(result,indent=2));pending.unlink();return result
if __name__=='__main__':print(json.dumps(relocate('E:/MC/servers/sao-0.76.1',Path(__file__).resolve().parents[1])))
