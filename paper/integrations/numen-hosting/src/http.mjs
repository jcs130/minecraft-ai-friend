import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyGrant, fail } from './protocol.mjs';

// The public website remains the only cookie/CSRF authority. This loopback
// endpoint accepts dedicated server-to-server credentials, never browser cookies.
export function hostingServer({hosting,conversations,grantKey,serviceKey,now=Date.now}) {
  if(!Buffer.isBuffer(grantKey)||grantKey.length<32||!Buffer.isBuffer(serviceKey)||serviceKey.length<32)
    throw new Error('Separate random grant and transport keys of at least 32 bytes are required');
  if(grantKey.equals(serviceKey))throw new Error('Grant and transport keys must be separate');
  const sessions=new Map();
  const send=(res,status,value)=>{
    res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
      'x-content-type-options':'nosniff'});res.end(JSON.stringify(value));
  };
  const server=createServer(async(req,res)=>{
    try{
      const address=req.socket.remoteAddress;
      const expectedHost=`127.0.0.1:${server.address().port}`;
      if(address!=='127.0.0.1'||req.headers.host!==expectedHost||req.headers.origin||req.headers.cookie
          ||Object.keys(req.headers).some(k=>k==='forwarded'||k.startsWith('x-forwarded-')))
        throw fail('LOCAL_GATEWAY_ONLY','此端点只供本机网页网关调用。',403);
      const supplied=Buffer.from(req.headers.authorization??'');
      const expected=Buffer.from(`Bearer ${serviceKey.toString('base64url')}`);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw fail('UNAUTHORIZED','网关授权无效。',401);
      if(req.method!=='POST'||req.url!=='/v1/hosting')throw fail('NOT_FOUND','使用 POST /v1/hosting。',404);
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw fail('CONTENT_TYPE','需要 application/json。',415);
      const chunks=[];let bytes=0;
      const maximum=4*1024*1024+16384;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>maximum)throw fail('PAYLOAD_TOO_LARGE','语音请求超出 4 MiB。',413);chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('INVALID_JSON','请求 JSON 无效。',400);}
      if(!body||typeof body!=='object'||Array.isArray(body))throw fail('INVALID_REQUEST','请求必须是对象。',400);
      if(bytes>65536&&body.op!=='transcribe')throw fail('PAYLOAD_TOO_LARGE','该请求超出 64 KiB。',413);
      let result;
      for(const[id,s]of sessions)if(s.expires<=now())sessions.delete(id);
      if(body.op==='authorize'){
        if(sessions.size>=1024)throw fail('SESSION_LIMIT','托管会话达到上限，请稍后再试。',429);
        const grant=verifyGrant(body.grant,grantKey,now());hosting.store.claimGrant(grant.jti,grant.exp,now());
        const session=randomBytes(32).toString('base64url');const expires=now()+300000;
        if(grant.scope==='conversation')conversations?.actor(grant.actor);
        sessions.set(session,{role:grant.role,scope:grant.scope,actor:grant.actor,expires});
        result={session,expires,role:grant.role};
      }else{
        const session=sessions.get(body.session);if(!session)throw fail('SESSION_EXPIRED','请回官网重新选择自己的角色。',401);
        const {role}=session;
        const chatOps=['messages','message','messageResult','transcribe','speak'];
        if(session.scope==='conversation'&&!chatOps.includes(body.op)&&body.op!=='logout')
          throw fail('SCOPE_DENIED','观众只能交流，不能更改模型设置或接管角色。',403);
        if(chatOps.includes(body.op)&&session.scope!=='conversation')throw fail('SCOPE_DENIED','请通过已登录的观战页面发起对话。',403);
        if(session.scope==='manual'&&!['status','input','manual','pause','logout'].includes(body.op))
          throw fail('SCOPE_DENIED','此授权仅用于网页接管，不允许更改托管循环。',403);
        switch(body.op){
          case'attach':result=await hosting.attach(role);break;
          case'status':result=hosting.status(role);break;
          case'mode':
            if(['numen','harness'].includes(body.mode)&&!hosting.profiles)throw fail('API_KEY_REQUIRED','请先配置自己的 API Key；托管不会使用服务器共享模型。',503);
            result=await hosting.switch(role,body.mode,{runtime:body.runtime});break;
          case'profile':
            if(!hosting.profiles)throw fail('HOSTING_CONFIGURATION_UNAVAILABLE','服务器托管配置尚未接通。',503);
            result={catalogue:hosting.profiles.cataloguePublic(),profile:hosting.profiles.read(role),status:hosting.store.get(`${role.serverId}/${role.roleUuid}`)?hosting.status(role):{mode:'paused',state:'detached'}};break;
          case'configure':result=await hosting.saveProfile(role,body.profile);break;
          case'messages':result={messages:conversations.list(role,session.actor),replies:await conversations.replies(role)};break;
          case'message':result=await conversations.send(role,session.actor,body);break;
          case'messageResult':result=await conversations.reconcile(role,session.actor,body.id);break;
          case'transcribe':result=await conversations.transcribe(role,session.actor,body);break;
          case'speak':
            if(body.text===undefined){result=await conversations.speakStored(role,session.actor,body.id);break;}
            conversations.hosting.owned(role);conversations.actor(session.actor);
            if(!conversations.voice)throw fail('VOICE_UNAVAILABLE','回复朗读尚未接通。',503);
            result=await conversations.voice.speak({role,actor:session.actor.id,id:body.id,text:body.text});break;
          case'manual':result=await hosting.switch(role,'manual',{controllerId:body.controllerId});break;
          case'pause':result=await hosting.switch(role,'paused');break;
          case'release':result=await hosting.release(role);break;
          case'input':result=await hosting.input(role,body.controllerId,body.epoch,body.frame);break;
          case'result':result=await hosting.reconcile(role,body.id);break;
          case'logout':sessions.delete(body.session);result={closed:true};break;
          default:throw fail('OPERATION_UNKNOWN','用 authorize、attach、status、mode、manual、input、pause、result 或 logout。',400);
        }
      }
      send(res,200,result);
    }catch(error){send(res,error.expose===true?error.status:503,{error:error.expose===true?error.code:'BACKEND_UNAVAILABLE',
      message:error.expose===true?error.message:'托管后端暂不可用；请查询状态，不要重复提交动作。'});}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;server.maxHeadersCount=24;
  return {server,listen(port=0){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server.address()));});}};
}
