// The QiandengJi fleet described as data for the generic control core.
// Everything Minecraft-specific about container control lives here.
import { defineTopology } from './fleet/control-core.mjs';

export const SERVICES = ['mc','world','gate','npc','resources','qwenpaw','voice','asr','panel','tts','control','survivor','inventory'];

export const QIANDENGJI = defineTopology({
  project:'qiandengji',
  serviceName:'qiandengji-control',
  containerName:id=>'qiandengji-'+id+'-1',
  services:SERVICES,
  // The panel must never be able to stop the executor running its own request.
  immutable:['control'],
  dependencies:{world:['mc'],gate:['mc'],npc:['mc','world'],voice:['tts'],survivor:['mc','qwenpaw']},
  startOrder:['tts','mc','world','gate','npc','qwenpaw','resources','voice','asr','panel','survivor','inventory'],
  healthGated:['mc'],
  lockFile:'.qiandengji-smoke.lock',
  refuseIfPresent:[{file:'.qiandengji-recorder-qa.json',error:'recorder_busy'}],
  preStop:[{
    service:'mc',planFlag:'saveMinecraft',name:'保存 Minecraft',
    // The world save must be acknowledged by Minecraft itself before the
    // container may stop; an unverified save risks losing player progress.
    run:async({engine,containerId})=>{
      const exec=await engine('POST','/containers/'+containerId+'/exec',{AttachStdout:true,AttachStderr:true,Cmd:['rcon-cli','save-all','flush']});
      if(!/^[a-f0-9]{64}$/.test(exec?.Id||''))throw new Error('save_not_acknowledged');
      const output=await engine('POST','/exec/'+exec.Id+'/start',{Detach:false,Tty:false},40000);
      const result=await engine('GET','/exec/'+exec.Id+'/json');
      if(result.ExitCode!==0||!(/Saved the (game|world)/.test(output)))throw new Error('save_not_acknowledged');
    },
  }],
  explanation:'仅操作列出的 D 盘现有容器；停止世界会先保存，已停用的依赖不会被暗中启动。',
});
