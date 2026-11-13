import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {identity,fail} from './protocol.mjs';

/** Explicit server assembly. Tokens come from the operator's injected vault;
 * this module never discovers files or asks a browser for a game password. */
export async function scopedMcpSessions({coreDirectory,endpointFor,tokenFor}) {
  const require=createRequire(join(resolve(coreDirectory),'package.json'));
  const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
  const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));
  return async supplied=>{
    const role=identity(supplied),endpoint=new URL(await endpointFor(role));
    if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.pathname!=='/mcp'
      ||!endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
      throw fail('MCP_ENDPOINT_INVALID','Numen MCP 必须通过明确配置的本机 /mcp 端点连接。',503);
    const token=await tokenFor(role);
    if(typeof token!=='string'||token.length<24||/[\r\n]/.test(token))throw fail('MCP_TOKEN_REQUIRED','请由服务端配置此角色的 Numen BRAIN 作用域令牌。',503);
    const transport=new StreamableHTTPClientTransport(endpoint,{
      requestInit:{headers:{authorization:`Bearer ${token}`},redirect:'error'},
      reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1},
      fetch:(input,init)=>{
        if(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).href!==endpoint.href)
          throw fail('MCP_REDIRECT_REFUSED','Numen MCP 不允许改变回源地址。',503);
        return fetch(input,{...init,redirect:'error'});
      }
    });
    const client=new Client({name:'qiandengji-numen-hosting',version:'0.1.0'});
    try{await client.connect(transport,{timeout:10000});}
    catch(error){await transport.close();throw error;}
    return{
      listTools:()=>client.listTools({}, {timeout:10000}),
      callTool:(request,{signal}={})=>client.callTool(request,undefined,
        {timeout:request.arguments?.op==='call'?300000:12000,signal}),
      close:()=>client.close()
    };
  };
}
