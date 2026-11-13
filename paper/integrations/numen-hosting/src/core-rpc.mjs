import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';

// A per-runtime private transport for the existing autonomy controller. The
// browser never receives this token. The MCP server retains schema validation,
// stable request IDs, turn ownership and execution barriers.
export async function openCoreRpc(client,{check}){
  const token=randomBytes(32).toString('base64url');
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);
      if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${server.address().port}`
        ||req.headers.origin||req.headers.cookie||Object.keys(req.headers).some(k=>k==='forwarded'||k.startsWith('x-forwarded-'))
        ||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(403,{error:'LOCAL_CORE_ONLY'});
      if(req.method!=='POST'||req.url!=='/core'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return send(404,{error:'NOT_FOUND'});
      const admitted=()=>{
        try{check();return true;}
        catch(error){
          if(error?.code!=='CONTROL_CHANGED')throw error;
          send(409,{error:'CONTROL_CHANGED'});
          return false;
        }
      };
      if(!admitted())return;
      let size=0;const parts=[];
      for await(const part of req){size+=part.length;if(size>262144)throw new Error('too large');parts.push(part);}
      const value=JSON.parse(Buffer.concat(parts).toString());
      if(!admitted())return;
      let result;
      if(value.operation==='tools')result=await client.mcp.listTools();
      else if(value.operation==='tool')result=await client.mcp.callTool({name:value.arguments[0],arguments:value.arguments[1],
        ...(value.arguments[2]?{_meta:value.arguments[2]}:{})},undefined,{timeout:180000});
      else if(value.operation==='resource')result=await client.mcp.readResource({uri:value.arguments[0]});
      else throw new Error('unsupported operation');
      send(200,result);
    }catch{send(409,{error:'CORE_REQUEST_UNRESOLVED',message:'Control changed or the original request failed; query its stable request ID, do not replay.'});}
  });
  server.requestTimeout=190000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return{endpoint:`http://127.0.0.1:${server.address().port}/core`,token,
    async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
