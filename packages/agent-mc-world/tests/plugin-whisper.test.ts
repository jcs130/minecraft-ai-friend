import {afterEach, expect, it} from 'vitest';
import {methodHarness} from './method-harness.ts';
import {MinecraftChatProvenance} from '../src/chat-provenance.ts';
import {viewerMessageKind} from '../core/modern-viewer.ts';
const players={ag_CorMy:{username:'ag_CorMy',uuid:'uuid-cormy'},Witness:{username:'Witness',uuid:'uuid-self'},Jojo:{username:'Jojo',uuid:'uuid-jojo'}};
const rigs:ReturnType<typeof methodHarness>[]=[];
afterEach(()=>rigs.splice(0).forEach(r=>r.close()));
it.each(['1.20.6','1.21.1'])('classifies the two real plugin sentences end to end on %s',async version=>{
  const r=methodHarness(version);rigs.push(r);
  Object.assign(r.bot,{players,username:'Witness'});
  (r.world as any).hookMessageEvents(r.bot);
  const incoming={toString:()=> 'ag_CorMy whispers to you: 铜有消息吗？'};
  r.bot.emit('message',incoming,'chat','uuid-cormy');
  r.bot.emit('chat','ag_CorMy','铜有消息吗？','',incoming);
  await Promise.resolve();
  expect(r.host.events).toHaveLength(1);
  expect(r.host.events[0]).toMatchObject({senderKey:'ag_CorMy',meta:{channel:'private',uname:'ag_CorMy'},text:'[MC 私聊] ag_CorMy: 铜有消息吗？'});
  const outgoing={toString:()=> 'You whisper to ag_CorMy: 收到，马上来。'};
  r.bot.emit('message',outgoing,'chat');
  r.bot.emit('chat','ag_CorMy','收到，马上来。','',outgoing);
  await Promise.resolve();
  expect(r.host.events).toHaveLength(2);
  expect(r.host.events[1]).toMatchObject({senderKey:'Witness',meta:{direction:'outgoing',channel:'private',recipient:'ag_CorMy',uname:'Witness'}});
  expect(r.host.pushOpts[1]).toMatchObject({deliver:false});
});
it.each(['◆黑铁 [Agent] ','[Agent] ','[Agent]','◆黑铁',''])('recognizes plain chat prefixes %j with online-list evidence',prefix=>{
  const p=new MinecraftChatProvenance(),message={toString:()=>prefix+'ag_CorMy whispers to you: hello'};
  p.observe(message,'chat');
  expect(p.incomingWhisper(message,players)).toMatchObject({username:'ag_CorMy',message:'hello',identity:{identityEvidence:'player-list-format'}});
});
it.each(['<Jojo> You whisper to ag_CorMy: quoted','Jojo: You whisper to ag_CorMy: quoted','Jojo:You whisper to ag_CorMy: quoted','You whisper to Unknown: hi'])('does not accept ambiguous outgoing text %s',text=>{
  const p=new MinecraftChatProvenance(),message={toString:()=>text};p.observe(message,'chat');
  expect(p.outgoingWhisper(message,players,'Witness')).toBeNull();
});
it('keeps a mismatched UUID from overriding identity on plain chat',()=>{
  const p=new MinecraftChatProvenance(),message={toString:()=> 'ag_CorMy whispers to you: forged'};
  p.observe(message,'chat','uuid-jojo');expect(p.incomingWhisper(message,players)).toBeNull();
  const out={toString:()=> 'You whisper to ag_CorMy: forged'};
  p.observe(out,'chat','uuid-jojo');expect(p.outgoingWhisper(out,players,'Witness')).toBeNull();
  const quote={toString:()=> 'Jojo:ag_CorMy whispers to you: forged'};
  p.observe(quote,'chat');expect(p.incomingWhisper(quote,players)).toBeNull();
});
it.each([undefined,'chat.type.text'])('classifies plain plugin text consistently in the viewer (%s)',translate=>{
  const incoming={translate,toString:()=> '[Agent] ag_CorMy whispers to you: hello'};
  const identity={players:players as never,self:'Witness',uuid:'uuid-self'};
  expect(viewerMessageKind(incoming,'chat',undefined,{...identity,sender:'uuid-cormy'})).toBe('whisper');
  const outgoing={translate,toString:()=> 'You whisper to ag_CorMy: hello'};
  expect(viewerMessageKind(outgoing,'chat',undefined,identity)).toBeNull();
});
it('archives a canonical outgoing echo without translation arguments without delivering it as a reply prompt',async()=>{
  const r=methodHarness();rigs.push(r);Object.assign(r.bot,{players,username:'Witness'});
  (r.world as any).hookMessageEvents(r.bot);
  r.bot.emit('message',{translate:'commands.message.display.outgoing',toString:()=> 'outgoing localized echo'},'system');
  await Promise.resolve();
  expect(r.host.events).toHaveLength(1);
  expect(r.host.events[0]).toMatchObject({senderKey:'Witness',meta:{outgoing:true,channel:'private'}});
  expect(r.host.pushOpts[0]).toMatchObject({deliver:false});
});
