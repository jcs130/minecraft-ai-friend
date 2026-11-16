import {expect,it} from 'vitest';
import {receiptTextView} from '../src/context.ts';
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
