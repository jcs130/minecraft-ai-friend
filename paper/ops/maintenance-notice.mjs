// Operator-run notices: prepare the release first; send completion only after verification.
import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {command} from './rcon-client.mjs';

export function messages(plan,phase,remaining=0){
 if(!/^[a-z0-9-]{8,80}$/.test(plan.id)||!/^\d+(?:\.\d+){2,3}$/.test(plan.version))throw Error('Invalid release identity');
 if(!['before','updated','cancelled'].includes(phase)||!Number.isInteger(remaining)||remaining<0||remaining>3600)throw Error('Invalid notice phase or countdown');
 if(!Array.isArray(plan.releaseNotes)||!plan.releaseNotes.length||plan.releaseNotes.length>6||plan.releaseNotes.some(s=>typeof s!=='string'||s.length>140||/[\x00-\x1f\x7f§]/.test(s)))throw Error('Invalid short release notes');
 const heading=phase==='before'?`[维护预告] ${remaining>=60?Math.ceil(remaining/60)+'分钟':remaining+'秒'}后更新重启至 ${plan.version}。请回到安全处，结束当前操作，暂勿开启新副本。`:
  phase==='updated'?`[版本更新 ${plan.version}] 更新和启动检查已完成，可以重新连接。`:'[维护取消] 本次重启已取消；请等待新的维护通知。';
 const lines=[heading,...(phase==='updated'?plan.releaseNotes:[])];
 // Public chat is shared world context for every Agent. Keep machine receipts
 // in the operator journal; publishing raw JSON here pollutes unrelated Agents'
 // observations and the spectators' chat. Short Chinese notices remain public.
 return lines.map(text=>'minecraft:tellraw @a '+JSON.stringify({text,color:phase==='before'?'yellow':phase==='updated'?'green':'gold'}));
}
async function main(){
 const [file,phase,raw='0']=process.argv.slice(2),plan=JSON.parse(readFileSync(file,'utf8')),remaining=Number(raw);
 const commands=messages(plan,phase,remaining);
 const version=await command('version AgentFriend',15000);
 if(phase==='updated'&&!version.includes('version §a'+plan.version)&&!version.includes('version '+plan.version))throw Error('Completion notice requires verified running version');
 const journal=file+'.notices.jsonl';
 appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),phase,remaining,status:'planned',releaseId:plan.id,version:plan.version,commands:commands.length})+'\n');
 for(const q of commands){appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),phase,remaining,status:'sending',command:q})+'\n');const response=await command(q,15000);appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),phase,remaining,status:'acknowledged',response})+'\n');}
 console.log(JSON.stringify({phase,remaining,commands:commands.length,version:plan.version}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
