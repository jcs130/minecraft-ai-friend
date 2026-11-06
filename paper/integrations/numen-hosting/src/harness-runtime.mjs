import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openCoreRpc} from './core-rpc.mjs';
import {fail} from './protocol.mjs';

// Process assembly only: the existing autonomy package owns all decisions,
// context and action scheduling; the existing Hub adapter selects the model.
export function harnessRuntime({python,autonomySource,plannerModule,plannerSha256,dataRoot,settings,planner,goal,checkControl,environment={},configurationFor,onProblem=()=>{}}){
  const workers=new Map();
  const key=role=>`${role.serverId}/${role.roleUuid}`;
  const stop=async record=>{
    if(record.exited){await record.rpc.close();return{stopped:true};}
    record.child.stdin.write('{"stop":true}\n');record.child.stdin.end();
    // Never kill an unverified process or call an unknown stop successful.
    const ended=await Promise.race([record.exit.then(()=>true),new Promise(r=>setTimeout(()=>r(false),10000))]);
    if(!ended)return{stopped:false};
    await record.rpc.close();return{stopped:true};
  };
  return{
    async check(){if(!python||!autonomySource||!plannerModule||!plannerSha256||(!goal&&!configurationFor))throw fail('HARNESS_CONFIGURATION_INCOMPLETE','请由服务端配置现有 Harness、MC 核心及目标。',503);},
    async start({role,epoch,client}){
      const id=key(role);if(workers.has(id))throw fail('HARNESS_ALREADY_RUNNING','先确认原调度进程已退出。');
      const selected=configurationFor?await configurationFor(role):{settings,planner,goal,environment};
      const roleRoot=resolve(dataRoot,'roles',createHash('sha256').update(JSON.stringify([role.serverId,role.roleUuid,role.ownerId])).digest('hex'));
      await mkdir(roleRoot,{recursive:true});
      const baseEnvironment={};for(const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData','COMSPEC'])if(process.env[name])baseEnvironment[name]=process.env[name];
      const rpc=await openCoreRpc(client,{check:()=>checkControl(role,epoch)});
      const child=spawn(python,['-X','utf8',fileURLToPath(new URL('../hosted_harness.py',import.meta.url))],
        {windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...baseEnvironment,...selected.environment}});
      const record={child,rpc,exited:false};workers.set(id,record);
      record.exit=new Promise(resolve=>{child.once('exit',()=>{record.exited=true;resolve();});child.once('error',()=>{record.exited=true;resolve();});});
      const ready=new Promise((resolve,reject)=>{
        let buffer='';child.stdout.on('data',bytes=>{
          buffer+=bytes.toString();if(buffer.length>8192){reject(fail('HARNESS_PROTOCOL_INVALID','调度进程的状态消息过长。'));return;}
          for(let end;(end=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
            try{const value=JSON.parse(line);if(value.ready===true)resolve();else if(value.error){onProblem({type:value.error,frames:value.frames});reject(fail('HARNESS_START_FAILED','调度进程未就绪，检查私有运行记录。'));}}catch{reject(fail('HARNESS_PROTOCOL_INVALID','调度进程返回了未知状态。'));}}
        });
        record.exit.then(()=>reject(fail('HARNESS_EXITED','调度进程已退出，请检查运行状态。')));
      });
      // Never copy raw model errors or credentials into a browser response.
      child.stderr.resume();
      const config={autonomySource:resolve(autonomySource),plannerModule:resolve(plannerModule),plannerSha256,
        dataRoot:roleRoot,settings:selected.settings,planner:selected.planner,goal:selected.goal,role,core:{endpoint:rpc.endpoint,token:rpc.token}};
      child.stdin.write(JSON.stringify(config)+'\n');
      let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('HARNESS_START_UNKNOWN','调度进程未确认就绪；先停止并核对。')),30000);})]);}
      finally{clearTimeout(timer);}
      return{alive:()=>!record.exited,async stop(){const result=await stop(record);if(result.stopped)workers.delete(id);return result;}};
    },
    async stopUnknown({role}){const id=key(role),record=workers.get(id);if(!record)return{stopped:true};const result=await stop(record);if(result.stopped)workers.delete(id);return result;}
  };
}
