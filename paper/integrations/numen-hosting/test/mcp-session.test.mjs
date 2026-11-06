import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {scopedMcpSessions} from '../src/mcp-session.mjs';
const coreDirectory=resolve('../../../packages/agent-mc-world');
const require=createRequire(join(coreDirectory,'package.json'));
const sdk=async name=>import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/'+name)));
const role={ownerId:'test',serverId:'isolated',roleUuid:'00000000-0000-0000-0000-000000000001',numenOwnerUuid:'00000000-0000-0000-0000-000000000002',name:'HostedTest'};
test('configured MCP uses the real SDK transport and explicit authenticated endpoint',async t=>{
  const {Server}=await sdk('server/index.js'),{StreamableHTTPServerTransport}=await sdk('server/streamableHttp.js');
  const {ListToolsRequestSchema,CallToolRequestSchema}=await sdk('types.js');
  const token=randomBytes(32).toString('base64url'),seen=[];
  const server=new Server({name:'synthetic-numen',version:'test'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'hosted_body',inputSchema:{type:'object'}}]}));
  server.setRequestHandler(CallToolRequestSchema,async request=>{seen.push(request.params);return{content:[{type:'text',text:'{"fixture":true}'}]};});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID,enableJsonResponse:true});
  await server.connect(transport);
  const http=createServer((req,res)=>{
    if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end();return;}
    void transport.handleRequest(req,res);
  });
  await new Promise(r=>http.listen(0,'127.0.0.1',r));let client;
  t.after(async()=>{await client?.close();await server.close();http.closeAllConnections();await new Promise(r=>http.close(r));});
  const sessions=await scopedMcpSessions({coreDirectory,endpointFor:()=>`http://127.0.0.1:${http.address().port}/mcp`,tokenFor:r=>{assert.deepEqual(r,role);return token;}});
  client=await sessions(role);assert.equal((await client.listTools()).tools[0].name,'hosted_body');
  await client.callTool({name:'hosted_body',arguments:{op:'capabilities',companion:role.roleUuid}});
  assert.equal(seen.length,1);assert.equal(seen[0].arguments.companion,role.roleUuid);
});
test('nonlocal MCP and redirect cannot move the credential to another server',async t=>{
  let tokenReads=0;
  const nonlocal=await scopedMcpSessions({coreDirectory,endpointFor:()=> 'https://example.invalid/mcp',tokenFor:()=>{tokenReads++;return'';}});
  await assert.rejects(nonlocal(role),{code:'MCP_ENDPOINT_INVALID'});assert.equal(tokenReads,0);
  const http=createServer((req,res)=>{res.writeHead(307,{location:'http://127.0.0.1:1/stolen'});res.end();});
  await new Promise(r=>http.listen(0,'127.0.0.1',r));t.after(async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));});
  const redirected=await scopedMcpSessions({coreDirectory,endpointFor:()=>`http://127.0.0.1:${http.address().port}/mcp`,tokenFor:()=>randomBytes(32).toString('base64url')});
  await assert.rejects(redirected(role));
});
