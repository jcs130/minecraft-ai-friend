import {publicDialogueText} from './public-dialogue.mjs';
const fail=(status,reason,message)=>Object.assign(new Error(message),{status,reason});

// Called after the existing same-origin/CSRF write gate. Authority is resolved
// anew for every request, including polling, speech and a resumed browser tab.
export async function hostingRoutes({req,res,pathname,backend,browserAuth,agentFor,channelFor,world,jsonBody,respond,rate}) {
  const own=/^\/api\/v1\/agents\/([a-f0-9]{24})\/hosting(?:\/(mode|release))?$/.exec(pathname);
  const talk=/^\/api\/v1\/live\/([a-f0-9]{32})\/conversation(?:\/(messages|result|transcribe|speech))?$/.exec(pathname);
  if(!own&&!talk)return false;
  const {owner}=browserAuth(req);
  if(!backend)throw fail(503,'HOSTING_NOT_CONNECTED','服务器托管与对话入口正在接入，现有客户端和观战仍可使用。');
  const agent=own?await agentFor(owner,own[1]):await channelFor(owner,talk[1]);
  const request=(op,data={})=>backend.request({owner,roleUuid:agent.playerUuid,conversation:!!talk,op,data});
  let result;
  try {
    if(own) {
      if(req.method==='GET'&&!own[2])result=await request('profile');
      else if(req.method==='PUT'&&!own[2])result=await request('configure',{profile:await jsonBody(req,16384)});
      else if(req.method==='POST'&&own[2]==='release')result=await request('release');
      else if(req.method==='POST'&&own[2]==='mode') {
        const data=await jsonBody(req,2048);
        if(!['paused','numen','harness'].includes(data.mode))throw fail(400,'MODE_INVALID','请选择暂停、Numen 或 Harness；手动接管在游戏页面操作。');
        // Attach must remain an explicit owner operation, not a side effect of
        // opening settings or someone else's spectator conversation.
        if(data.mode!=='paused')await request('attach');
        result=await request('mode',{mode:data.mode,runtime:data.runtime});
      }else throw fail(405,'METHOD_NOT_ALLOWED','请使用托管设置中的保存或启动按钮。');
    }else if(req.method==='GET'&&!talk[2]) {
      result=await request('messages');
      const events=(await world.events({kind:'chat',player:agent.name,limit:20})).events;
      result.replies=[...(result.replies??[]),...events.filter(e=>e.source==='minecraft.public-chat'&&e.playerName===agent.name&&publicDialogueText(e.body,1200))];
    }else if(req.method==='POST') {
      rate('hosting-chat:'+owner.id,24,60000);
      const data=await jsonBody(req,talk[2]==='transcribe'?4*1024*1024+2048:8192);
      if(talk[2]==='messages')result=await request('message',{id:data.id,text:data.text});
      else if(talk[2]==='result')result=await request('messageResult',{id:data.id});
      else if(talk[2]==='transcribe')result=await request('transcribe',{id:data.id,audio:data.audio});
      else if(talk[2]==='speech') {
        if(typeof data.id==='string'&&data.id.startsWith('speech-')){result=await request('speak',{id:data.id});respond(res,200,result);return true;}
        // Only actual selected-role game speech can be read aloud; the browser
        // cannot turn this into a general public TTS endpoint.
        const rows=(await world.events({kind:'chat',player:agent.name,limit:50})).events;
        const reply=rows.find(e=>e.id===data.id&&e.playerName===agent.name&&e.source==='minecraft.public-chat');
        const text=reply&&publicDialogueText(reply.body,1200);
        if(!text)throw fail(404,'REPLY_NOT_FOUND','这条游戏回复不可朗读，请刷新对话。');
        result=await request('speak',{id:data.id,text});
      }else throw fail(405,'METHOD_NOT_ALLOWED','请使用文字发送或录音按钮。');
    }else throw fail(405,'METHOD_NOT_ALLOWED','不支持该操作。');
  }catch(error){
    if(error.reason)throw error;
    throw fail(error.expose===true?error.status:503,error.expose===true?error.code:'HOSTING_UNAVAILABLE',error.expose===true?error.message:'托管服务暂不可用，请稍后查询状态。');
  }
  respond(res,200,result);return true;
}
