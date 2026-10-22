import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {makeProfile,loadProfile,verifyBundle} from '../skills/qiandengji-agent/scripts/setup.mjs';
import {saveSecret,readSecret} from '../skills/qiandengji-agent/scripts/private.mjs';
import {createPortalClient,validPortal} from '../skills/qiandengji-agent/assets/mcp/portal-client.mjs';
import {ownAuthenticatedState} from '../skills/qiandengji-agent/scripts/account.mjs';

function temporary(){return mkdtempSync(join(tmpdir(),'qiandengji-skill-'));}
function json(file,value){writeFileSync(file,JSON.stringify(value),{mode:0o600});}
function portalFixture(transport){
  const root=temporary(),tokenFile=join(root,'token'),configFile=join(root,'portal.json');
  saveSecret(tokenFile,Buffer.from('pat_'+'a'.repeat(43)),'file');
  json(configFile,{username:'ag_Own',baseUrl:'https://portal.example',tokenFile,tokenFormat:'file'});
  return {root,configFile,client:createPortalClient(configFile,'ag_Own',transport)};
}
const own={id:'a'.repeat(24),name:'ag_Own',playerUuid:'11111111-1111-1111-1111-111111111111'};
const other={id:'b'.repeat(24),name:'ag_Other',playerUuid:'22222222-2222-2222-2222-222222222222'};

test('account enrollment accepts the actual UUID-only LoginGuard receipt, not conflicting or pending identities',()=>{
  const receipt={playerUuid:own.playerUuid,authorized:true,status:'authenticated',passwordSet:false};
  assert.deepEqual(ownAuthenticatedState(receipt,own.name,own.playerUuid),receipt);
  assert.equal(ownAuthenticatedState({...receipt,username:other.name},own.name,own.playerUuid),null);
  assert.equal(ownAuthenticatedState({...receipt,playerUuid:other.playerUuid},own.name,own.playerUuid),null);
  assert.equal(ownAuthenticatedState({...receipt,status:'pending'},own.name,own.playerUuid),null);
  assert.equal(ownAuthenticatedState({...receipt,authorized:null},own.name,own.playerUuid),null);
});

test('independent profile preserves credentials and refuses to replace an existing role',()=>{
  const root=temporary(),directory=join(root,'role');
  const result=makeProfile({directory,username:'ag_Own',root:'/installed/skill'});
  const {config}=loadProfile(directory),login=JSON.parse(readFileSync(config.world.loginConfigFile,'utf8'));
  const account=login.accounts[0],plain=readSecret(account.credentialFile,account.credentialFormat);
  try{
    assert.equal(plain.length,48);assert.equal(config.world.version,'1.21.1');
    assert.equal(config.world.host,'micro.kangqiang.site');assert.equal(config.world.port,25702);
    assert.equal(config.world.viewerPort,0);assert.equal(config.metricsPort,0);
    assert.equal(config.world.local.startWithWorld,false);assert.equal(config.world.client.enabled,false);
    assert.equal(result.gameConnected,false);assert.ok(!JSON.stringify(result).includes(plain.toString()));
    const original=readFileSync(join(directory,'client.json'));
    assert.throws(()=>makeProfile({directory,username:'ag_Other'}),/profile_already_exists/);
    assert.deepEqual(readFileSync(join(directory,'client.json')),original);
    const second=join(root,'second');makeProfile({directory:second,username:'ag_Other'});
    assert.notEqual(loadProfile(second).config.dataDir,config.dataDir);
  }finally{plain.fill(0);}
});

test('existing private password imports without publishing it; bad arguments do not create a role',()=>{
  const root=temporary(),input=join(root,'password'),directory=join(root,'role');
  saveSecret(input,Buffer.from('test-password-for-fixture'),'file');
  const result=makeProfile({directory,username:'ag_Own',passwordFile:input});
  const {config}=loadProfile(directory),account=JSON.parse(readFileSync(config.world.loginConfigFile)).accounts[0];
  const value=readSecret(account.credentialFile,account.credentialFormat);
  try{assert.equal(value.toString(),'test-password-for-fixture');assert.ok(!JSON.stringify(result).includes(value.toString()));}finally{value.fill(0);}
  assert.throws(()=>makeProfile({directory:join(root,'bad'),username:'ag_Own',passwordFormat:'unknown'}),/invalid_password_format/);
  assert.throws(()=>makeProfile({directory:join(root,'bad'),username:'a/b'}),/username/);
});

test('bundle hash tampering is rejected before npm or a game connection starts',()=>{
  const root=temporary(),target=join(root,'scripts');mkdirSync(target);
  const file=join(target,'entry.mjs');writeFileSync(file,'original');
  json(join(root,'bundle.json'),{schemaVersion:1,name:'qiandengji-agent',files:[{path:'scripts/entry.mjs',sha256:createHash('sha256').update('original').digest('hex')}]});
  assert.equal(verifyBundle(root).files.length,1);writeFileSync(file,'changed');
  assert.throws(()=>verifyBundle(root),/checksum_mismatch/);
  json(join(root,'bundle.json'),{schemaVersion:1,name:'qiandengji-agent',files:[{path:'../escape',sha256:'0'.repeat(64)}]});
  assert.throws(()=>verifyBundle(root),/invalid_bundle_path/);
});

test('portal filters the bound account and fetches its own profile with a private bearer header',async()=>{
  const requests=[];
  const {client}=portalFixture(async(url,options)=>{
    requests.push({url,options});
    return Response.json(url.endsWith('/agents')?{agents:[other,own]}:{sampledAt:'2026-01-01T00:00:00Z',health:12});
  });
  const roles=await client.read({action:'agents'});assert.deepEqual(roles.data.agents,[own]);
  const profile=await client.read({action:'profile'});
  assert.ok(requests.at(-1).url.endsWith('/'+own.id+'/profile'));
  assert.equal(profile.gameLoginAuthorized,false);assert.equal(profile.source,'portal_saved_data');
  assert.equal(profile.data.sampledAt,'2026-01-01T00:00:00Z');
  assert.equal(requests[0].options.headers.Authorization,'Bearer pat_'+'a'.repeat(43));
  assert.ok(!JSON.stringify(profile).includes('pat_'));
});

test('portal denies a different role, revocation and token-carrying redirects without fallback',async()=>{
  const different=portalFixture(async()=>Response.json({agents:[other]}));
  await assert.rejects(different.client.read({action:'state'}),/role_not/);
  const revoked=portalFixture(async()=>new Response('{}',{status:401}));
  await assert.rejects(revoked.client.read({action:'agents'}),/portal_http_401/);
  let count=0;
  const redirect=portalFixture(async(_url,options)=>{count++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://elsewhere.example'}});});
  await assert.rejects(redirect.client.read({action:'agents'}),/redirect_refused/);assert.equal(count,1);
});

test('public capabilities work without a token; status is usable before Minecraft connects',async()=>{
  let auth;
  const {client,configFile}=portalFixture(async(_url,options)=>{auth=options.headers.Authorization;return Response.json({ready:false});});
  const config=JSON.parse(readFileSync(configFile));config.tokenFile=null;json(configFile,config);
  assert.equal((await client.read({action:'status'})).tokenConfigured,false);
  assert.equal((await client.read({action:'capabilities'})).data.ready,false);assert.equal(auth,undefined);
  await assert.rejects(client.read({action:'agents'}),/token_not_configured/);
  await assert.rejects(client.read({action:'state',agentId:other.id}),/invalid_portal_action/);
  assert.throws(()=>validPortal('http://public.example'),/requires_https/);
  assert.throws(()=>validPortal('https://user:password@portal.example'),/requires_https/);
  assert.equal(validPortal('http://127.0.0.1:9999'),'http://127.0.0.1:9999');
});
