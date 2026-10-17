import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messages} from '../maintenance-notice.mjs';

const plan={id:'chat-audience-20261012',version:'0.4.32',releaseNotes:['保护提示已精简。','观战聊天隐藏机器回执。']};
for(const [phase,remaining,count] of [['before',180,1],['before',60,1],['before',10,1],['updated',0,3],['cancelled',0,1]]){
 test(`${phase}/${remaining}: only concise human notices are broadcast`,()=>{
  const commands=messages(plan,phase,remaining);assert.equal(commands.length,count);
  for(const command of commands){
   assert(command.startsWith('minecraft:tellraw @a '));
   const component=JSON.parse(command.slice('minecraft:tellraw @a '.length));
   assert.match(component.text,/维护|版本更新|保护提示|观战聊天/);
   assert.doesNotMatch(component.text,/MC_[A-Z_]+|schemaVersion|releaseId|remainingSeconds/);
   assert(component.text.length<=140);
  }
 });
}
test('notice identity and phase still validated',()=>{
 assert.throws(()=>messages({...plan,id:'@a'},'before',180));
 assert.throws(()=>messages(plan,'unknown',0));
 assert.throws(()=>messages(plan,'before',-1));
});
test('invalid release notes cannot escape into chat',()=>{
 assert.throws(()=>messages({...plan,releaseNotes:['bad\ntext']},'updated'));
 assert.throws(()=>messages({...plan,releaseNotes:[]},'before',180));
});

test('numeric maintenance backport versions are accepted without weakening identity validation',()=>{
 const backport={...plan,version:'0.4.47.3'};
 assert.match(messages(backport,'before',180)[0],/0\.4\.47\.3/);
 assert.match(messages(backport,'updated')[0],/0\.4\.47\.3/);
 for(const version of ['0.4','0.4.47.3.1','0.4.47 @a','0.4.47\nstop','0.4.47-snapshot'])
  assert.throws(()=>messages({...plan,version},'before',180));
});
