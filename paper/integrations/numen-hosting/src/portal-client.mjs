import {fail} from './protocol.mjs';

/** Only used behind the website's existing browser session/Origin/CSRF gate.
 * A remote portal uses the protected reverse tunnel terminating on loopback. */
export function hostedPortalClient({authority,endpoint,serviceKey,fetcher=fetch}) {
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/v1/hosting'||url.username||url.password||url.search||url.hash)
    throw new Error('Hosting endpoint must use the protected loopback tunnel');
  if(!Buffer.isBuffer(serviceKey)||serviceKey.length<32)throw new Error('Hosting transport key required');
  async function call(value) {
    let response,result;
    try {
      response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(110000),headers:{
        'content-type':'application/json',authorization:`Bearer ${serviceKey.toString('base64url')}`},body:JSON.stringify(value)});
      const parts=[];let size=0;
      for await(const part of response.body){size+=part.length;if(size>6*1024*1024)throw Error();parts.push(part);}
      result=JSON.parse(Buffer.concat(parts).toString());
    }catch{throw fail('HOSTING_RESULT_UNKNOWN','托管服务暂未返回结果，请查询原请求；不要重复启动或发消息。',503);}
    if(!response.ok)throw fail(/^[A-Z_]+$/.test(result.error)?result.error:'HOSTING_UNAVAILABLE',
      typeof result.message==='string'?result.message:'托管服务暂不可用。',response.status);
    return result;
  }
  return {async request({owner,roleUuid,conversation=false,op,data={}}) {
    const grant=await(conversation?authority.conversation(owner,roleUuid):authority.issue(owner.id,roleUuid));
    const session=await call({op:'authorize',grant});
    try{return await call({...data,op,session:session.session});}
    finally{await call({op:'logout',session:session.session}).catch(()=>{});}
  }};
}
