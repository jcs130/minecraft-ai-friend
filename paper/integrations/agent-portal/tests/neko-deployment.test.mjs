import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../src/config.mjs';

test('container environment can explicitly enable Neko login without baking private config into the image',()=>{
  const keys=['PORTAL_NEKO_OAUTH_ENABLED','PORTAL_NEKO_OAUTH_CLIENT_ID','PORTAL_NEKO_OAUTH_CLIENT_SECRET'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    for(const key of keys)delete process.env[key];
    assert.equal(loadConfig({skipLocalConfig:true}).nekoAuth.enabled,false);
    process.env.PORTAL_NEKO_OAUTH_ENABLED='true';
    process.env.PORTAL_NEKO_OAUTH_CLIENT_ID='qiandengji-deployment-fixture';
    const config=loadConfig({skipLocalConfig:true});
    assert.equal(config.nekoAuth.enabled,true);assert.equal(config.nekoAuth.clientId,'qiandengji-deployment-fixture');
    process.env.PORTAL_NEKO_OAUTH_ENABLED='false';
    assert.equal(loadConfig({skipLocalConfig:true,nekoAuth:{enabled:true}}).nekoAuth.enabled,false);
    for(const invalid of ['TRUE','yes','1','']){
      process.env.PORTAL_NEKO_OAUTH_ENABLED=invalid;
      assert.throws(()=>loadConfig({skipLocalConfig:true}),/must be true or false/);
    }
  }finally{
    for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  }
});
