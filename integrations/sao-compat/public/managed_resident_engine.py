"""Generate an explicitly pinned resident extension without changing shared core."""
from pathlib import Path
import hashlib,json,re,shutil

def configure(root,source):
 root,source=Path(root).resolve(),Path(source).resolve();runtime=root/'kirito-runtime';private=runtime/'private-auth';private.mkdir(exist_ok=True)
 hashes={}
 for name in ['private-login.cjs','game_login_broker.py']:
  shutil.copy2(source/name,private/name);hashes[name]=hashlib.sha256((private/name).read_bytes()).hexdigest()
 parameters={'root':str(root),'packageDirectory':str(runtime/'core'),'adapterDirectory':str(runtime/'adapter/integrations/sao-compat')}
 auth={'python':'C:/Users/lzl19/.qwenpaw/venv-2.2.2-20261016/Scripts/python.exe','broker':str(private/'game_login_broker.py'),'brokerSha256':hashes['game_login_broker.py'],'root':str(root),'username':'ag_Kirito'}
 code="""import {createSAOEnginePort} from './adapter/integrations/sao-compat/sao-engine.mjs';
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),options=PARAMETERS;
if(createHash('sha256').update(readFileSync(new URL('./private-auth/private-login.cjs',import.meta.url))).digest('hex')!==HELPER_HASH)throw Error('private_authenticator_code_changed');
const {createPrivateAuthenticator}=require('./private-auth/private-login.cjs');
const authenticate=createPrivateAuthenticator(AUTHENTICATION);
const port=await createSAOEnginePort(options),{createSAOBot}=require('./adapter/integrations/sao-compat/sao_bot.cjs');
export class EngineBridge extends port.EngineBridge {createBot(botOptions){return createSAOBot({root:options.root,username:botOptions.username,botOptions,authenticate})}}
export class EngineWorld extends port.EngineWorld {createBridge(options){return new EngineBridge(options)}}
export const SERVER_TOOLS=port.SERVER_TOOLS,createEngine=options=>new EngineWorld(options);
""".replace('PARAMETERS',json.dumps(parameters)).replace('HELPER_HASH',json.dumps(hashes['private-login.cjs'])).replace('AUTHENTICATION',json.dumps(auth))
 (runtime/'engine.mjs').write_text(code,encoding='utf-8');engine_sha=hashlib.sha256((runtime/'engine.mjs').read_bytes()).hexdigest()
 config=(runtime/'config.toml').read_text();config=re.sub(r'engine_sha256 = "[a-f0-9]+"','engine_sha256 = "'+engine_sha+'"',config);(runtime/'config.toml').write_text(config)
 composition=json.loads((runtime/'composition.json').read_text());composition.update(engineSha256=engine_sha,privateLoginBrokerFiles=hashes,environmentAllowlistPreserved=True);(runtime/'composition.json').write_text(json.dumps(composition,indent=2))
 return {'engineSha256':engine_sha,'privateBrokerPinned':True,'coreModified':False,'credentialStoredInEngine':False}
if __name__=='__main__':print(json.dumps(configure('E:/MC/servers/sao-0.76.1',Path(__file__).parent)))
