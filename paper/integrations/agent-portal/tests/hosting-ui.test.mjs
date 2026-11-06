import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {pcmWav} from '../public/hosting-recorder.mjs';
const script=await readFile(new URL('../public/hosting.js',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setTimeout(r,25));
function page(t,state,api){const dom=new JSDOM('<main><h1>角色</h1></main>',{url:'https://example.invalid',runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.eval(script);t.after(()=>{dom.window.QdHosting.dispose();dom.window.close();});dom.window.QdHosting.mount({root:dom.window.document.querySelector('main'),api,state});return dom.window;}
test('settings never prefill key, clear input on submit and disposal, and require saving changed selection',async t=>{
  let revision=0,posted;const catalogue={providers:[{id:'a',label:'供应商',models:[{id:'model',label:'测试模型'}]}],harnesses:[{id:'native',label:'Numen',mode:'numen',providers:['a'],available:true}]};
  const w=page(t,{view:'agents',session:{owner:{id:'owner'}},site:{hosting:{enabled:true}},authorized:[{id:'role',name:'角色',isOwn:true}]},async(url,opt)=>{
    if(opt?.method==='PUT'){posted=JSON.parse(opt.body);revision++;return{};}
    return{catalogue,profile:{revision,harness:'native',provider:'a',model:'model',goal:'探险',keyConfigured:true}};
  });await settle();const key=w.document.querySelector('[type=password]');assert.equal(key.value,'');key.value='synthetic-input';key.dispatchEvent(new w.Event('input',{bubbles:true}));
  const find=label=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===label);assert.equal(find('启动托管').disabled,true);
  find('保存设置').click();await settle();assert.equal(key.value,'');assert.equal(posted.apiKey,'synthetic-input');
  assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);w.QdHosting.dispose();assert.equal(w.document.querySelector('[type=password]'),null);
});
test('public conversation renders text safely, preserves uncertain message ID and never auto-sends',async t=>{
  const sent=[],state={view:'live',session:{owner:{id:'viewer'}},site:{hosting:{enabled:true}},selectedChannel:'c',channels:[{id:'c',managed:true,playerName:'Agent'}]};
  const w=page(t,state,async(url,opt)=>{if(opt){sent.push(JSON.parse(opt.body));return{state:'unknown',message:'结果未确认'};}return{messages:[{id:'one',text:'<img src=x onerror=alert(1)>',state:'delivered'}],replies:[]};});
  await settle();assert.equal(w.document.querySelectorAll('img').length,0);assert.equal(sent.length,0);
  const input=w.document.querySelector('textarea');input.value='你好';const send=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='发送');
  send.click();await settle();send.click();await settle();assert.equal(sent.length,2);assert.equal(sent[0].id,sent[1].id);assert.equal(sent[0].text,'你好');
});
test('PCM recording produces real mono PCM16 WAV and enforces duration',()=>{
  const value=pcmWav([new Float32Array(4000).fill(.5)],16000),v=new DataView(value.buffer);
  assert.equal(Buffer.from(value).toString('ascii',0,4),'RIFF');assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint16(34,true),16);assert.equal(v.getInt16(44,true),16384);
  assert.throws(()=>pcmWav([new Float32Array(1)],16000));assert.throws(()=>pcmWav([new Float32Array(16000*31)],16000));
});
