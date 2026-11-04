import {expect,it} from 'vitest';
import {readWorkBinding,compareWorkBindings} from '../src/contracts/index.ts';
const b={scope:{realm:'server',account:'player',agent:'A'},subject:'tower'};
it('separates preparation scope from a concrete occurrence without asserting completion',()=>{
 expect(compareWorkBindings(b,{...b,instance:'a'})).toBe('subject');
 expect(compareWorkBindings({...b,instance:'a'},{...b,instance:'a'})).toBe('exact');
 expect(compareWorkBindings({...b,instance:'a'},{...b,instance:'b'})).toBe('mismatch');
 expect(compareWorkBindings(b,{...b,subject:'crypt'})).toBe('mismatch');
 expect(readWorkBinding({...b,status:'completed',revision:99})).toEqual(b);
});
it.each(['realm','account','agent'])('keeps %s identity separate',key=>{
 expect(compareWorkBindings(b,{...b,scope:{...b.scope,[key]:'other'}})).toBe('mismatch');
});
it('keeps malformed attribution unknown',()=>{
 for(const v of [null,{}, {...b,instance:''},{...b,scope:{realm:'server'}}, {...b,subject:' '}]){
  expect(readWorkBinding(v)).toBeNull();expect(compareWorkBindings(b,v)).toBe('unknown');
 }
});
