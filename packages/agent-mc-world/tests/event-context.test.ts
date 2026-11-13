import {describe,it,expect} from 'vitest';
import {readSupervisorEventView, readWorkerEventView, supervisorEventView, tacticSupervisorView} from '../src/context.ts';
describe('source-owned event context',()=>{
  it('binds an optional shorter view to the exact original, leaving source data intact',()=>{
    const original=JSON.stringify({id:1,details:'x'.repeat(2000)}), view=supervisorEventView(original,'accepted; outcome pending');
    expect(readSupervisorEventView(original,view)).toBe('accepted; outcome pending');
    expect(readSupervisorEventView(original+' ',view)).toBeNull();
    expect(readSupervisorEventView(original,{...view,protocol:'unknown'})).toBeNull();
    expect(readSupervisorEventView(original,null)).toBeNull();
    expect(JSON.parse(original).details).toHaveLength(2000);
  });
  it('preserves failed and unknown tactical choices and their errors',()=>{
    for(const receipt of [{accepted:false,error:'blocked'},{accepted:null},{accepted:true,error:'uncertain'}])
      expect(tacticSupervisorView(receipt)).toBeNull();
  });
  it('requires separate worker opt-in and exact text binding',()=>{
    const original='Original detail '.repeat(100);
    expect(readWorkerEventView(original,supervisorEventView(original,'owner summary'))).toBeNull();
    const view=supervisorEventView(original,'owner summary','worker lookup notice');
    expect(readWorkerEventView(original,view)).toBe('worker lookup notice');
    expect(readWorkerEventView(original+' changed',view)).toBeNull();
    expect(readWorkerEventView(original,{...view,worker:42})).toBeNull();
  });
  it('retains native identities, time, method and the non-completion boundary',()=>{
    const receipt={id:4,at:'2026-11-06T10:00:00Z',accepted:true,candidate:{kind:'method',targetId:3,uuid:'target-uuid',source:'x'.repeat(2000)},
      tacticRevision:8,decisionId:'d',method:'navigate',runId:7,meaning:'task-started; inspect terminal'};
    expect(JSON.parse(readSupervisorEventView(JSON.stringify(receipt),tacticSupervisorView(receipt))!)).toMatchObject({
      id:4,at:receipt.at,decisionId:'d',tacticRevision:8,method:'navigate',runId:7,goalCompleted:false,choice:{targetId:3,uuid:'target-uuid'}});
    expect(readWorkerEventView(JSON.stringify(receipt),tacticSupervisorView(receipt)))
      .toBe(readSupervisorEventView(JSON.stringify(receipt),tacticSupervisorView(receipt)));
  });
});
