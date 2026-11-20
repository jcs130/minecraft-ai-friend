const get = id => document.getElementById(id);
const base = '/api/v1/maid-connect';
const id = new URLSearchParams(location.hash.slice(1)).get('request');
const valid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id || '');
const errors = {TRIAL_EXPIRED:'这次托管邀请已到期。',CONFIRMATION_DENIED:'连接码、请求或邀请文件不匹配。请核对同一台桌面的最新请求。',INVITATION_USED:'这个邀请已用于另一份设备请求。',RATE_LIMITED:'尝试较多，请稍后再试。',INVALID_CONFIRMATION:'请选择官网邀请文件，并填写六位连接码。'};
const fmt = t => new Date(t).toLocaleString('zh-CN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Shanghai'});
async function showConnection() {
  const response=await fetch(base+'/trial',{cache:'no-store',credentials:'omit'});
  if(!response.ok)throw Error();
  const state=await response.json();
  if (state.mode === 'owner') {
    location.replace('/maid-owner-connect.html' + (valid ? '#request=' + id : ''));
    return;
  }
  get('status').textContent=state.active?'本期开放「'+state.name+'」的家庭局域网临时托管。':'本期临时托管已结束。';
  get('start').hidden=valid && state.active;
  if(valid && state.active){
    get('role').textContent='托管「'+state.name+'」';
    get('scope').textContent='本次允许这台桌面读取角色状态、行动及收发游戏消息，有效至北京时间 '+fmt(state.expiresAt)+'。';
    get('consent').hidden=false;
  }
}
try { await showConnection(); }
catch { get('status').textContent='暂时无法读取托管状态，请稍后刷新。';get('start').hidden=false; }
get('consent').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;
  try{
    const file=form.elements.invite.files[0];
    if(!file || file.size>120)throw Error(errors.INVALID_CONFIRMATION);
    const invitation=(await file.text()).trim();
    if(!/^mdinvite_[A-Za-z0-9_-]{43}$/.test(invitation))throw Error(errors.INVALID_CONFIRMATION);
    const res=await fetch(base+'/requests/'+id+'/trial',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmationCode:form.elements.code.value.trim().toUpperCase(),invitation})});
    const data=await res.json();if(!res.ok)throw Error(errors[data.error?.reason]||'请求失败，请查看桌面插件的状态。');
    form.reset();form.hidden=true;history.replaceState(null,'',location.pathname);
    get('result').textContent='已授权「'+data.name+'」。请回到酒狐，用 body_connection 查看连接状态。';
  }catch(err){get('result').textContent=err.message || '暂时无法确认，请重试。';}finally{button.disabled=false;}
});
