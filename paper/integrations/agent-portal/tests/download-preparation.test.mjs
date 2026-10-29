import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {prepareSkillDownloads} from '../scripts/prepare-downloads.mjs';

async function fixture(t){const directory=await fs.mkdtemp(path.join(tmpdir(),'qd-public-download-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const bytes=Buffer.from('fixture zip bytes');const release={filename:'qiandengji-agent-9.9.9.zip',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};return{directory,bytes,release};}
test('explicit preparation downloads reviewed bytes once and preserves a verified existing file',async t=>{
 const{directory,bytes,release}=await fixture(t);let calls=0;
 const options={directory,baseUrl:'https://downloads.example.test/releases/',releases:[release],fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://downloads.example.test/releases/'+release.sha256+'/'+release.filename);assert.equal(init.credentials,'omit');return new Response(bytes);}};
 assert.equal((await prepareSkillDownloads(options))[0].downloaded,true);assert.equal((await prepareSkillDownloads(options))[0].downloaded,false);assert.equal(calls,1);
 assert.deepEqual(await fs.readFile(path.join(directory,release.filename)),bytes);
});
test('preparation refuses oversized or corrupted responses and never replaces a conflicting local file',async t=>{
 const{directory,bytes,release}=await fixture(t),base={directory,baseUrl:'https://downloads.example.test/',releases:[release]};
 await assert.rejects(prepareSkillDownloads({...base,fetchImpl:async()=>new Response(Buffer.alloc(bytes.length+1))}),/size_mismatch/);
 await assert.rejects(prepareSkillDownloads({...base,fetchImpl:async()=>new Response(Buffer.alloc(bytes.length))}),/checksum_mismatch/);
 assert.deepEqual(await fs.readdir(directory),[]);
 const file=path.join(directory,release.filename);await fs.writeFile(file,'original');
 await assert.rejects(prepareSkillDownloads({...base,fetchImpl:()=>{throw Error('must not fetch');}}),/existing_download_mismatch/);assert.equal(await fs.readFile(file,'utf8'),'original');
});
test('preparation rejects nonpublic bases and noncatalogue path names before fetching',async t=>{
 const{directory,release}=await fixture(t);
 await assert.rejects(prepareSkillDownloads({directory,baseUrl:'https://user:secret@example.test/',releases:[release]}));
 await assert.rejects(prepareSkillDownloads({directory,baseUrl:'https://example.test/',releases:[{...release,filename:'../private.zip'}]}),/invalid_reviewed_release/);
});
