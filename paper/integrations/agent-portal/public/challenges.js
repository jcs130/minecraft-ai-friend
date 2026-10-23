'use strict';
window.QdChallenges=(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const levels={normal:'普通',adventure:'冒险',apocalypse:'末日'};
  const states={active:'挑战进行中',paused:'挑战暂停',completed:'完整通关',ended:'挑战结束',interrupted:'结果待核实'};
  const reasons={cleared:'全部楼层通关',completed:'全部房间与返程已完成',party_defeated:'全队倒下',timeout:'挑战超时',time_limit:'挑战超时',reconnect_timeout:'重连等待超时',party_outside_floor:'队伍离开本层',return_grace_expired:'离场或离线等待超时',advance_failed:'下一层进入失败',waiting_reconnect:'等待队友重连',observation_gap:'未观察到最终结算',data_unavailable:'运行数据异常，等待修复',runtime_error:'运行异常，等待修复',all_offline:'全队离线',all_outside_site:'全队离开挑战区域',player_left:'队员离开挑战'};
  let context,data=null,error=false,activity='trial_tower',difficulty='all',pageNumber=1,revision=0;
  function init(value){context=value;}
  async function load(redraw=true){
    if(!context)return;const version=++revision;
    try{const value=await context.api('/challenges?'+new URLSearchParams({activity,difficulty,page:String(pageNumber)}));if(version!==revision)return;data=value;error=false;}
    catch{if(version!==revision)return;error=true;}
    if(redraw&&location.hash==='#challenges')context.render();
  }
  const party=row=>row.party.map(n=>`<span class="challenge-member">${esc(n==='ag_CorMy'?'可米 · '+n:n==='LittleFish0510'?'小鱼 · '+n:n)}</span>`).join('')+(row.hiddenMembers?`<small>另有 ${esc(row.hiddenMembers)} 位未公开队员</small>`:'');
  const date=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'时间未记录';
  function progress(row,unit){return row.clearedUnits===null?`抵达第 ${esc(row.reachedUnits??'—')} ${unit} · 通关数未记录`:`已通关 ${esc(row.clearedUnits)} / ${esc(row.totalUnits)} ${unit}`;}
  function page(){
    const unit=esc(data?.activity?.unit||'层'),total=data?.activity?.totalUnits??'—';
    const catalogue=data?.activities||[];
    const groups=(data?.leaderboards||[]).map(group=>`<section class="panel challenge-ranking"><div class="panel-header"><h2><i class="challenge-level ${esc(group.difficulty)}"></i>${esc(group.label)}难度榜</h2><span class="tag">${esc(group.teams)} 支队伍</span></div>${group.rows.length?`<div class="table-scroll"><table><thead><tr><th>名次</th><th>挑战队伍</th><th>最高通关</th><th>网站积分</th><th>结算</th></tr></thead><tbody>${group.rows.map(row=>`<tr><td><span class="challenge-rank ${row.rank===1?'first':''}">${esc(row.rank)}</span></td><td><div class="challenge-party">${party(row)}</div></td><td><strong>${esc(row.clearedUnits)}</strong><span class="muted"> / ${esc(row.totalUnits)} ${unit}</span></td><td><strong class="challenge-points">${esc(row.score)}</strong></td><td><span class="challenge-badge ${row.state==='completed'?'success':''}">${row.state==='completed'?'完整通关':'阶段成绩'}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="challenge-empty">这个难度还没有可核实的队伍成绩。<small>下一支挑战队伍，也许就是你们。</small></div>'}</section>`).join('');
    const runs=(data?.runs||[]).map(row=>`<article class="challenge-run"><div class="challenge-run-title"><span class="challenge-badge ${row.state==='completed'?'success':row.state==='paused'?'paused':''}">${esc(states[row.state]||'状态未记录')}</span><span>${esc(levels[row.difficulty]||'历史难度未记录')}</span><time>${esc(date(row.endedAt||row.startedAt))}</time></div><div class="challenge-party">${party(row)}</div><div class="challenge-run-progress"><strong>${progress(row,unit)}</strong><span>${row.score===null?'积分暂不计入':esc(row.score)+' 积分'}</span></div><div class="challenge-meter" role="img" aria-label="${progress(row,unit)}">${Array.from({length:row.totalUnits},(_,i)=>`<i class="${i<(row.clearedUnits||0)?'complete':''}"></i>`).join('')}</div><p class="tiny">${esc(reasons[row.reason]||(['active','paused'].includes(row.state)?'保存的挑战检查点':'结算原因未完整记录'))}${row.evidence==='saved-outcome+exact-log'?' · 难度已由同场服务器结算日志核实':''}</p></article>`).join('');
    return `<div class="page-heading"><div><div class="eyebrow">ADVENTURE RECORDS</div><h1>一起，抵达下一层。</h1><p>试炼塔与地下城的队伍成绩、挑战进度和共同战报。</p></div><a class="btn" href="#growth">冒险成长榜</a></div>
      <section class="challenge-hero"><div><span class="home-kicker">QIANDENGJI / CHALLENGES</span><h2>${esc(data?.activity?.name||'试炼塔')}</h2><p>${data?.activity?.type==='dungeon'?'深入遗迹、逐室挑战，再带着伙伴一起归来。':'逐层挑战、分工配合，留下属于你们的队伍成绩。'}</p></div><div class="challenge-total"><strong>${esc(total)}</strong><span>${unit}挑战</span></div></section>
      <div class="challenge-toolbar"><label>选择挑战<select id="challenge-activity" aria-label="选择挑战">${(catalogue.length?catalogue:[{id:'trial_tower',name:'试炼塔'}]).map(a=>`<option value="${esc(a.id)}" ${activity===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label><div class="challenge-tabs" role="group" aria-label="挑战难度">${[['all','全部难度'],...Object.entries(levels)].map(([id,label])=>`<button class="btn small ${difficulty===id?'primary':''}" data-challenge-level="${id}" aria-pressed="${difficulty===id}">${label}</button>`).join('')}</div></div>
      ${error||data?.sync?.stale?'<div class="notice challenge-warning">挑战同步暂未更新。以下为已保存记录，进行中状态可能已变化。</div>':''}
      <div class="challenge-stats"><div><span>收录场次</span><strong>${esc(data?.summary.records??'—')}</strong></div><div><span>完整通关</span><strong>${esc(data?.summary.completed??'—')}</strong></div><div><span>保存中的挑战</span><strong>${esc(data?.summary.active??'—')}</strong></div></div>
      <div class="challenge-section-title"><h2>队伍最佳成绩</h2><span>同一队伍每个难度保留最高分 · 同分并列</span></div>${groups||'<div class="panel challenge-empty">'+(error?'暂时无法读取挑战资料。':'正在读取服务器的挑战记录…')+'</div>'}
      <div class="challenge-section-title"><h2>近期挑战战报</h2><span>区分通关、暂停与阶段结束</span></div><div class="challenge-runs">${runs||'<div class="panel challenge-empty">暂无已收录场次；旧记录不会按记忆猜填。</div>'}</div>
      ${data&&data.pages>1?`<div class="pagination"><button class="btn small" data-challenge-page="${data.page-1}" ${data.page<=1?'disabled':''}>上一页</button><span>${esc(data.page)} / ${esc(data.pages)}</span><button class="btn small" data-challenge-page="${data.page+1}" ${data.page>=data.pages?'disabled':''}>下一页</button></div>`:''}
      <details class="panel challenge-notes"><summary>积分与记录说明</summary><p>${esc(data?.scoreRule||'网站挑战积分按已核实的通关进度计算，规则随记录一并展示。')}</p><p>${esc(data?.historyNotice||'只展示服务器保存的真实记录。')}</p><p>进行中状态来自保存检查点，约15秒同步一次。${data?.observedAt?'最近同步：'+esc(date(data.observedAt)):'尚未收到同步。'}</p></details>`;
  }
  document.addEventListener('click',event=>{
    const level=event.target.closest?.('[data-challenge-level]'),paging=event.target.closest?.('[data-challenge-page]');
    if(level){difficulty=level.dataset.challengeLevel;pageNumber=1;load();}
    if(paging&&!paging.disabled){pageNumber=Number(paging.dataset.challengePage);load();}
  });
  document.addEventListener('change',event=>{if(event.target.id==='challenge-activity'){activity=event.target.value;pageNumber=1;load();}});
  return {init,load,page};
})();
