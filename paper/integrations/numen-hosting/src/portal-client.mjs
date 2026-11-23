import {fail} from './protocol.mjs';

/** Only used behind the website's existing browser session/Origin/CSRF gate.
 * A remote portal uses the protected reverse tunnel terminating on loopback. */
export function hostedPortalClient({authority,endpoint,serviceKey,fetcher=fetch,characterBodies=false,characterDevices=false}) {
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/v1/hosting'||url.username||url.password||url.search||url.hash)
    throw new Error('Hosting endpoint must use the protected loopback tunnel');
  if(!Buffer.isBuffer(serviceKey)||serviceKey.length<32)throw new Error('Hosting transport key required');
  const bodyUrl=new URL('/v1/character-bodies',url);
  const deviceUrl=new URL('/v1/device-handoff',url);
  async function call(value, destination=url) {
    let response,result;
    try {
      const handoff=destination===bodyUrl;
      response=await fetcher(destination,{method:'POST',redirect:'error',signal:AbortSignal.timeout(handoff?8000:110000),headers:{
        'content-type':'application/json',authorization:`Bearer ${serviceKey.toString('base64url')}`},body:JSON.stringify(value)});
      const parts=[];let size=0;
      const maxBytes=handoff?8192:6*1024*1024;
      for await(const part of response.body){size+=part.length;if(size>maxBytes)throw Error();parts.push(part);}
      result=JSON.parse(Buffer.concat(parts).toString());
    }catch{throw fail('HOSTING_RESULT_UNKNOWN','托管服务暂未返回结果，请查询原请求；不要重复启动或发消息。',503);}
    if(!response.ok)throw fail(/^[A-Z_]+$/.test(result.error)?result.error:'HOSTING_UNAVAILABLE',
      typeof result.message==='string'?result.message:'托管服务暂不可用。',response.status);
    return result;
  }
  async function relayDevice(authorization, body) {
    try {
      const response=await fetcher(deviceUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{
        'content-type':'application/json',authorization},body:JSON.stringify(body)});
      const chunks=[];let size=0;
      for await(const part of response.body){size+=part.length;if(size>8192)throw Error();chunks.push(part);}
      const value=JSON.parse(Buffer.concat(chunks).toString());
      if(response.status===200&&Object.hasOwn(value,'value'))return {status:200,value:{value:value.value}};
      if([400,401,403,404,409,413,503].includes(response.status)&&/^[A-Z_]{1,80}$/.test(value?.error??''))
        return {status:response.status,value:{error:value.error}};
    }catch{}
    return {status:503,value:{error:'DEVICE_HOST_UNAVAILABLE'}};
  }
  const deviceOp=(op,characterId,{ownerId})=>call({op,characterId,ownerId},bodyUrl);
  return {characterDevices:characterBodies&&characterDevices ? {
    available:(characterId,auth)=>deviceOp('deviceAvailable',characterId,auth),
    enroll:(characterId,auth)=>deviceOp('deviceEnroll',characterId,auth),
    revoke:(characterId,auth)=>deviceOp('deviceRevoke',characterId,auth),
    relay:relayDevice,
  } : null,characterBodies:characterBodies ? {
    current:(characterId,{ownerId})=>call({op:'current',characterId,ownerId},bodyUrl),
    switchBody:({characterId,requestId,targetKind,expectedGeneration},{ownerId})=>
      call({op:'switch',characterId,requestId,targetKind,expectedGeneration,ownerId},bodyUrl),
    lookup:({characterId,requestId},{ownerId})=>call({op:'lookup',characterId,requestId,ownerId},bodyUrl)
  } : null, async request({owner,roleUuid,conversation=false,op,data={}}) {
    const grant=await(conversation?authority.conversation(owner,roleUuid):authority.issue(owner.id,roleUuid));
    const session=await call({op:'authorize',grant});
    try{return await call({...data,op,session:session.session});}
    finally{await call({op:'logout',session:session.session}).catch(()=>{});}
  }};
}
