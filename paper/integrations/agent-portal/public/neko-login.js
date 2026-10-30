const root=document.querySelector('#neko-signin');
const status=document.querySelector('#neko-account-status');
const login=document.querySelector('#neko-login');
const approve=document.querySelector('#neko-plugin-approve');
const requestId=new URLSearchParams(location.search).get('neko_request');
let session;
async function api(path,body){
  const response=await fetch('/api/v1'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
    headers:body?{'Content-Type':'application/json','X-CSRF-Token':session?.csrfToken||''}:{},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok)throw Error(data.error?.message||'授权尚未确认，请刷新核对原请求。');
  return data;
}
async function load(){
  try{
    const capability=await api('/auth/neko');
    if(!capability.available){
      if(requestId){root.hidden=false;login.disabled=true;status.textContent='千灯纪的猫娘计划登录尚未启用。请等待站点完成官方 OAuth 客户端登记；原插件账号与请求保留。';}
      return;
    }
    root.hidden=false;session=await api('/session');
    if(new URLSearchParams(location.search).get('neko')==='failed')status.textContent='授权没有完成，请重新开始；没有改动已有角色。';
    else status.textContent=session.nekoAuth?.linked?'猫娘计划账号已关联，当前千灯纪身份：'+session.owner.username:'使用官方授权登录或关联，无需另设千灯纪网站密码。';
    login.textContent=session.nekoAuth?.linked?'重新验证猫娘计划账号':session.owner?'关联猫娘计划到当前千灯纪账号':'使用猫娘计划账号登录千灯纪';
    if(requestId){
      if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('插件接入请求无效。');
      const preview=await api('/neko-plugin/requests/'+requestId+'/preview');
      document.querySelector('#neko-plugin-request').textContent='本机插件请求准备新角色：'+preview.username;
      document.querySelector('#neko-plugin-consent').hidden=false;
      approve.disabled=!session.nekoAuth?.linked||preview.phase==='approved';
      if(preview.phase==='approved')status.textContent='已授权。请返回 Neko 插件，插件会继续准备账号和自动登录。';
    }
  }catch(error){root.hidden=false;status.textContent=error.message;approve.disabled=true;}
}
login.addEventListener('click',async()=>{
  login.disabled=true;
  try{
    const result=await api('/auth/neko/start',{mode:session?.nekoAuth?.linked?'reauth':session?.owner?'link':'login',...(requestId?{requestId}:{})});
    const url=new URL(result.authorizationUrl);
    if(url.origin!=='https://auth.project-neko.cn'||url.pathname!=='/oauth2/auth')throw Error('授权地址不匹配，未跳转。');
    location.assign(url.href);
  }catch(error){status.textContent=error.message;login.disabled=false;}
});
approve.addEventListener('click',async()=>{
  approve.disabled=true;
  try{await api('/neko-plugin/requests/'+requestId+'/approve',{});status.textContent='已授权。请返回 Neko 插件，等待账号准备完成后开始游玩。';}
  catch(error){status.textContent=error.message;approve.disabled=false;}
});
await load();
