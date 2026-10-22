import {readFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import {verifyBundle,SKILL_ROOT,loadProfile} from './setup.mjs';
import {readSecret} from './private.mjs';

export function ownAuthenticatedState(value,username,playerUuid) {
  if(!value||typeof value!=='object'||Array.isArray(value)||value.authorized!==true||value.status!=='authenticated')return null;
  // LoginGuard identifies the body by the connection and playerUuid; its
  // normal receipt omits username. Reject an explicit conflicting identity.
  if(value.username!==undefined && value.username!==username)return null;
  const uuid=text=>typeof text==='string'?text.replaceAll('-','').toLowerCase():null;
  if(value.playerUuid!==undefined && (typeof value.playerUuid!=='string' || (playerUuid && uuid(value.playerUuid)!==uuid(playerUuid))))return null;
  return value;
}

export async function enroll(directory) {
  verifyBundle();
  const {config}=loadProfile(directory),world=config.world;
  const login=JSON.parse(readFileSync(world.loginConfigFile,'utf8'));
  const accounts=login.accounts?.filter(a=>a.username===world.username && a.server===`${world.host}:${world.port}`);
  if(login.enabled!==true||accounts?.length!==1)throw Error('private_account_binding_mismatch');
  const account=accounts[0];
  const runtime=join(SKILL_ROOT,'assets/runtime'),require=createRequire(join(runtime,'package.json'));
  const sdkRoot=dirname(require.resolve('agent-mc-world/package.json'));
  // Locked 0.4.0 helper; same connection lease and private login implementation
  // as the packaged SDK. No separate game body may use this profile concurrently.
  const {AgentConnectionLease}=await import(pathToFileURL(join(sdkRoot,'dist/runtime/src/client/connection-lease.js')));
  const {installServerLogin}=await import(pathToFileURL(join(sdkRoot,'dist/runtime/core/server-login.mjs')));
  const {pauseDuringConfiguration}=await import(pathToFileURL(join(runtime,'qiandengji/configuration.mjs')));
  const lease=new AgentConnectionLease(config.dataDir,'enroll-'+randomUUID());
  let bot,gate,secret,ended=false,failure=null,state=null,registered=false,inPaper=false;
  try {
    lease.acquire();
    secret=readSecret(account.credentialFile,account.credentialFormat);
    bot=require('mineflayer').createBot({host:world.host,port:world.port,username:world.username,auth:'offline',version:'1.21.1',hideErrors:true,logErrors:false,checkTimeoutInterval:180000});
    pauseDuringConfiguration(bot);
    gate=installServerLogin(bot,{server:`${world.host}:${world.port}`,username:world.username,configFile:world.loginConfigFile,
      report:status=>{if(status.status==='blocked')failure='game_authentication_rejected';}});
    bot.on('error',()=>{failure='game_connection_error';});bot.on('kicked',()=>{failure='game_connection_rejected';});bot.on('end',()=>{ended=true;});
    bot.on('message',(message,position)=>{
      if(position!=='system')return;
      const text=message.toString().replace(/§[0-9a-fk-or]/gi,'').trim();
      if(/^(?:\[MC_AUTH_SUCCESS\]|MC_AUTH_SUCCESS)(?:\s|$)/.test(text))inPaper=true;
      const match=/^(?:\[MC_AUTH_STATE\]|MC_AUTH_STATE)\s+(\{.*\})$/.exec(text);
      if(!match)return;
      try {const value=ownAuthenticatedState(JSON.parse(match[1]),world.username,bot._client.uuid);if(value)state=value;}catch{}
    });
    const deadline=Date.now()+135000;
    while((!gate.ready()||!inPaper||bot._client.state!=='play')&&!failure&&!ended&&Date.now()<deadline)await delay(100);
    if(failure||ended||!gate.ready()||!inPaper||bot._client.state!=='play')throw Error(failure??'game_login_not_confirmed');
    await delay(1500);state=null;bot.chat('/authstatus');
    for(let i=0;i<50&&!state&&!failure&&!ended;i++)await delay(100);
    if(!state||failure||ended)throw Error('own_account_state_not_confirmed');
    if(state.passwordSet===false){
      bot.chat('/register '+secret.toString('utf8')+' '+secret.toString('utf8'));registered=true;state=null;
      // Password hashing is asynchronous on the proxy. Re-query only the
      // status, never repeat registration if the first result is delayed.
      for(let attempt=0;attempt<10&&state?.passwordSet!==true&&!failure&&!ended;attempt++) {
        await delay(1500);if(ended||failure)break;bot.chat('/authstatus');
        for(let i=0;i<10&&state?.passwordSet!==true&&!failure&&!ended;i++)await delay(100);
      }
    }
    if(state?.passwordSet!==true||failure||ended)throw Error('registration_outcome_unknown_do_not_repeat');
    return {username:world.username,authenticated:true,passwordSet:true,registeredNow:registered,credentialPrinted:false,modelCalled:false};
  }finally{
    secret?.fill(0);gate?.stop();
    if(bot){try{bot.quit('账号接入检查完成');}catch{}for(let i=0;i<50&&!ended;i++)await delay(100);}
    lease.release();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [command,...rest]=process.argv.slice(2);const {values}=parseArgs({args:rest,options:{profile:{type:'string'}}});
  if(command!=='enroll'||!values.profile)throw Error('usage_account_enroll_profile');
  console.log(JSON.stringify(await enroll(values.profile),null,2));
 }catch(error){console.error(JSON.stringify({error:error instanceof Error?error.message:'account_check_failed'}));process.exitCode=1;}
}
