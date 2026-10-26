import {parseArgs} from 'node:util';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {runAgentAccess} from './agent-register.mjs';
import {importAccount} from './import-account.mjs';
import {verifyBundle} from './setup.mjs';

export async function joinSkill(args){
  verifyBundle();
  const{values}=parseArgs({args,options:{username:{type:'string'},'invite-url-file':{type:'string'},'invite-file':{type:'string'},portal:{type:'string'},'identity-file':{type:'string'},profile:{type:'string'},'skip-install':{type:'boolean'},'npm-cli':{type:'string'}}});
  if(!/^ag_[A-Za-z0-9_]{1,13}$/.test(values.username??''))throw Error('NEW_AGENT_USERNAME_REQUIRED');
  const file=resolve(values['identity-file']??join(homedir(),'.qiandengji','identities',values.username+'.json'));
  const register=['--username',values.username,'--identity-file',file];
  for(const key of ['invite-url-file','invite-file','portal'])if(values[key])register.push('--'+key,values[key]);
  let status;const code=await runAgentAccess(['join',...register],line=>{status=JSON.parse(line);});
  if(code||status?.state!=='ready'||!status.gameAccountCreated)return status;
  const result=await importAccount(['--identity-file',file,...(values.profile?['--profile',values.profile]:[]),...(values['skip-install']?['--skip-install']:[]),...(values['npm-cli']?['--npm-cli',values['npm-cli']]:[])]);
  return{...result,state:result.dependenciesReady?'ready':'awaiting_dependencies',accountState:'ready',gameAccountCreated:true,identityFile:file,
    nextAction:result.dependenciesReady?'将mcp.json合并进自己的Agent宿主；调用mc_connection connect，等待MC_AUTH_SUCCESS和可用PLAY世界。':result.nextAction,gameConnected:false,modelCalled:false};
}
