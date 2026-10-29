import {expect,it} from 'vitest';
import {ReadProgressBook,readOnlyToolResult,runtimeExecutionState} from '../src/client/index.ts';
const state=()=>runtimeExecutionState('r',1,'started',[]);
const spec={name:'mc_guide',tags:['read']};
const input=(id:string,other:any={})=>({goalId:'goal',run:'r',requestId:id,spec,args:{topic:'cli'},
  result:{structuredContent:{failed:false,text:'whole immutable answer',control:{requestId:id}}},execution:state(),...other});

it('uses complete results across read tools rather than time/request ids, while new pages and changed facts reset progress',()=>{
  const book=new ReadProgressBook({window:3});
  expect(book.observe(input('1'))).toMatchObject({attempts:1,newInformation:true,streak:0});
  expect(book.observe(input('1'))).toBeNull();
  expect(book.observe(input('2'))).toMatchObject({attempts:2,streak:1});
  const other={spec:{name:'mc_help',annotations:{readOnlyHint:true}},args:{name:'operation'}};
  book.observe(input('3',other));book.observe(input('4'));
  expect(book.observe(input('5',other))).toMatchObject({attempts:2,streak:2});
  expect(book.observe(input('6'))).toMatchObject({repetitive:true,streak:3});
  expect(book.observe(input('7',{result:{structuredContent:{failed:false,text:'next actual page'}}})))
    .toMatchObject({attempts:1,newInformation:true,streak:0});
  expect(book.observe(input('8',{scene:{position:{x:1,y:64,z:2}}}))).toMatchObject({attempts:1,streak:0});
  expect(book.observe(input('9',{scene:{position:{x:2,y:64,z:2}}}))).toMatchObject({attempts:1,streak:0});
});

it('never calls missing counts, pending calls/tactics, active or cross-generation work idle; errors and writes do not accumulate reads',()=>{
  const book=new ReadProgressBook();
  for(const patch of [{activeCount:1},{detachedCount:1},{pendingCalls:1},{pendingTactics:1},{pendingCalls:undefined},{scope:undefined},{run:'old'}]){
    book.observe(input('a'));expect(book.observe(input('b',{execution:{...state(),...patch}}))).toBeNull();
    expect(book.observe(input('c'))?.attempts).toBe(1);
  }
  for(const x of [input('e',{spec:{name:'mc_mutate',tags:['read','write']}}),input('f',{result:{failed:true,text:'failed'}}),
    input('g',{result:{isError:true,structuredContent:{failed:false,text:'error'}}})])expect(book.observe(x)).toBeNull();
  expect(readOnlyToolResult(spec,{text:'accepted',execution:{kind:'task'}})).toBe(false);
  expect(readOnlyToolResult({name:'mc_protocol'},{text:'facts',meta:{readAccess:{protocol:'agent-mc-read-access/v1',readOnly:true}}})).toBe(true);
  expect(book.observe(input('sdk',{result:{text:'SDK full result'}}))?.newInformation).toBe(true);
});

it('bounds metadata, expires entries and scopes counters to the actual goal and execution revision',()=>{
  let now=100;const book=new ReadProgressBook({limit:2,ttlMs:10,now:()=>now});
  for(let n=0;n<4;n++)book.observe(input('r'+n,{args:{topic:String(n)}}));
  expect(book.snapshot().knownQueries).toBe(2);now+=11;
  expect(book.observe(input('later',{args:{topic:'3'}}))?.attempts).toBe(1);
  expect(book.observe(input('new-goal',{goalId:'other'}))?.attempts).toBe(1);
  expect(book.observe(input('new-execution',{goalId:'other',execution:{...state(),revision:'b'.repeat(64)}}))?.attempts).toBe(1);
  expect(JSON.stringify(book.snapshot())).not.toContain('whole immutable answer');
  book.reset();expect(book.snapshot().knownQueries).toBe(0);expect(book.observe(input('after-rest'))?.attempts).toBe(1);
  expect(()=>new ReadProgressBook({limit:-1})).toThrow();
});
