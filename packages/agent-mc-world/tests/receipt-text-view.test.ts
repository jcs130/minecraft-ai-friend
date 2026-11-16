import {expect,it} from 'vitest';
import {receiptTextView} from '../src/context.ts';

function restore(view:any){
 const refs=view.requestTextReferences?.pointers??{},done=new Set<string>();
 const read=(path:string)=>{expand(path);return path.split('/').slice(1).reduce((v,key)=>v[key],view);};
 function expand(path:string){
  if(done.has(path))return;const ref=refs[path];if(!ref)return;done.add(path);
  let text;
  if(typeof ref==='string')text=read(ref);
  else if(ref.encoding==='json'){
   for(const child of Object.keys(refs))if(child.startsWith(ref.pointer+'/'))expand(child);
   text=ref.prefix+JSON.stringify(read(ref.pointer));
  }else text=read(ref.pointer).slice(ref.start,ref.start+ref.length);
  const keys=path.split('/').slice(1),key=keys.pop()!;
  keys.reduce((v,k)=>v[k],view)[key]=text;
 }
 for(const path of Object.keys(refs))expand(path);delete view.requestTextReferences;return view;
}
it('removes only byte-identical duplicated prose and preserves failures and measured effects',()=>{
 const text='Native denied action; unknown cells are not air. '.repeat(70);
 const original=JSON.stringify({text,execution:{id:'native-1',terminal:true,phase:'blocked',evidence:{receipt:text,steps:[{outcome:'fail',why:'protected',observedEffect:{changed:{position:false}}}]}}});
 const view=JSON.parse(receiptTextView(original));
 expect(view.text).toBe(text);expect(view.execution.evidence.steps[0]).toMatchObject({outcome:'fail',why:'protected'});
 expect(view.requestTextReferences.pointers).toEqual({'/execution/evidence/receipt':'/text'});
 expect(receiptTextView(original).length).toBeLessThan(original.length*.6);
 view.execution.evidence.receipt=view.text;delete view.requestTextReferences;expect(view).toEqual(JSON.parse(original));
 expect(receiptTextView(receiptTextView(original))).toBe(receiptTextView(original));
});
it('does not equate different evidence, opaque text or caller-supplied reference envelopes',()=>{
 for(const s of ['plain',JSON.stringify({text:'x'.repeat(500),execution:{evidence:{receipt:'y'.repeat(500)}}}),JSON.stringify({text:'x'.repeat(500),requestTextReferences:{},execution:{evidence:{receipt:'x'.repeat(500)}}})])expect(receiptTextView(s)).toBe(s);
});
it('references compact step details only when the full exact span survived the visible receipt',()=>{
 const detail='No route found with this movement configuration; other abilities remain unverified. '.repeat(6);
 const missing=detail+'not present';
 const value={text:'Native failed; '+detail+' End.',execution:{id:'task-2',phase:'failed',terminal:true,evidence:{format:'agent-mc/compact-execution-evidence/v1',steps:[{outcome:'fail',why:'no-path',detail:{text:detail,chars:detail.length,truncated:false}},{outcome:'fail',detail:{text:missing}}]}}};
 const view=JSON.parse(receiptTextView(JSON.stringify(value)));
 const ref=view.requestTextReferences.pointers['/execution/evidence/steps/0/detail/text'];
 expect(ref.unit).toBe('utf16');expect(view.execution.evidence.steps[1].detail.text).toBe(missing);
 view.execution.evidence.steps[0].detail.text=view.text.slice(ref.start,ref.start+ref.length);
 delete view.requestTextReferences;expect(view).toEqual(value);
});

it('factors nested canonical JSON query copies without losing notices, failures, timestamps or nulls',()=>{
 const data={requestId:'query-example',phase:'replied',goal_completed:false,outcomeUnknown:false,
  reply:{ok:false,text:'',data:{effect:'A safe landing is required. '.repeat(40),cooldownRemainingMs:null,items:[{name:'item',count:0}],failure:'protected',observedAt:'2026-11-16T00:00:00Z'}}};
 data.reply.text='NATIVE_REPLY '+JSON.stringify(data.reply.data);
 const original={text:'No nonce; this reply does not prove a unique request or goal.\n'+JSON.stringify(data),data};
 const raw=JSON.stringify(original),view=receiptTextView(raw);
 expect(view.length).toBeLessThan(raw.length*.6);
 const parsed=JSON.parse(view);expect(parsed.requestTextReferences.protocol).toMatch(/v2$/);
 expect(parsed.data.reply.data.failure).toBe('protected');expect(parsed.data.goal_completed).toBe(false);
 expect(restore(parsed)).toEqual(original);expect(receiptTextView(view)).toBe(view);
});

it('preserves non-identical text, formatted JSON, extra suffixes and observations not present in data',()=>{
 const data={effect:'eligible does not mean executed. '.repeat(30),nullable:null};
 for(const text of [JSON.stringify(data,null,2),JSON.stringify(data)+'\nActual execution failed.',JSON.stringify({...data,extra:'unknown'})]){
  const raw=JSON.stringify({text,data});expect(receiptTextView(raw)).toBe(raw);
 }
});

it('restores execution references through a factored root text and preserves the input string',()=>{
 const data={status:'failed',details:'Cannot traverse closed ceiling. '.repeat(40)};
 const text='Native: '+JSON.stringify(data),original={text,data,execution:{terminal:true,goalCompleted:false,evidence:{receipt:text}}};
 const raw=JSON.stringify(original),view=receiptTextView(raw);
 expect(restore(JSON.parse(view))).toEqual(original);expect(raw).toBe(JSON.stringify(original));
});
