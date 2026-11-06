/* Website-only controls. Key inputs are never read back or put in storage/URLs. */
(() => {
  let dispose=()=>{};
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  function selectRows(select,rows,value){select.replaceChildren(...rows.map(row=>{const el=node('option',row.label??row.id);el.value=row.id;return el;}));if(rows.some(row=>row.id===value))select.value=value;}
  window.QdHosting={dispose(){dispose();dispose=()=>{};},mount({api,state,root}) {
    if(!root||!state.site?.hosting?.enabled||!state.session?.owner||!['agents','live'].includes(state.view))return;
    let closed=false,recorder=null,recordPending=false,pollTimer=null,objectUrl=null,version=0;
    const panel=node('section',undefined,'panel hosted-panel'),status=node('p','','hosted-status');status.setAttribute('role','status');
    const say=text=>{if(!closed)status.textContent=text;};
    const button=(label,action)=>{const el=node('button',label,'btn');el.type='button';el.onclick=()=>Promise.resolve().then(action).catch(error=>say(error.message));return el;};
    dispose=()=>{closed=true;version++;clearTimeout(pollTimer);void recorder?.cancel();panel.querySelectorAll('input[type=password]').forEach(el=>el.value='');panel.querySelector('audio')?.pause();if(objectUrl)URL.revokeObjectURL(objectUrl);panel.remove();};
    if(state.view==='agents') {
      const roles=state.authorized.filter(row=>row.isOwn&&!row.isReserved&&!row.historical);
      if(!roles.length)return;
      panel.append(node('h2','服务器托管'),node('p','用自己的 API Key，让角色在服务器持续行动。可选择 Numen 原生循环或已接通的 Harness；网页接管和原客户端沿用同一角色。'));
      const picker=node('select');picker.setAttribute('aria-label','选择托管角色');selectRows(picker,roles.map(row=>({id:row.id,label:row.name})));
      const form=node('form'),grid=node('div',undefined,'hosted-grid');form.append(grid);
      const field=(label,el,wide=false)=>{const wrap=node('label',label,wide?'hosted-wide':'');wrap.append(el);grid.append(wrap);return el;};
      const harness=field('运行方式',node('select')),provider=field('模型供应商',node('select')),model=field('模型',node('select'));
      const key=field('API Key（只填写新密钥；留空保留已保存的密钥）',node('input'));key.type='password';key.autocomplete='new-password';key.spellcheck=false;
      const goal=field('希望 Agent 做什么',node('textarea'),true);goal.maxLength=4000;
      const remove=field('删除已保存的 Key',node('input'));remove.type='checkbox';remove.style.width='auto';
      let loaded=null,busy=false;
      const actions=node('div',undefined,'hosted-actions');
      const saved=node('small','尚未加载配置');
      const runtimeMessage=value=>{
        const messages={MODEL_API_KEY_REJECTED:'模型拒绝了你的 API Key，已暂停。请更换 Key 后保存再启动。',MODEL_QUOTA_OR_RATE_LIMIT:'模型额度不足或被限流，已暂停。请检查自己的模型账户后再启动。',MODEL_CALL_FAILED:'模型调用失败，已暂停。请检查供应商、所选模型和网络。',HARNESS_EXITED:'Harness 已退出，角色已暂停。请检查模型配置后重新启动。'};
        return messages[value?.problem]??`当前状态：${({numen:'Numen 托管',harness:'Harness 托管',paused:'已暂停'})[value?.mode]??'尚未接入'}${value?.problem?'；'+value.problem:''}`;
      };
      const inspect=button('检查状态',async()=>{const result=await api(`/agents/${picker.value}/hosting`);say(runtimeMessage(result.status));});
      const save=button('保存设置',async()=>{
        if(!loaded||busy)return;busy=true;save.disabled=true;
        const profile={revision:loaded.profile.revision,harness:harness.value,provider:provider.value,model:model.value,goal:goal.value,
          ...(key.value?{apiKey:key.value}:{}),...(remove.checked?{removeKey:true}:{})};key.value='';
        const selected=picker.value,token=version;
        try{await api(`/agents/${selected}/hosting`,{method:'PUT',body:JSON.stringify(profile)});if(!closed&&token===version){say('配置已保存。启动前请核对所选模型和调用费用。');await load();}}
        finally{profile.apiKey='';busy=false;if(!closed)save.disabled=false;}
      });
      const start=button('启动托管',async()=>{
        if(!loaded||busy)return;const selected=loaded.catalogue.harnesses.find(h=>h.id===loaded.profile.harness);
        if(!selected?.available||!loaded.profile.keyConfigured)throw Error('请先保存自己的 API Key，并选择已接通的运行方式。');
        busy=true;start.disabled=true;try{const value=await api(`/agents/${picker.value}/hosting/mode`,{method:'POST',body:JSON.stringify({mode:selected.mode,runtime:selected.id})});say(value.state==='ready'?'托管已启动。':'正在确认托管状态，请稍后查看。');}finally{busy=false;if(!closed)start.disabled=false;}
      });
      const pause=button('暂停托管',async()=>{const value=await api(`/agents/${picker.value}/hosting/mode`,{method:'POST',body:JSON.stringify({mode:'paused'})});say(value.mode==='paused'?'已暂停托管，可以修改设置。':'暂停结果待确认。');});
      const release=button('退出托管，回到原客户端',async()=>{const value=await api(`/agents/${picker.value}/hosting/release`,{method:'POST',body:'{}'});say(value.state==='detached'?'角色已保存并下线，现在可从原客户端连接；网页中已保存的模型设置保留。':'退出结果待确认，请先检查状态。');});
      form.addEventListener('input',()=>{start.disabled=true;});form.addEventListener('change',()=>{start.disabled=true;});
      const updateModels=value=>{const p=loaded.catalogue.providers.find(p=>p.id===provider.value);selectRows(model,p?.models??[],value);};
      const updateProviders=(p,m)=>{const h=loaded.catalogue.harnesses.find(h=>h.id===harness.value);selectRows(provider,loaded.catalogue.providers.filter(p=>h?.providers.includes(p.id)),p);updateModels(m);saved.textContent=(loaded.profile.keyConfigured?'已保存密钥，不向网页回传。':'尚未配置自己的 API Key。')+(h?.reason?' '+h.reason:'');};
      harness.onchange=()=>{key.value='';updateProviders();};provider.onchange=()=>{key.value='';updateModels();};
      async function load(){const token=++version;key.value='';remove.checked=false;loaded=null;save.disabled=start.disabled=true;
        try{const result=await api(`/agents/${picker.value}/hosting`);if(closed||token!==version)return;loaded=result;selectRows(harness,result.catalogue.harnesses,result.profile.harness);updateProviders(result.profile.provider,result.profile.model);goal.value=result.profile.goal??'先查询 /mycli help 和 /mycli status，按当前职业、技能和副本说明行动。准备好护甲、武器和补给，与伙伴组队探索、接冒险委托、攻略副本；失败先读具体指引，不重复空转。';save.disabled=false;start.disabled=!result.profile.keyConfigured||!result.catalogue.harnesses.find(h=>h.id===result.profile.harness)?.available;}
        catch(error){say(error.message);}}
      picker.onchange=()=>void load();form.onsubmit=event=>{event.preventDefault();save.click();};actions.append(save,start,pause,release,inspect);form.append(saved,actions);
      panel.append(picker,form,status);root.insertBefore(panel,root.children[1]??null);void load();
    }else {
      const channel=state.channels.find(row=>row.id===state.selectedChannel);if(!channel?.managed)return;
      const path=`/live/${channel.id}/conversation`;
      panel.append(node('h2',`和 ${channel.playerName} 聊聊`),node('p','直接给这位 Agent 留言或说话。消息不会接管它的行动；Agent 会在安全间隙读取，游戏中的回复可能公开。'));
      const list=node('div',undefined,'hosted-chat-list');list.setAttribute('aria-label','观战对话');
      const input=node('textarea');input.maxLength=1200;input.placeholder='问问它正在做什么，或约它一起冒险…';input.setAttribute('aria-label','发给 Agent 的话');
      const actions=node('div',undefined,'hosted-actions'),audio=node('audio');audio.controls=true;audio.hidden=true;
      let messageId=null,submittedText='',sending=false,recordId=null;
      const send=button('发送',async()=>{
        if(sending)return;const text=input.value.trim();if(!text)throw Error('先写一句话，或录音转成文字。');
        if(text!==submittedText||!messageId){messageId=crypto.randomUUID();submittedText=text;}
        const id=messageId;sending=true;send.disabled=true;
        try{const value=await api(path+'/messages',{method:'POST',body:JSON.stringify({id,text})});if(closed)return;say(value.message??value.state);if(value.state==='delivered'){input.value='';messageId=null;submittedText='';}await refresh();}
        finally{sending=false;if(!closed)send.disabled=false;}
      });
      const record=button('语音输入',async()=>{
        if(recordPending)return;
        if(recorder){await finishRecording();return;}
        recordPending=true;record.disabled=true;
        try{const {recordVoice}=await import('/hosting-recorder.mjs');const value=await recordVoice(()=>void finishRecording().catch(e=>say(e.message)));
          if(closed){await value.cancel();return;}recorder=value;recordId=crypto.randomUUID();record.textContent='结束录音';say('正在录音，最长 30 秒。结束后可检查文字再发送。');}
        finally{recordPending=false;if(!closed)record.disabled=false;}
      });
      async function finishRecording(){if(!recorder)return;const current=recorder;recorder=null;record.disabled=true;record.textContent='正在识别…';
        try{const audio=await current.stop();if(closed)return;const value=await api(path+'/transcribe',{method:'POST',body:JSON.stringify({id:recordId,audio})});if(closed)return;input.value=value.text??'';say(value.text?'已识别，请检查文字后点发送。':'未识别到说话声，请重录。');}
        finally{if(!closed){record.disabled=false;record.textContent='语音输入';}}}
      async function speak(reply){say('正在准备语音…');const value=await api(path+'/speech',{method:'POST',body:JSON.stringify({id:reply.id})});if(closed)return;
        if(objectUrl)URL.revokeObjectURL(objectUrl);const bytes=Uint8Array.from(atob(value.audio),x=>x.charCodeAt(0));objectUrl=URL.createObjectURL(new Blob([bytes],{type:value.mime}));audio.src=objectUrl;audio.hidden=false;
        try{await audio.play();say('正在朗读游戏回复。');}catch{say('语音已准备好，请点播放器播放。');}}
      async function refresh(){if(closed)return;clearTimeout(pollTimer);
        try{if(document.visibilityState==='hidden')return;const result=await api(path);if(closed)return;
          list.replaceChildren();for(const message of result.messages??[]){const row=node('div',message.text,'hosted-chat-row mine');row.append(node('small',({delivered:'已送达，等待 Agent 回复',sending:'正在发送',unknown:'送达结果待确认'})[message.state]??message.state));
            if(message.state==='unknown')row.append(button('查询送达状态',async()=>{const value=await api(path+'/result',{method:'POST',body:JSON.stringify({id:message.id})});say(value.state==='delivered'?'已确认送达。':'仍未确认；不会自动重复发送。');await refresh();}));list.append(row);}
          for(const reply of (result.replies??[]).slice().sort((a,b)=>(a.createdAt??0)-(b.createdAt??0))){const row=node('div',reply.body,'hosted-chat-row');row.append(node('small',`${channel.playerName} · ${reply.source==='numen.hosted-speech'?'托管回复':'游戏内公开发言'}`),button('朗读',()=>speak(reply)));list.append(row);}
        }catch(error){say(error.message);}finally{if(!closed)pollTimer=setTimeout(()=>void refresh(),10000);}}
      actions.append(send,record);panel.append(list,input,actions,audio,status);root.append(panel);void refresh();
    }
  }};
})();
